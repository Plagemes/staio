export type Dimension = "mass" | "volume" | "count";

export type MetricUnit = "g" | "kg" | "hg" | "mg" | "ml" | "cl" | "dl" | "l";
export type KitchenUnit = "cucchiaio" | "cucchiaino" | "tazza" | "bicchiere";
export type Unit = MetricUnit | KitchenUnit | "pz" | "pizzico" | "confezione";

export interface Quantity {
  value: number;
  unit: Unit;
}

export type UnitErrorCode =
  | "incompatible_dimensions"
  | "missing_density"
  | "missing_unit_weight"
  | "missing_package_size"
  | "not_convertible"
  | "invalid_value";

export interface UnitError {
  code: UnitErrorCode;
  message: string;
}

export type Result<T, E = UnitError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Dati opzionali necessari per le conversioni tra dimensioni diverse. */
export interface ConversionContext {
  /** Densità in g/ml. */
  density?: number;
  /** Peso di un pezzo in grammi. */
  unitWeight?: number;
  /** Contenuto di una confezione, in una qualunque unità convertibile. */
  packageSize?: Quantity;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err(code: UnitErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

interface UnitInfo {
  /** null: unità non riconducibile a una dimensione fissa (pizzico, confezione). */
  dimension: Dimension | null;
  /** Fattore verso l'unità base (g, ml, pz). */
  factor: number;
}

export const UNIT_INFO: Readonly<Record<Unit, UnitInfo>> = {
  mg: { dimension: "mass", factor: 0.001 },
  g: { dimension: "mass", factor: 1 },
  hg: { dimension: "mass", factor: 100 },
  kg: { dimension: "mass", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  cl: { dimension: "volume", factor: 10 },
  dl: { dimension: "volume", factor: 100 },
  l: { dimension: "volume", factor: 1000 },
  cucchiaino: { dimension: "volume", factor: 5 },
  cucchiaio: { dimension: "volume", factor: 15 },
  bicchiere: { dimension: "volume", factor: 200 },
  tazza: { dimension: "volume", factor: 240 },
  pz: { dimension: "count", factor: 1 },
  pizzico: { dimension: null, factor: 1 },
  confezione: { dimension: null, factor: 1 },
};

export const UNITS = Object.keys(UNIT_INFO) as Unit[];

export const BASE_UNIT: Readonly<Record<Dimension, Unit>> = {
  mass: "g",
  volume: "ml",
  count: "pz",
};

export function dimensionOf(unit: Unit): Dimension | null {
  return UNIT_INFO[unit].dimension;
}

/** Elimina gli artefatti della virgola mobile (0.1 + 0.2). */
export function clean(n: number): number {
  return Number.isFinite(n) ? Number(n.toPrecision(12)) : n;
}
