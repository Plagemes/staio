import type { Lot, PantryState } from "./derive";
import { instantMs } from "./time";
import {
  DISCARD_REASONS,
  worseCertainty,
  type Certainty,
  type DiscardReason,
  type Location,
  type Unit,
} from "./types";

export function getLot(state: PantryState, lotId: string): Lot | undefined {
  return state.lots.find((l) => l.lotId === lotId);
}

/** Lotti con quantità rimasta, in ordine di creazione. Con `location` solo quelli in quel luogo. */
export function activeLots(state: PantryState, location?: Location): Lot[] {
  return state.lots.filter(
    (l) => l.status === "active" && (location === undefined || l.location === location),
  );
}

export function activeLotsByLocation(state: PantryState): Record<Location, Lot[]> {
  const out: Record<Location, Lot[]> = { frigo: [], freezer: [], dispensa: [] };
  for (const l of activeLots(state)) out[l.location].push(l);
  return out;
}

export interface ProductTotal {
  productRef: string;
  unit: Unit;
  remaining: number;
  lots: number;
  /** La meno affidabile tra le certezze delle quantità rimaste. */
  certainty: Certainty;
}

/**
 * Totale rimasto per prodotto. Lo stesso prodotto in unità diverse (es. ml e pz)
 * resta in righe separate: convertire è compito del chiamante.
 */
export function totalsByProduct(state: PantryState): ProductTotal[] {
  const rows = new Map<string, ProductTotal>();
  for (const l of activeLots(state)) {
    const key = JSON.stringify([l.productRef, l.unit]);
    const row = rows.get(key);
    if (row) {
      row.remaining = Math.round((row.remaining + l.remaining) * 1e9) / 1e9;
      row.lots += 1;
      row.certainty = worseCertainty(row.certainty, l.remainingCertainty);
    } else {
      rows.set(key, {
        productRef: l.productRef,
        unit: l.unit,
        remaining: l.remaining,
        lots: 1,
        certainty: l.remainingCertainty,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      (a.productRef < b.productRef ? -1 : a.productRef > b.productRef ? 1 : 0) ||
      (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0),
  );
}

export function totalForProduct(state: PantryState, productRef: string, unit: Unit): number {
  return (
    totalsByProduct(state).find((t) => t.productRef === productRef && t.unit === unit)
      ?.remaining ?? 0
  );
}

/**
 * Valore della parte rimasta del lotto in centesimi: prezzo in proporzione a rimasto/iniziale
 * (mai oltre il prezzo pieno). `undefined` se il lotto non ha prezzo.
 */
export function lotValueCents(lot: Lot): number | undefined {
  if (lot.priceCents === undefined) return undefined;
  const ratio = Math.min(1, lot.remaining / lot.initial);
  return Math.round(lot.priceCents * ratio);
}

export interface PantryValue {
  cents: number;
  lotsWithPrice: number;
  /** Lotti attivi senza prezzo: non contano nel totale. */
  lotsWithoutPrice: number;
  certainty: Certainty;
}

export interface PantryValuePart {
  lot: Lot;
  /** Valore della parte rimasta, in centesimi interi (`lotValueCents`). */
  cents: number;
  /** La meno affidabile tra prezzo, quantità iniziale e quantità rimasta. */
  certainty: Certainty;
}

export interface PantryValueParts {
  /** Lotti attivi con prezzo, nell'ordine della dispensa. */
  parts: PantryValuePart[];
  /** Lotti attivi senza prezzo (compresi quelli «già in casa»): non contano nel totale. */
  missing: Lot[];
}

/**
 * Le parti del valore della dispensa, nello stesso ciclo che dà il totale: la somma dei `cents`
 * delle parti è esattamente `estimatedPantryValue(state).cents`.
 */
export function pantryValueParts(state: PantryState): PantryValueParts {
  const parts: PantryValuePart[] = [];
  const missing: Lot[] = [];
  for (const l of activeLots(state)) {
    const v = lotValueCents(l);
    if (v === undefined) {
      missing.push(l);
      continue;
    }
    parts.push({
      lot: l,
      cents: v,
      certainty: worseCertainty(
        l.priceCertainty ?? "estimated",
        worseCertainty(l.initialCertainty, l.remainingCertainty),
      ),
    });
  }
  return { parts, missing };
}

/** Valore stimato della dispensa: somma dei valori residui dei lotti attivi con prezzo. */
export function estimatedPantryValue(state: PantryState): PantryValue {
  const { parts, missing } = pantryValueParts(state);
  let cents = 0;
  let certainty: Certainty = "measured";
  for (const p of parts) {
    cents += p.cents;
    certainty = worseCertainty(certainty, p.certainty);
  }
  return { cents, lotsWithPrice: parts.length, lotsWithoutPrice: missing.length, certainty };
}

export interface WastePeriod {
  /** Istante ISO UTC, incluso. */
  from?: string;
  /** Istante ISO UTC, escluso. */
  to?: string;
}

export interface WasteEntry {
  reason: DiscardReason;
  unit: Unit;
  quantity: number;
  /** Numero di eventi di scarto che hanno scartato una quantità. */
  events: number;
  /** Costo stimato della parte buttata (prezzo del lotto in proporzione); solo lotti con prezzo. */
  costCents: number;
  certainty: Certainty;
}

/** `from` o `to` di un periodo non sono istanti ISO UTC validi. */
export class InvalidPeriodError extends RangeError {
  constructor(field: "from" | "to", value: unknown) {
    super(`wasteByReason: "${field}" is not a valid ISO UTC instant: ${String(value)}`);
    this.name = "InvalidPeriodError";
  }
}

/**
 * Spreco per motivo (e unità) nel periodo `[from, to)`, secondo la data `at` dello scarto.
 * Lancia `InvalidPeriodError` se `from` o `to` sono presenti ma non validi.
 * Il costo stimato di un lotto non supera mai il suo prezzo, nemmeno dopo un `adjust` verso l'alto.
 */
export function wasteByReason(state: PantryState, period: WastePeriod = {}): WasteEntry[] {
  let from = Number.NEGATIVE_INFINITY;
  let to = Number.POSITIVE_INFINITY;
  if (period.from !== undefined) {
    from = instantMs(period.from);
    if (Number.isNaN(from)) throw new InvalidPeriodError("from", period.from);
  }
  if (period.to !== undefined) {
    to = instantMs(period.to);
    if (Number.isNaN(to)) throw new InvalidPeriodError("to", period.to);
  }
  const buckets = new Map<string, WasteEntry & { cost: number }>();
  for (const lot of state.lots) {
    // Frazione di prezzo già "buttata" da tutti gli scarti del lotto (anche fuori periodo).
    let wastedFraction = 0;
    for (const h of lot.history) {
      if (h.type !== "discard" || h.reason === undefined) continue;
      const amount = -(h.quantityDelta ?? 0);
      if (amount <= 0) continue;
      const fraction = Math.min(amount / lot.initial, 1 - wastedFraction);
      wastedFraction += fraction;
      const at = instantMs(h.at);
      if (at < from || at >= to) continue;
      const key = `${h.reason}|${lot.unit}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          reason: h.reason,
          unit: lot.unit,
          quantity: 0,
          events: 0,
          costCents: 0,
          cost: 0,
          certainty: "measured",
        };
        buckets.set(key, b);
      }
      b.quantity = Math.round((b.quantity + amount) * 1e9) / 1e9;
      b.events += 1;
      b.certainty = worseCertainty(b.certainty, h.certainty);
      if (lot.priceCents !== undefined) {
        b.cost += lot.priceCents * fraction;
        b.certainty = worseCertainty(
          b.certainty,
          worseCertainty(lot.priceCertainty ?? "estimated", lot.initialCertainty),
        );
      }
    }
  }
  const order = (r: DiscardReason) => DISCARD_REASONS.indexOf(r);
  return [...buckets.values()]
    .map(({ cost, ...entry }) => ({ ...entry, costCents: Math.round(cost) }))
    .sort((a, b) => order(a.reason) - order(b.reason) || (a.unit < b.unit ? -1 : 1));
}
