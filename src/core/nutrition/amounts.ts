// Nutrienti di una quantità e somme con dati mancanti.
// Regola di fondo: un nutriente assente è "dato non disponibile", mai zero.

import { worseCertainty, type Certainty, type Quantity } from "../ledger";
import { convert } from "../units";
import type { FoodState, StatePreference } from "./match";
import { NUTRIENT_KEYS, type NutrientAmounts, type NutrientKey } from "./types";

/**
 * Da dove vengono i valori:
 * - `label`: etichetta di un prodotto (certezza `label`);
 * - `table`: tabella di composizione generica (certezza `estimated`);
 * - `derived`: calcolati da un'altra composizione con un'ipotesi, per esempio una resa di cottura
 *   (certezza `estimated`).
 */
export type CompositionOrigin = "label" | "table" | "derived";

/** Composizione pronta per il calcolo, qualunque ne sia la fonte (prodotto o alimento generico). */
export interface ResolvedComposition {
  /** Nome riconosciuto, per mostrare all'utente a che cosa è stata associata la voce. */
  name: string;
  /** Identificativo della fonte: id dell'alimento o codice a barre. */
  ref?: string;
  origin: CompositionOrigin;
  /** I valori sono per 100 g o per 100 ml. */
  basis: "g" | "ml";
  per100: NutrientAmounts;
  /** Peso indicativo di un pezzo, in grammi. */
  unitWeightG?: number;
  /** Densità in g/ml. */
  densityGPerMl?: number;
  /** Stato dell'alimento a cui si riferiscono i valori (crudo, cotto, secco, come venduto). */
  state?: FoodState;
  /** Se la ricerca ha applicato una preferenza di stato: quale e se è stata rispettata. */
  statePreference?: StatePreference;
  /**
   * Come è stata scelta la composizione: `explicit` per un alimento scelto dall'utente
   * (identificativo), `name` per una ricerca sul nome, `product` per un prodotto a codice a barre.
   */
  selection?: "explicit" | "name" | "product";
}

const ORIGIN_CERTAINTY: Record<CompositionOrigin, Certainty> = {
  label: "label",
  table: "estimated",
  derived: "estimated",
};

export function originCertainty(origin: CompositionOrigin): Certainty {
  return ORIGIN_CERTAINTY[origin];
}

/** La peggiore tra la certezza della quantità e quella dell'origine dei valori. */
export function combineCertainty(quantity: Certainty, origin: CompositionOrigin): Certainty {
  return worseCertainty(quantity, originCertainty(origin));
}

/** Evita residui come 0.30000000000000004. */
export const roundValue = (n: number): number => Math.round(n * 1e6) / 1e6;

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export type NotComputableReason =
  /** Quantità non finita o negativa. */
  | "invalid_quantity"
  /** Serve la densità (g/ml) per passare tra massa e volume. */
  | "missing_density"
  /** Serve il peso di un pezzo per passare dai pezzi alla massa. */
  | "missing_unit_weight"
  /** Densità o peso del pezzo non validi nella composizione. */
  | "invalid_composition"
  | "not_convertible";

export interface NutrientsOfQuantity {
  nutrients: NutrientAmounts;
  /** Quantità convertita nella base della composizione (g o ml). */
  amount: number;
  basis: "g" | "ml";
  /** Peggiore tra la certezza della quantità e quella dell'origine. */
  certainty: Certainty;
}

export type QuantityNutrientsResult =
  | { ok: true; value: NutrientsOfQuantity }
  | { ok: false; reason: NotComputableReason; message: string };

/**
 * Nutrienti di una quantità in unità base (g, ml, pz) di un alimento con composizione per 100 g o
 * 100 ml. Le conversioni usano `unitWeightG` e `densityGPerMl`; senza i dati necessari il risultato
 * è "non calcolabile" con il motivo. I nutrienti assenti nella composizione restano assenti.
 */
export function nutrientsOfQuantity(
  composition: ResolvedComposition,
  quantity: Quantity,
  quantityCertainty: Certainty,
): QuantityNutrientsResult {
  if (!isAmount(quantity.value)) {
    return { ok: false, reason: "invalid_quantity", message: "La quantità non è un numero valido." };
  }
  const converted = convert(quantity, composition.basis, {
    ...(composition.densityGPerMl !== undefined ? { density: composition.densityGPerMl } : {}),
    ...(composition.unitWeightG !== undefined ? { unitWeight: composition.unitWeightG } : {}),
  });
  if (!converted.ok) {
    const code = converted.error.code;
    const reason: NotComputableReason =
      code === "missing_density" || code === "missing_unit_weight"
        ? code
        : code === "invalid_value"
          ? "invalid_composition"
          : "not_convertible";
    return { ok: false, reason, message: converted.error.message };
  }
  const amount = converted.value.value;
  const nutrients: NutrientAmounts = {};
  for (const key of NUTRIENT_KEYS) {
    const per100 = composition.per100[key];
    if (isAmount(per100)) nutrients[key] = roundValue((per100 * amount) / 100);
  }
  return {
    ok: true,
    value: {
      nutrients,
      amount: roundValue(amount),
      basis: composition.basis,
      certainty: combineCertainty(quantityCertainty, composition.origin),
    },
  };
}

/** Un addendo di una somma. */
export interface SumPart {
  nutrients: NutrientAmounts;
  /** Assente per un addendo senza alcun dato (voce non risolta). */
  certainty?: Certainty;
  /**
   * Peso dell'addendo, usato solo per calcolare la quota mancante. Per semplicità 1 ml vale 1 g.
   * Se manca in uno degli addendi di un nutriente, la quota si calcola contando gli addendi.
   */
  weight?: number;
  /**
   * Nutrienti di cui l'addendo parla. Predefinito: tutti, quindi un nutriente assente è un dato
   * mancante. Un addendo con `scope` non rende parziali i nutrienti fuori da `scope`
   * (per esempio una bevanda che dichiara solo la caffeina).
   */
  scope?: readonly NutrientKey[];
}

export interface NutrientTotal {
  /** Somma dei soli addendi che hanno il dato. */
  value: number;
  /** Quota del totale per cui manca il dato, da 0 a 1. */
  missingShare: number;
  /** Come è calcolata `missingShare`: sul peso degli addendi o sul loro numero. */
  shareBy: "weight" | "count";
  /** Addendi senza il dato / addendi che avrebbero dovuto averlo. */
  missingCount: number;
  count: number;
  /** Vero se manca il dato in almeno un addendo: il valore è un minimo, non un totale. */
  partial: boolean;
  /** La peggiore certezza tra gli addendi che hanno contribuito. */
  certainty: Certainty;
}

/** Un nutriente senza alcun dato in nessun addendo non compare: è sconosciuto, non zero. */
export type NutrientTotals = Partial<Record<NutrientKey, NutrientTotal>>;

export interface NutrientSum {
  totals: NutrientTotals;
  /** Numero di addendi. */
  count: number;
  /** La peggiore certezza tra tutti gli addendi che portano dati; assente se nessuno ne porta. */
  certainty?: Certainty;
}

const isWeight = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w >= 0;

/**
 * Somma di quantità di nutrienti. Un nutriente assente in un addendo rende parziale il totale di
 * quel nutriente: si somma ciò che c'è e `missingShare` dice quanta parte del totale manca di dato.
 */
export function sumNutrients(parts: readonly SumPart[]): NutrientSum {
  const totals: NutrientTotals = {};
  let overall: Certainty | undefined;
  for (const p of parts) {
    if (p.certainty !== undefined && NUTRIENT_KEYS.some((k) => isAmount(p.nutrients[k]))) {
      overall = overall === undefined ? p.certainty : worseCertainty(overall, p.certainty);
    }
  }
  for (const key of NUTRIENT_KEYS) {
    let value = 0;
    let have = 0;
    let certainty: Certainty | undefined;
    const relevant = parts.filter((p) => p.scope === undefined || p.scope.includes(key));
    for (const p of relevant) {
      const v = p.nutrients[key];
      if (!isAmount(v)) continue;
      have++;
      value += v;
      if (p.certainty !== undefined) {
        certainty = certainty === undefined ? p.certainty : worseCertainty(certainty, p.certainty);
      }
    }
    if (have === 0) continue;
    const missing = relevant.filter((p) => !isAmount(p.nutrients[key]));
    const weighted = relevant.every((p) => isWeight(p.weight));
    const totalWeight = weighted ? relevant.reduce((s, p) => s + (p.weight as number), 0) : 0;
    const byWeight = weighted && totalWeight > 0;
    const share = byWeight
      ? missing.reduce((s, p) => s + (p.weight as number), 0) / totalWeight
      : missing.length / relevant.length;
    totals[key] = {
      value: roundValue(value),
      missingShare: roundValue(Math.min(1, Math.max(0, share))),
      shareBy: byWeight ? "weight" : "count",
      missingCount: missing.length,
      count: relevant.length,
      partial: missing.length > 0,
      certainty: certainty ?? "estimated",
    };
  }
  return { totals, count: parts.length, ...(overall !== undefined ? { certainty: overall } : {}) };
}
