// Costo per nutriente: quanto costa il nutriente negli alimenti comprati con un prezzo. Solo un
// confronto, mai un consiglio. Per ogni prodotto conta l'ultimo acquisto con prezzo; ciò che
// non ha prezzo, composizione, peso o dato sul nutriente resta fuori e viene contato.
import { diffDays } from "../expiry";
import type { Certainty, Lot } from "../ledger";
import { worseCertainty } from "../ledger";
import { nutrientsOfQuantity, type NutrientKey, type ResolvedComposition } from "../nutrition";
import { calendarDateOf, cmp, normalizeName } from "../shopping/common";

export type CostNutrient = "protein" | "energy" | "fiber";

/** Termine di confronto: 100 g di proteine, 1000 kcal, 10 g di fibre. */
export const COST_BASIS: Record<CostNutrient, { key: NutrientKey; amount: number; unit: "g" | "kcal" }> = {
  protein: { key: "proteinG", amount: 100, unit: "g" },
  energy: { key: "energyKcal", amount: 1000, unit: "kcal" },
  fiber: { key: "fiberG", amount: 10, unit: "g" },
};

export interface NutrientCostRow {
  key: string;
  name: string;
  /** Centesimi per `COST_BASIS[nutrient].amount`, arrotondati. */
  cents: number;
  /** Prezzo del lotto da cui nasce il confronto e quantità di nutriente che contiene. */
  lotPriceCents: number;
  lotNutrient: number;
  /** Data di calendario dell'acquisto usato. */
  date: string;
  certainty: Certainty;
  /** Vero quando i valori vengono da una tabella o da una quantità stimata. */
  estimated: boolean;
}

export interface NutrientCostExcluded {
  /** Prodotti comprati ma mai con un prezzo. */
  noPrice: number;
  /** Prodotti con prezzo ma ultimo acquisto oltre `maxAgeDays`. */
  tooOld: number;
  /** Prodotti senza composizione riconosciuta. */
  noComposition: number;
  /** Quantità non convertibile (pezzi senza peso noto, volumi senza densità). */
  notComparable: number;
}

export interface NutrientCostResult {
  rankings: Record<CostNutrient, NutrientCostRow[]>;
  /** Prodotti con prezzo e composizione ma senza il dato su quel nutriente (o a zero). */
  noNutrientData: Record<CostNutrient, number>;
  excluded: NutrientCostExcluded;
  /** Prodotti acquistati nel registro, con o senza prezzo. */
  productCount: number;
}

export interface NutrientCostOptions {
  /** Oggi, `YYYY-MM-DD`; con `maxAgeDays` esclude i prezzi troppo vecchi. */
  today?: string;
  /** Default 180, come per le stime di costo della lista. */
  maxAgeDays?: number;
  timeZone?: string;
}

const NUTRIENTS = Object.keys(COST_BASIS) as CostNutrient[];

export function costPerNutrient(
  lots: readonly Lot[],
  compositionOf: (lot: Lot) => ResolvedComposition | undefined,
  options: NutrientCostOptions = {},
): NutrientCostResult {
  const maxAge = options.maxAgeDays ?? 180;
  const byProduct = new Map<string, { latestPriced?: Lot }>();
  for (const lot of lots) {
    if (lot.origin !== "purchase") continue;
    const key = normalizeName(lot.productRef);
    if (key === "") continue;
    const entry = byProduct.get(key) ?? {};
    byProduct.set(key, entry);
    if (lot.priceCents === undefined || !(lot.initial > 0)) continue;
    const cur = entry.latestPriced;
    if (!cur || cmp(lot.createdAt, cur.createdAt) > 0 || (lot.createdAt === cur.createdAt && cmp(lot.lotId, cur.lotId) > 0)) {
      entry.latestPriced = lot;
    }
  }

  const rankings: Record<CostNutrient, NutrientCostRow[]> = { protein: [], energy: [], fiber: [] };
  const exact = new Map<NutrientCostRow, number>();
  const noNutrientData: Record<CostNutrient, number> = { protein: 0, energy: 0, fiber: 0 };
  const excluded: NutrientCostExcluded = { noPrice: 0, tooOld: 0, noComposition: 0, notComparable: 0 };

  for (const [key, { latestPriced: lot }] of byProduct) {
    if (!lot || lot.priceCents === undefined) {
      excluded.noPrice += 1;
      continue;
    }
    const date = calendarDateOf(lot.createdAt, options.timeZone);
    if (options.today !== undefined && diffDays(options.today, date) > maxAge) {
      excluded.tooOld += 1;
      continue;
    }
    const comp = compositionOf(lot);
    if (!comp) {
      excluded.noComposition += 1;
      continue;
    }
    const r = nutrientsOfQuantity(comp, { value: lot.initial, unit: lot.unit }, lot.initialCertainty);
    if (!r.ok) {
      excluded.notComparable += 1;
      continue;
    }
    const certainty = worseCertainty(r.value.certainty, lot.priceCertainty ?? "estimated");
    for (const n of NUTRIENTS) {
      const total = r.value.nutrients[COST_BASIS[n].key];
      if (total === undefined || !(total > 0)) {
        noNutrientData[n] += 1;
        continue;
      }
      const perBasis = (lot.priceCents / total) * COST_BASIS[n].amount;
      const row: NutrientCostRow = {
        key,
        name: lot.productRef.trim(),
        cents: Math.round(perBasis),
        lotPriceCents: lot.priceCents,
        lotNutrient: total,
        date,
        certainty,
        estimated: certainty === "estimated",
      };
      exact.set(row, perBasis);
      rankings[n].push(row);
    }
  }
  for (const n of NUTRIENTS) {
    rankings[n].sort((a, b) => (exact.get(a) as number) - (exact.get(b) as number) || cmp(a.name, b.name));
  }
  return { rankings, noNutrientData, excluded, productCount: byProduct.size };
}
