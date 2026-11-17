// Storico prezzi: dagli acquisti del libro mastro, per prodotto (nome normalizzato e codice a barre)
// e per negozio. Con poche osservazioni lo dice: nessuna media inventata.
import { diffDays } from "../expiry";
import type { Certainty, Lot, PantryState, Unit } from "../ledger";
import { worseCertainty } from "../ledger";
import {
  DEFAULT_TIME_ZONE,
  calendarDateOf,
  cmp,
  normalizeName,
  round9,
  roundTo,
} from "./common";

export interface PriceObservation {
  lotId: string;
  /** Data di calendario dell'acquisto. */
  date: string;
  /** Istante ISO dell'acquisto. */
  at: string;
  store: string | null;
  storeKey: string | null;
  totalCents: number;
  quantity: number;
  unit: Unit;
  /** Centesimi per grammo, millilitro o pezzo (non arrotondato). */
  centsPerBase: number;
  certainty: Certainty;
}

/** Prezzo per unità di misura "da scaffale": al kg, al litro, al pezzo. Centesimi interi. */
export interface UnitPrice {
  cents: number;
  per: "kg" | "l" | "pz";
}

export type PriceTrend = "up" | "down" | "stable" | "insufficient";

export interface PriceSeries {
  scope: "name" | "barcode";
  /** Nome normalizzato oppure codice a barre. */
  id: string;
  /** Nome del prodotto come scritto nell'ultimo acquisto. */
  name: string;
  unit: Unit;
  /** `null`: tutti i negozi insieme. */
  storeKey: string | null;
  store: string | null;
  observations: number;
  /** Osservazioni sufficienti per medie, minimo e andamento. */
  sufficient: boolean;
  last: PriceObservation;
  lastUnitPrice: UnitPrice;
  /** Media ponderata sulla quantità; `null` se le osservazioni non bastano. */
  averageUnitPrice: UnitPrice | null;
  lowestUnitPrice: UnitPrice | null;
  highestUnitPrice: UnitPrice | null;
  trend: PriceTrend;
  /** Variazione dell'ultimo prezzo rispetto alla media dei precedenti; `null` se non calcolabile. */
  changePct: number | null;
  certainty: Certainty;
  history: PriceObservation[];
}

export interface PriceBook {
  series: PriceSeries[];
  /** Negozi osservati, come scritti, in ordine alfabetico della chiave. */
  stores: string[];
  /** Lotti d'acquisto senza prezzo: non entrano nello storico. */
  lotsWithoutPrice: number;
}

export interface PriceOptions {
  /** Osservazioni minime per media, minimo/massimo e andamento. Default 3. */
  minObservations?: number;
  /** Variazione sotto cui il prezzo è "stabile". Default 0.03 (3%). */
  stableBand?: number;
  timeZone?: string;
}

export function unitPriceOf(centsPerBase: number, unit: Unit): UnitPrice {
  if (unit === "pz") return { cents: Math.round(centsPerBase), per: "pz" };
  return { cents: Math.round(centsPerBase * 1000), per: unit === "g" ? "kg" : "l" };
}

function observationOf(lot: Lot, timeZone: string): PriceObservation | null {
  if (lot.origin !== "purchase") return null;
  if (lot.priceCents === undefined || !(lot.initial > 0)) return null;
  const store = lot.store?.trim() ? lot.store.trim() : null;
  return {
    lotId: lot.lotId,
    date: calendarDateOf(lot.createdAt, timeZone),
    at: lot.createdAt,
    store,
    storeKey: store === null ? null : normalizeName(store) || null,
    totalCents: lot.priceCents,
    quantity: lot.initial,
    unit: lot.unit,
    centsPerBase: lot.priceCents / lot.initial,
    certainty: worseCertainty(lot.priceCertainty ?? "estimated", lot.initialCertainty),
  };
}

function summarize(
  scope: "name" | "barcode",
  id: string,
  name: string,
  unit: Unit,
  storeKey: string | null,
  store: string | null,
  obs: PriceObservation[],
  minObservations: number,
  stableBand: number,
): PriceSeries {
  const history = [...obs].sort((a, b) => cmp(a.at, b.at) || cmp(a.lotId, b.lotId));
  const last = history[history.length - 1];
  const sufficient = history.length >= minObservations;
  let average: UnitPrice | null = null;
  let lowest: UnitPrice | null = null;
  let highest: UnitPrice | null = null;
  let trend: PriceTrend = "insufficient";
  let changePct: number | null = null;
  if (sufficient) {
    const totalCents = history.reduce((s, o) => s + o.totalCents, 0);
    const totalQty = history.reduce((s, o) => s + o.quantity, 0);
    average = unitPriceOf(totalCents / totalQty, unit);
    const rates = history.map((o) => o.centsPerBase);
    lowest = unitPriceOf(Math.min(...rates), unit);
    highest = unitPriceOf(Math.max(...rates), unit);
    const previous = history.slice(0, -1).map((o) => o.centsPerBase);
    const prevAvg = previous.reduce((s, v) => s + v, 0) / previous.length;
    if (prevAvg > 0) {
      const change = last.centsPerBase / prevAvg - 1;
      changePct = roundTo(change * 100, 1);
      trend = Math.abs(change) < stableBand ? "stable" : change > 0 ? "up" : "down";
    }
  }
  return {
    scope,
    id,
    name,
    unit,
    storeKey,
    store,
    observations: history.length,
    sufficient,
    last,
    lastUnitPrice: unitPriceOf(last.centsPerBase, unit),
    averageUnitPrice: average,
    lowestUnitPrice: lowest,
    highestUnitPrice: highest,
    trend,
    changePct,
    certainty: last.certainty,
    history,
  };
}

/**
 * Costruisce lo storico prezzi dagli acquisti. Le serie sono tre per ogni prodotto e unità:
 * tutti i negozi, e una per ciascun negozio osservato; per nome normalizzato e, quando i lotti
 * lo hanno, per codice a barre. Unità diverse (g, ml, pz) restano serie separate: nessuna
 * conversione senza densità né peso del pezzo.
 */
export function buildPriceBook(state: PantryState, options: PriceOptions = {}): PriceBook {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const minObservations = options.minObservations ?? 3;
  const stableBand = options.stableBand ?? 0.03;

  interface Group {
    scope: "name" | "barcode";
    id: string;
    unit: Unit;
    storeKey: string | null;
    obs: PriceObservation[];
    name: string;
    store: string | null;
  }
  const groups = new Map<string, Group>();
  const storeLabels = new Map<string, string>();
  let lotsWithoutPrice = 0;

  const add = (
    scope: "name" | "barcode",
    id: string,
    lot: Lot,
    o: PriceObservation,
    storeKey: string | null,
  ) => {
    const gk = `${scope}|${id}|${lot.unit}|${storeKey ?? ""}`;
    let g = groups.get(gk);
    if (!g) {
      g = { scope, id, unit: lot.unit, storeKey, obs: [], name: lot.productRef.trim(), store: null };
      groups.set(gk, g);
    }
    g.obs.push(o);
    g.name = lot.productRef.trim();
    g.store = storeKey === null ? null : (o.store ?? g.store);
  };

  // `state.lots` è già ordinato in modo deterministico: l'ultimo nome/negozio scritto vince.
  for (const lot of state.lots) {
    if (lot.origin !== "purchase") continue;
    const o = observationOf(lot, timeZone);
    if (!o) {
      if (lot.priceCents === undefined) lotsWithoutPrice += 1;
      continue;
    }
    const key = normalizeName(lot.productRef);
    if (o.storeKey !== null && o.store !== null) storeLabels.set(o.storeKey, o.store);
    const targets: Array<["name" | "barcode", string]> = [];
    if (key !== "") targets.push(["name", key]);
    if (lot.barcode) targets.push(["barcode", lot.barcode]);
    for (const [scope, id] of targets) {
      add(scope, id, lot, o, null);
      if (o.storeKey !== null) add(scope, id, lot, o, o.storeKey);
    }
  }

  const series = [...groups.values()]
    .map((g) =>
      summarize(
        g.scope,
        g.id,
        g.name,
        g.unit,
        g.storeKey,
        g.storeKey === null ? null : (storeLabels.get(g.storeKey) ?? g.store),
        g.obs,
        minObservations,
        stableBand,
      ),
    )
    .sort(
      (a, b) =>
        cmp(a.scope, b.scope) ||
        cmp(a.id, b.id) ||
        cmp(a.unit, b.unit) ||
        cmp(a.storeKey ?? "", b.storeKey ?? ""),
    );

  const stores = [...storeLabels.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, v]) => v);
  return { series, stores, lotsWithoutPrice };
}

export interface PriceQuery {
  /** Nome normalizzato del prodotto. */
  key: string;
  barcode?: string;
  unit: Unit;
  /** Negozio (nome come scritto o normalizzato); assente = tutti i negozi. */
  store?: string;
}

const indexCache = new WeakMap<PriceBook, Map<string, PriceSeries>>();

function indexOf(book: PriceBook): Map<string, PriceSeries> {
  let idx = indexCache.get(book);
  if (!idx) {
    idx = new Map();
    for (const s of book.series) {
      idx.set(`${s.scope}|${s.id}|${s.unit}|${s.storeKey ?? ""}`, s);
    }
    indexCache.set(book, idx);
  }
  return idx;
}

/** Serie del prodotto: il codice a barre, se c'è una serie, ha la precedenza sul nome. */
export function findSeries(book: PriceBook, query: PriceQuery): PriceSeries | undefined {
  const idx = indexOf(book);
  const storeKey = query.store === undefined ? "" : normalizeName(query.store);
  if (query.store !== undefined && storeKey === "") return undefined;
  if (query.barcode) {
    const byBarcode = idx.get(`barcode|${query.barcode}|${query.unit}|${storeKey}`);
    if (byBarcode) return byBarcode;
  }
  return idx.get(`name|${query.key}|${query.unit}|${storeKey}`);
}

/** Una serie per ciascun negozio in cui il prodotto è stato comprato, in ordine di negozio. */
export function seriesByStore(book: PriceBook, query: Omit<PriceQuery, "store">): PriceSeries[] {
  const out: PriceSeries[] = [];
  for (const label of book.stores) {
    const s = findSeries(book, { ...query, store: label });
    if (s) out.push(s);
  }
  return out;
}

export interface PriceAgeOptions {
  /** Oggi, `YYYY-MM-DD`. Senza, l'età dei prezzi non è valutata e nessun prezzo è vecchio. */
  today?: string;
  /** Oltre questa età (giorni) il prezzo è marcato come vecchio. Default 60. */
  staleAfterDays?: number;
  /** Oltre questa età (giorni) il prezzo non viene usato. Default 180. */
  maxAgeDays?: number;
}

export interface UsablePrice {
  series: PriceSeries;
  /** Data di calendario dell'ultimo prezzo osservato. */
  date: string;
  /** `null` se non è stata indicata la data di oggi. */
  ageDays: number | null;
  stale: boolean;
}

/**
 * Serie da usare per un confronto, con l'età dell'ultimo prezzo. `undefined` se non c'è
 * una serie oppure se l'ultimo prezzo è più vecchio di `maxAgeDays` (e quindi non va usato).
 */
export function findUsablePrice(
  book: PriceBook,
  query: PriceQuery,
  age: PriceAgeOptions = {},
): UsablePrice | undefined {
  const series = findSeries(book, query);
  if (!series) return undefined;
  const date = series.last.date;
  if (age.today === undefined) return { series, date, ageDays: null, stale: false };
  const ageDays = Math.max(0, diffDays(age.today, date));
  if (ageDays > (age.maxAgeDays ?? 180)) return undefined;
  return { series, date, ageDays, stale: ageDays > (age.staleAfterDays ?? 60) };
}

export interface CostEstimate {
  /** Costo stimato in centesimi interi, dall'ultimo prezzo osservato. */
  cents: number;
  /** Data dell'ultimo prezzo osservato. */
  date: string;
  ageDays: number | null;
  /** Il prezzo è più vecchio della soglia: la stima è meno affidabile. */
  stale: boolean;
  store: string | null;
  unitPrice: UnitPrice;
  observations: number;
  via: "name" | "barcode";
  certainty: Certainty;
  /** Il costo non è mai una media: è l'ultimo prezzo osservato. */
  basis: "last";
}

export function estimateCost(
  book: PriceBook,
  query: PriceQuery,
  quantity: number,
  age: PriceAgeOptions = {},
): CostEstimate | null {
  const u = findUsablePrice(book, query, age);
  if (!u) return null;
  const s = u.series;
  return {
    date: u.date,
    ageDays: u.ageDays,
    stale: u.stale,
    cents: Math.round(round9(s.last.centsPerBase * quantity)),
    store: s.last.store,
    unitPrice: s.lastUnitPrice,
    observations: s.observations,
    via: s.scope,
    certainty: s.certainty,
    basis: "last",
  };
}
