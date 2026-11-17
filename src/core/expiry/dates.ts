/** Aritmetica su date di calendario 'YYYY-MM-DD', senza fusi orari (tutto in UTC). */

const DAY_MS = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string): number {
  const m = PATTERN.exec(value);
  if (!m) throw new Error(`Data non valida: ${value}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Data non valida: ${value}`);
  }
  return ms;
}

function format(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  return format(parseDate(date) + days * DAY_MS);
}

/** Somma mesi; se il giorno non esiste nel mese di arrivo si ferma all'ultimo giorno del mese. */
export function addMonths(date: string, months: number): string {
  const ms = parseDate(date);
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return format(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

/** Giorni da `from` a `to` (positivo se `to` è successivo). */
export function diffDays(to: string, from: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

export const DEFAULT_TIME_ZONE = "Europe/Rome";

/**
 * Data di calendario di `now`. Una stringa 'YYYY-MM-DD' resta com'è; un istante (ISO 8601 o Date)
 * viene convertito nel giorno locale del fuso `timeZone`.
 */
export function toCalendarDate(now: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (typeof now === "string" && PATTERN.test(now)) {
    parseDate(now);
    return now;
  }
  const instant = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(instant.getTime())) throw new Error(`Istante non valido: ${String(now)}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}
