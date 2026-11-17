import type { AnyEvent } from "../events";
import { DEFAULT_TIME_ZONE, daysBetween, isValidTimeZone, localDate } from "../diary";
import type { MealKind } from "../diary";

export const MEAL_NAMES: Record<MealKind, string> = {
  breakfast: "colazione",
  lunch: "pranzo",
  dinner: "cena",
  snack: "spuntino",
};

export const upperFirst = (s: string): string => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

export function zoneOf(timeZone: string | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** Quanto tempo fa, a parole: «ieri», «3 giorni fa». */
export function agoText(date: string, today: string): string {
  const n = daysBetween(date, today);
  if (n <= 0) return "oggi";
  return n === 1 ? "ieri" : `${n} giorni fa`;
}

/** Id degli eventi annullati. Un annullamento a sua volta annullato non vale (un livello basta). */
export function voidedIds(log: readonly AnyEvent[]): Set<string> {
  const voids = log.filter((e) => e.type === "void") as unknown as { id: string; targetEventId: string }[];
  const cancelled = new Set(voids.map((v) => v.targetEventId));
  return new Set(voids.filter((v) => !cancelled.has(v.id)).map((v) => v.targetEventId));
}

/** Giorno locale di un istante. */
export const dayOfInstant = (instant: string, timeZone: string): string => localDate(instant, timeZone) ?? instant.slice(0, 10);
