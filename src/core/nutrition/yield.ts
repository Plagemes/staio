// Rese di cottura: solo il meccanismo. Le rese (per esempio "la pasta secca raddoppia") sono dati
// passati da chi chiama; qui non ce n'è nessuna.

import { roundValue, type ResolvedComposition } from "./amounts";
import { NUTRIENT_KEYS, type NutrientAmounts } from "./types";

/** Resa in peso di un alimento tra crudo (o secco) e cotto. */
export interface YieldRule {
  /** Id dell'alimento a cui si applica (`FoodComposition.id`). */
  foodId: string;
  /** Peso cotto diviso peso crudo: 2,2 significa che 100 g crudi diventano 220 g cotti. */
  cookedPerRaw: number;
  /** Metodo di cottura, se la resa dipende da esso (per esempio "bollitura"). */
  method?: string;
  note?: string;
  source?: { body: string; document: string; url?: string };
}

export type YieldDirection = "toCooked" | "toRaw";

export const isValidYieldFactor = (cookedPerRaw: number): boolean =>
  Number.isFinite(cookedPerRaw) && cookedPerRaw > 0;

/** Resa per un alimento, se nota. Con più regole per lo stesso alimento serve `method`. */
export function findYield(
  rules: readonly YieldRule[],
  foodId: string,
  method?: string,
): YieldRule | undefined {
  const forFood = rules.filter((r) => r.foodId === foodId && isValidYieldFactor(r.cookedPerRaw));
  if (method !== undefined) return forFood.find((r) => r.method === method);
  const first = forFood[0];
  return first && forFood.every((r) => r.cookedPerRaw === first.cookedPerRaw) ? first : undefined;
}

/**
 * Peso dopo il passaggio di stato. `undefined` se il peso o la resa non sono validi.
 * `toCooked`: da crudo a cotto; `toRaw`: da cotto a crudo.
 */
export function applyYield(
  weightG: number,
  cookedPerRaw: number,
  direction: YieldDirection,
): number | undefined {
  if (!Number.isFinite(weightG) || weightG < 0 || !isValidYieldFactor(cookedPerRaw)) return undefined;
  return roundValue(direction === "toCooked" ? weightG * cookedPerRaw : weightG / cookedPerRaw);
}

/**
 * Composizione dopo il passaggio di stato, per 100 g del nuovo stato. Ipotesi: la variazione di
 * peso è solo acqua e gli altri nutrienti si conservano (nessuna perdita di cottura). Va dichiarata
 * all'utente: il risultato è `derived`, cioè una stima. Solo per composizioni per 100 g.
 * Pezzo e densità non si portano dietro, perché cambiano con la cottura.
 */
export function convertCompositionState(
  composition: ResolvedComposition,
  cookedPerRaw: number,
  direction: YieldDirection,
): ResolvedComposition | undefined {
  if (composition.basis !== "g" || !isValidYieldFactor(cookedPerRaw)) return undefined;
  const ratio = direction === "toCooked" ? cookedPerRaw : 1 / cookedPerRaw;
  const per100: NutrientAmounts = {};
  for (const key of NUTRIENT_KEYS) {
    const v = composition.per100[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    if (key === "waterG") {
      const water = (v + 100 * (ratio - 1)) / ratio;
      if (water >= 0 && water <= 100) per100[key] = roundValue(water);
    } else {
      per100[key] = roundValue(v / ratio);
    }
  }
  return {
    name: composition.name,
    ...(composition.ref !== undefined ? { ref: composition.ref } : {}),
    origin: "derived",
    basis: "g",
    per100,
  };
}
