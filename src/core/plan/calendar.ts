// Settimane di calendario: iniziano il lunedì. Tutto su date `YYYY-MM-DD`, senza fusi orari.

import { isCalendarDate } from "../ledger";
import { addDays } from "../diary";

/** Giorno della settimana di una data valida: 1 = lunedì ... 7 = domenica. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function isMonday(date: unknown): date is string {
  return isCalendarDate(date) && isoWeekday(date) === 1;
}

/** Lunedì della settimana che contiene `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/** I sette giorni di una settimana, da lunedì a domenica. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** La data cade nella settimana che inizia a `weekStart`. */
export function inWeek(weekStart: string, date: string): boolean {
  return date >= weekStart && date <= addDays(weekStart, 6);
}
