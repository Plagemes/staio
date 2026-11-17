// Giorni di calendario in un fuso orario: l'istante UTC dell'evento diventa la data locale.

import { isCalendarDate, isIsoInstant } from "../ledger";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Lancia RangeError se il fuso non esiste.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone === "") return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface LocalMoment {
  /** Data di calendario `YYYY-MM-DD` nel fuso. */
  date: string;
  /** Minuti dalla mezzanotte locale, 0..1439. */
  minutes: number;
}

/** Data e ora locali di un istante ISO UTC. `undefined` se l'istante o il fuso non sono validi. */
export function localMoment(instant: string, timeZone: string): LocalMoment | undefined {
  if (!isIsoInstant(instant)) return undefined;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(new Date(instant));
  } catch {
    return undefined;
  }
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year").padStart(4, "0");
  const hour = Number(get("hour")) % 24;
  return {
    date: `${year}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

/** Data di calendario locale di un istante, o `undefined`. */
export function localDate(instant: string, timeZone: string): string | undefined {
  return localMoment(instant, timeZone)?.date;
}

const DAY_MS = 86_400_000;

function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Aggiunge (o toglie) giorni a una data di calendario valida. */
export function addDays(date: string, days: number): string {
  return utcMsToDate(dateToUtcMs(date) + days * DAY_MS);
}

/** Giorni interi da `from` a `to` (negativo se `to` precede `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);
}

/** Tutte le date da `from` a `to` inclusi; vuoto se non sono valide o `to` precede `from`. */
export function dateRange(from: string, to: string): string[] {
  if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return [];
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
