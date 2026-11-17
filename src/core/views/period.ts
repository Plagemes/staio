// Periodi ammessi per le interrogazioni: un elenco chiuso, tutti relativi a oggi.
import { addDays, daysBetween } from "../diary";

export const PERIODS = ["today", "last_7_days", "last_14_days", "last_30_days", "last_90_days", "this_month", "last_month"] as const;
export type PeriodId = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodId, string> = {
  today: "oggi",
  last_7_days: "ultimi 7 giorni",
  last_14_days: "ultimi 14 giorni",
  last_30_days: "ultimi 30 giorni",
  last_90_days: "ultimi 90 giorni",
  this_month: "questo mese",
  last_month: "mese scorso",
};

export interface Period {
  id: PeriodId;
  /** Primo giorno incluso. */
  from: string;
  /** Ultimo giorno incluso. */
  to: string;
  /** Giorni di calendario del periodo. */
  days: number;
  label: string;
}

export const isPeriodId = (value: unknown): value is PeriodId => typeof value === "string" && (PERIODS as readonly string[]).includes(value);

const LAST_DAYS: Partial<Record<PeriodId, number>> = { today: 1, last_7_days: 7, last_14_days: 14, last_30_days: 30, last_90_days: 90 };

/** Primo giorno del mese di `date`. */
const monthStart = (date: string): string => `${date.slice(0, 8)}01`;

export function resolvePeriod(id: PeriodId, today: string): Period {
  const n = LAST_DAYS[id];
  let from: string;
  let to = today;
  if (n !== undefined) from = addDays(today, -(n - 1));
  else if (id === "this_month") from = monthStart(today);
  else {
    to = addDays(monthStart(today), -1);
    from = monthStart(to);
  }
  return { id, from, to, days: daysBetween(from, to) + 1, label: PERIOD_LABELS[id] };
}

export const inRange = (date: string | undefined, period: Pick<Period, "from" | "to">): boolean =>
  date !== undefined && date >= period.from && date <= period.to;
