// Settimane e giorni del piano: etichette in italiano su date di calendario `YYYY-MM-DD`. Logica pura.
import { addDays, daysBetween } from "@/core/diary";
import { weekStartOf } from "@/core/plan";

const capitalize = (s: string) => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", ...options });
const WEEKDAY = fmt({ weekday: "long" });
const DAY_MONTH = fmt({ day: "numeric", month: "short" });

const at = (date: string): Date => new Date(`${date}T12:00:00Z`);

/** "lunedì" */
export function weekdayName(date: string): string {
  return WEEKDAY.format(at(date));
}

/** "16 nov" */
export function dayMonth(date: string): string {
  return DAY_MONTH.format(at(date)).replace(/\./g, "");
}

/** "Lunedì 16 nov", con "oggi" o "domani" quando serve. */
export function dayHeading(date: string, today: string): string {
  const base = `${capitalize(weekdayName(date))} ${dayMonth(date)}`;
  const d = daysBetween(today, date);
  return d === 0 ? `${base}, oggi` : d === 1 ? `${base}, domani` : base;
}

/** "16 nov – 22 nov" */
export function weekRangeText(weekStart: string): string {
  return `${dayMonth(weekStart)} – ${dayMonth(addDays(weekStart, 6))}`;
}

export type WeekId = "previous" | "current" | "next";

export interface WeekChoice {
  id: WeekId;
  start: string;
  label: string;
}

export const WEEK_LABELS: Record<WeekId, string> = { previous: "Scorsa", current: "Questa", next: "Prossima" };

/** La settimana scorsa, quella corrente e la successiva, a partire da oggi. */
export function weekChoices(today: string): WeekChoice[] {
  const current = weekStartOf(today);
  return [
    { id: "previous", start: addDays(current, -7), label: WEEK_LABELS.previous },
    { id: "current", start: current, label: WEEK_LABELS.current },
    { id: "next", start: addDays(current, 7), label: WEEK_LABELS.next },
  ];
}

/** "serve giovedì", "serve oggi", "serve il 24 nov": quando una data cade rispetto a oggi. */
export function whenText(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d <= 0) return "oggi";
  if (d === 1) return "domani";
  if (d <= 6) return weekdayName(date);
  return `il ${dayMonth(date)}`;
}
