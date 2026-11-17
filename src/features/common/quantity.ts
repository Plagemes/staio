// Il campo «Altra quantità»: passi dei tasti «−» e «+» e lettura del numero scritto a mano. Logica pura.

export type QuantityUnit = "g" | "ml" | "pz";

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Il passo più piccolo per quell'unità: sotto non si scende con i tasti. */
function minStep(unit: QuantityUnit): number {
  return unit === "pz" ? 1 : unit === "g" ? 10 : 50;
}

/** Di quanto cambia la quantità a ogni tocco, a partire da `value`: 1 pz; 10 g sotto i 200 g e 50 g da 200 in su; 50 ml. */
export function stepFor(unit: QuantityUnit, value: number): number {
  if (unit === "pz") return 1;
  if (unit === "ml") return 50;
  return value >= 200 ? 50 : 10;
}

/**
 * La quantità dopo un tocco su «+» (`1`) o «−» (`-1`). Si ferma sui multipli del passo (da 155 g: 160 in su, 150 in giù),
 * non scende sotto il passo minimo e non supera `max`. Senza un numero valido di partenza conta da zero.
 * «−» non fa mai salire: un valore già sotto il passo minimo resta com'è.
 */
export function nudge(unit: QuantityUnit, value: number | null, direction: 1 | -1, max?: number): number {
  const from = value !== null && Number.isFinite(value) && value > 0 ? value : 0;
  const least = minStep(unit);
  let next: number;
  if (direction === 1) {
    const step = stepFor(unit, from);
    next = round((Math.floor(round(from / step)) + 1) * step);
  } else {
    // in discesa vale il passo della fascia in cui si entra: da 200 g si va a 190, non a 150
    const step = stepFor(unit, from - least / 1000);
    next = round((Math.ceil(round(from / step)) - 1) * step);
    if (next < least) next = from > 0 ? Math.min(from, least) : least;
  }
  if (max !== undefined && Number.isFinite(max) && max > 0 && next > max) next = max;
  return next;
}

/**
 * Il numero scritto nel campo; `null` se non è un numero o se non si capisce quale sia.
 * La virgola è sempre il separatore decimale. Il punto seguito da esattamente tre cifre è quello delle migliaia, all'italiana
 * («1.500» è 1500, «1.500,5» è 1500,5); altrimenti è il separatore decimale («1.5» è 1,5, «0.500» è 0,5).
 * Ciò che resta ambiguo («1234.567», «1,500.5») si rifiuta invece di indovinare.
 */
export function readAmount(text: string): number | null {
  const clean = text.trim();
  let plain: string;
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d*)?$/.test(clean)) plain = clean.replace(/\./g, "").replace(",", ".");
  else if (/^\d+\.\d{3}$/.test(clean) && !clean.startsWith("0.")) return null;
  else if (/^(\d+([.,]\d*)?|[.,]\d+)$/.test(clean)) plain = clean.replace(",", ".");
  else return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/** Il numero come lo si scrive nel campo: con la virgola. */
export function writeAmount(value: number): string {
  return String(round(value)).replace(".", ",");
}
