import {
  BASE_UNIT,
  UNIT_INFO,
  clean,
  err,
  ok,
  type ConversionContext,
  type Dimension,
  type Quantity,
  type Result,
  type Unit,
} from "./types";

interface Base {
  dimension: Dimension;
  amount: number;
}

function positive(
  v: number | undefined,
  missing: "missing_density" | "missing_unit_weight",
  label: string,
): Result<number> {
  if (v === undefined) return err(missing, `Manca ${label}.`);
  if (!Number.isFinite(v) || v <= 0) {
    return err("invalid_value", `${label} deve essere un numero positivo.`);
  }
  return ok(v);
}

function toMass(amount: number, from: Dimension, ctx: ConversionContext): Result<number> {
  if (from === "mass") return ok(amount);
  if (from === "volume") {
    const d = positive(ctx.density, "missing_density", "la densità");
    return d.ok ? ok(amount * d.value) : d;
  }
  const w = positive(ctx.unitWeight, "missing_unit_weight", "il peso unitario");
  return w.ok ? ok(amount * w.value) : w;
}

function fromMass(grams: number, to: Dimension, ctx: ConversionContext): Result<number> {
  if (to === "mass") return ok(grams);
  if (to === "volume") {
    const d = positive(ctx.density, "missing_density", "la densità");
    return d.ok ? ok(grams / d.value) : d;
  }
  const w = positive(ctx.unitWeight, "missing_unit_weight", "il peso unitario");
  return w.ok ? ok(grams / w.value) : w;
}

function convertDimension(
  amount: number,
  from: Dimension,
  to: Dimension,
  ctx: ConversionContext,
): Result<number> {
  if (from === to) return ok(amount);
  const mass = toMass(amount, from, ctx);
  return mass.ok ? fromMass(mass.value, to, ctx) : mass;
}

function toBase(q: Quantity, ctx: ConversionContext): Result<Base> {
  if (q.unit === "pizzico") {
    return err("not_convertible", "Il pizzico non è convertibile.");
  }
  if (q.unit === "confezione") {
    if (!ctx.packageSize) {
      return err("missing_package_size", "Manca la dimensione della confezione.");
    }
    const inner = toBase(ctx.packageSize, {});
    if (!inner.ok) return inner;
    return ok({ dimension: inner.value.dimension, amount: inner.value.amount * q.value });
  }
  const dimension = UNIT_INFO[q.unit].dimension as Dimension;
  return ok({ dimension, amount: q.value * UNIT_INFO[q.unit].factor });
}

function fromBase(base: Base, to: Unit, ctx: ConversionContext): Result<Quantity> {
  if (to === "pizzico") {
    return err("not_convertible", "Il pizzico non è convertibile.");
  }
  if (to === "confezione") {
    if (!ctx.packageSize) {
      return err("missing_package_size", "Manca la dimensione della confezione.");
    }
    const size = toBase(ctx.packageSize, {});
    if (!size.ok) return size;
    if (size.value.amount <= 0) {
      return err("invalid_value", "La dimensione della confezione deve essere positiva.");
    }
    const amount = convertDimension(base.amount, base.dimension, size.value.dimension, ctx);
    if (!amount.ok) return amount;
    return ok({ value: clean(amount.value / size.value.amount), unit: to });
  }
  const target = UNIT_INFO[to].dimension as Dimension;
  const amount = convertDimension(base.amount, base.dimension, target, ctx);
  if (!amount.ok) return amount;
  return ok({ value: clean(amount.value / UNIT_INFO[to].factor), unit: to });
}

/** Converte in un'altra unità; dimensioni diverse richiedono i dati nel contesto. */
export function convert(
  q: Quantity,
  to: Unit,
  ctx: ConversionContext = {},
): Result<Quantity> {
  if (!Number.isFinite(q.value)) {
    return err("invalid_value", "La quantità non è un numero finito.");
  }
  if (q.unit === to) return ok({ value: clean(q.value), unit: to });
  const base = toBase(q, ctx);
  return base.ok ? fromBase(base.value, to, ctx) : base;
}

/** Porta la quantità all'unità base della sua dimensione (g, ml, pz). */
export function normalize(q: Quantity, ctx: ConversionContext = {}): Result<Quantity> {
  if (!Number.isFinite(q.value)) {
    return err("invalid_value", "La quantità non è un numero finito.");
  }
  const base = toBase(q, ctx);
  if (!base.ok) return base;
  return ok({ value: clean(base.value.amount), unit: BASE_UNIT[base.value.dimension] });
}
