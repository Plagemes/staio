import { convert } from "./convert";
import {
  clean,
  dimensionOf,
  err,
  ok,
  type ConversionContext,
  type Quantity,
  type Result,
} from "./types";

/** Riporta b nell'unità di a, solo se le due quantità hanno la stessa dimensione. */
function align(a: Quantity, b: Quantity, ctx: ConversionContext): Result<Quantity> {
  if (a.unit !== b.unit) {
    const da = dimensionOf(a.unit);
    const db = dimensionOf(b.unit);
    if (da !== null && db !== null && da !== db) {
      return err("incompatible_dimensions", "Le quantità hanno dimensioni diverse.");
    }
  }
  return convert(b, a.unit, ctx);
}

/** Il risultato è espresso nell'unità di a. */
export function add(a: Quantity, b: Quantity, ctx: ConversionContext = {}): Result<Quantity> {
  const r = align(a, b, ctx);
  if (!r.ok) return r;
  return ok({ value: clean(a.value + r.value.value), unit: a.unit });
}

/** Il risultato è espresso nell'unità di a e può essere negativo. */
export function subtract(
  a: Quantity,
  b: Quantity,
  ctx: ConversionContext = {},
): Result<Quantity> {
  const r = align(a, b, ctx);
  if (!r.ok) return r;
  return ok({ value: clean(a.value - r.value.value), unit: a.unit });
}

export function scale(q: Quantity, factor: number): Result<Quantity> {
  if (!Number.isFinite(q.value) || !Number.isFinite(factor)) {
    return err("invalid_value", "Valore o fattore non finito.");
  }
  return ok({ value: clean(q.value * factor), unit: q.unit });
}

/** -1 se a < b, 0 se uguali (entro la tolleranza numerica), 1 se a > b. */
export function compare(
  a: Quantity,
  b: Quantity,
  ctx: ConversionContext = {},
): Result<-1 | 0 | 1> {
  const r = align(a, b, ctx);
  if (!r.ok) return r;
  const diff = a.value - r.value.value;
  const tolerance = 1e-9 * Math.max(Math.abs(a.value), Math.abs(r.value.value));
  if (Math.abs(diff) <= tolerance) return ok(0);
  return ok(diff < 0 ? -1 : 1);
}
