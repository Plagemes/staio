// Storico dei prezzi per prodotto: prezzo per unità (€/kg, €/l, €/pezzo) nel tempo, ultimo,
// minimo, massimo e variazione rispetto a ciò che si pagava di solito. Parte dal libro dei prezzi
// già esistente in `shopping/prices`: qui solo la forma per prodotto, e con due acquisti bastano.
import type { PantryState, Unit } from "../ledger";
import { cmp, roundTo, streamId } from "../shopping/common";
import { buildPriceBook, unitPriceOf, type PriceObservation, type UnitPrice } from "../shopping/prices";

export interface PricePoint {
  date: string;
  /** Centesimi per kg, litro o pezzo. */
  cents: number;
}

export interface ProductPriceHistory {
  /** `chiave|unità`, come l'id di una voce della lista della spesa. */
  id: string;
  key: string;
  name: string;
  unit: Unit;
  per: UnitPrice["per"];
  observations: number;
  last: PricePoint & { store: string | null };
  /** Media ponderata sulla quantità dei prezzi precedenti l'ultimo («di solito»). */
  usual: UnitPrice;
  lowest: UnitPrice;
  highest: UnitPrice;
  /** Variazione percentuale dell'ultimo prezzo rispetto a `usual`, un decimale. */
  changePct: number;
  trend: "up" | "down" | "stable";
  /** Dal più vecchio al più recente. */
  points: PricePoint[];
}

export interface PriceHistoryResult {
  /** Prodotti con almeno due acquisti con prezzo nella stessa unità, i più recenti prima. */
  products: ProductPriceHistory[];
  /** Prodotti con prezzi in unità diverse (per esempio pezzi e grammi): non si confrontano. */
  notComparable: number;
  /** Prodotti con un solo acquisto con prezzo: niente storico. */
  singlePurchase: number;
}

export interface PriceHistoryOptions {
  /** Sotto questa variazione assoluta il prezzo è «stabile». Default 0.03. */
  stableBand?: number;
  timeZone?: string;
}

const toPoint = (o: PriceObservation): PricePoint => ({
  date: o.date,
  cents: unitPriceOf(o.centsPerBase, o.unit).cents,
});

export function buildPriceHistories(pantry: PantryState, options: PriceHistoryOptions = {}): PriceHistoryResult {
  const stableBand = options.stableBand ?? 0.03;
  const book = buildPriceBook(pantry, {
    minObservations: 2,
    stableBand,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const names = book.series.filter((s) => s.scope === "name" && s.storeKey === null);
  const unitsByKey = new Map<string, Set<Unit>>();
  for (const s of names) {
    const set = unitsByKey.get(s.id) ?? new Set<Unit>();
    set.add(s.unit);
    unitsByKey.set(s.id, set);
  }
  const products: ProductPriceHistory[] = [];
  let singlePurchase = 0;
  for (const s of names) {
    if ((unitsByKey.get(s.id)?.size ?? 0) > 1) continue;
    if (s.observations < 2) {
      singlePurchase += 1;
      continue;
    }
    const prev = s.history.slice(0, -1);
    const usualBase = prev.reduce((a, o) => a + o.totalCents, 0) / prev.reduce((a, o) => a + o.quantity, 0);
    const change = usualBase > 0 ? s.last.centsPerBase / usualBase - 1 : 0;
    products.push({
      id: streamId(s.id, s.unit),
      key: s.id,
      name: s.name,
      unit: s.unit,
      per: s.lastUnitPrice.per,
      observations: s.observations,
      last: { ...toPoint(s.last), store: s.last.store },
      usual: unitPriceOf(usualBase, s.unit),
      lowest: unitPriceOf(Math.min(...s.history.map((o) => o.centsPerBase)), s.unit),
      highest: unitPriceOf(Math.max(...s.history.map((o) => o.centsPerBase)), s.unit),
      changePct: roundTo(change * 100, 1),
      trend: Math.abs(change) < stableBand ? "stable" : change > 0 ? "up" : "down",
      points: s.history.map(toPoint),
    });
  }
  const notComparable = [...unitsByKey.values()].filter((u) => u.size > 1).length;
  products.sort((a, b) => cmp(b.last.date, a.last.date) || cmp(a.name, b.name));
  return { products, notComparable, singlePurchase };
}
