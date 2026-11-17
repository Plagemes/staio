// Istanti ISO 8601 UTC e date di calendario, con validazione rigorosa.

// Solo il formato prodotto da Date.toISOString (millisecondi opzionali, esattamente 3 cifre):
// frazioni di lunghezza variabile non hanno un parsing uniforme tra motori.
const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Data di calendario `YYYY-MM-DD` esistente (es. rifiuta 2026-02-30). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  return isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Istante ISO 8601 UTC esistente, con suffisso `Z`. */
export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = INSTANT_RE.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  return isValidYmd(y, mo, d) && h <= 23 && mi <= 59 && s <= 59;
}

/** Millisecondi dall'epoca, oppure NaN se l'istante non è valido. */
export function instantMs(value: unknown): number {
  return isIsoInstant(value) ? Date.parse(value) : Number.NaN;
}
