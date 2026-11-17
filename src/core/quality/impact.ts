// Peso reale dei prodotti nella dieta: da quanto e quanto spesso si consumano, quali portano di più
// a zuccheri, sale, grassi saturi e al numero di prodotti molto lavorati (NOVA 4), e quali pochi cambi
// sposterebbero di più quei totali. Un nutriente che manca non vale zero: il totale è dichiarato
// parziale e si dice quante voci lo portano.

import type { Product } from "../catalog";
import { isAmount, productLabel } from "./common";

export interface ConsumptionEntry {
  product: Product;
  /** Quantità a ogni consumo, nell'unità del prodotto. */
  amount: number;
  unit: "g" | "ml";
  /** Quante volte alla settimana. */
  timesPerWeek: number;
}

export type ImpactMetric = "sugars" | "salt" | "saturatedFat" | "ultraProcessed";

export const IMPACT_METRICS: readonly ImpactMetric[] = ["sugars", "salt", "saturatedFat", "ultraProcessed"];

export interface Contributor {
  barcode: string;
  name: string;
  /** Grammi a settimana; per `ultraProcessed`, consumi a settimana. */
  perWeek: number;
  /** Quota del totale, da 0 a 1. */
  share: number;
}

export interface MetricImpact {
  metric: ImpactMetric;
  unit: "g" | "occasions";
  /** Totale a settimana sulle voci con il dato: se `complete` è falso è solo una parte. */
  totalPerWeek: number;
  /** Prodotti distinti con il dato (solo `ultraProcessed`: i prodotti NOVA 4). */
  distinctProducts?: number;
  entriesWithData: number;
  entriesTotal: number;
  /** Tutte le voci portano il dato. */
  complete: boolean;
  contributors: Contributor[];
}

export interface ImpactChange {
  barcode: string;
  name: string;
  /** Che cosa cambia togliendo del tutto il prodotto (dimezzare la frequenza sposta la metà). */
  effects: Array<{ metric: ImpactMetric; perWeek: number; share: number }>;
}

export interface ImpactReport {
  metrics: Record<ImpactMetric, MetricImpact>;
  changes: ImpactChange[];
  /** Voci scartate perché quantità o frequenza non sono valide. */
  excluded: Array<{ barcode: string; reason: string }>;
}

export interface ImpactOptions {
  /** Quanti prodotti contributori elencare per metrica. Predefinito 5. */
  topContributors?: number;
  /** Quanti cambi proporre. Predefinito 3. */
  maxChanges?: number;
}

const NUTRIENT_FIELD = { sugars: "sugars", salt: "salt", saturatedFat: "saturatedFat" } as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface Line {
  barcode: string;
  name: string;
  perWeek: number;
}

/** Contributo a settimana di una voce a una metrica, o `undefined` se il dato manca. */
function contribution(entry: ConsumptionEntry, metric: ImpactMetric): number | undefined {
  const p = entry.product;
  if (metric === "ultraProcessed") {
    if (p.nova === undefined) return undefined;
    return p.nova === 4 ? entry.timesPerWeek : 0;
  }
  const n = p.nutrients;
  if (!n) return undefined;
  const v = n[NUTRIENT_FIELD[metric]];
  if (!isAmount(v)) return undefined;
  const expected = entry.unit === "g" ? "100g" : "100ml";
  // Senza densità non si passa da grammi a millilitri: la voce non porta il dato.
  if (n.per !== expected) return undefined;
  return (v * entry.amount * entry.timesPerWeek) / 100;
}

export function dietImpact(entries: readonly ConsumptionEntry[], options: ImpactOptions = {}): ImpactReport {
  const top = options.topContributors ?? 5;
  const maxChanges = options.maxChanges ?? 3;
  const excluded: ImpactReport["excluded"] = [];
  const valid: ConsumptionEntry[] = [];
  for (const e of entries) {
    if (!isAmount(e.amount) || e.amount <= 0) {
      excluded.push({ barcode: e.product.barcode, reason: "Quantità non valida." });
    } else if (!isAmount(e.timesPerWeek) || e.timesPerWeek <= 0) {
      excluded.push({ barcode: e.product.barcode, reason: "Frequenza non valida." });
    } else {
      valid.push(e);
    }
  }

  const metrics = {} as Record<ImpactMetric, MetricImpact>;
  const lineByMetric = {} as Record<ImpactMetric, Map<string, Line>>;
  for (const metric of IMPACT_METRICS) {
    const lines = new Map<string, Line>();
    let withData = 0;
    for (const e of valid) {
      const c = contribution(e, metric);
      if (c === undefined) continue;
      withData += 1;
      const prev = lines.get(e.product.barcode);
      if (prev) prev.perWeek += c;
      else lines.set(e.product.barcode, { barcode: e.product.barcode, name: productLabel(e.product), perWeek: c });
    }
    lineByMetric[metric] = lines;
    const total = [...lines.values()].reduce((s, l) => s + l.perWeek, 0);
    const contributors: Contributor[] = [...lines.values()]
      .filter((l) => l.perWeek > 0)
      .sort((a, b) => b.perWeek - a.perWeek || a.name.localeCompare(b.name))
      .slice(0, top)
      .map((l) => ({ barcode: l.barcode, name: l.name, perWeek: round2(l.perWeek), share: total > 0 ? round2(l.perWeek / total) : 0 }));
    metrics[metric] = {
      metric,
      unit: metric === "ultraProcessed" ? "occasions" : "g",
      totalPerWeek: round2(total),
      ...(metric === "ultraProcessed" ? { distinctProducts: [...lines.values()].filter((l) => l.perWeek > 0).length } : {}),
      entriesWithData: withData,
      entriesTotal: valid.length,
      complete: withData === valid.length,
      contributors,
    };
  }

  const barcodes = new Map<string, string>();
  for (const e of valid) barcodes.set(e.product.barcode, productLabel(e.product));
  const changes: ImpactChange[] = [];
  for (const [barcode, name] of barcodes) {
    const effects: ImpactChange["effects"] = [];
    for (const metric of IMPACT_METRICS) {
      const line = lineByMetric[metric].get(barcode);
      const total = [...lineByMetric[metric].values()].reduce((s, l) => s + l.perWeek, 0);
      if (line && line.perWeek > 0 && total > 0) {
        effects.push({ metric, perWeek: round2(line.perWeek), share: round2(line.perWeek / total) });
      }
    }
    if (effects.length > 0) changes.push({ barcode, name, effects });
  }
  const best = (c: ImpactChange) => Math.max(...c.effects.map((e) => e.share));
  changes.sort((a, b) => best(b) - best(a) || a.name.localeCompare(b.name));

  return { metrics, changes: changes.slice(0, maxChanges), excluded };
}
