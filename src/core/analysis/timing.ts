// Orari dei pasti: finestra alimentare, cene tardive, ultima caffeina, regolarità.
// Solo giorni tracciati per intero: in un giorno con vuoti un pasto mancante falserebbe gli orari.

import { dateRange, localMoment, type DiaryDay, type DiaryState } from "../diary";
import {
  basisOf,
  freshnessOf,
  freshnessWarnings,
  insufficient,
  inRange,
  isFullyTracked,
  reliabilityBySize,
  type DataBasis,
  type Freshness,
  type Insufficient,
  type Reliability,
  type ReliabilitySteps,
} from "./common";
import { mean, median, round, sampleSd } from "./stats";

export interface TimingOptions {
  from?: string;
  to?: string;
  /** Giorni completi minimi. Predefinito 7. */
  minCompleteDays?: number;
  /**
   * Ora (minuti dalla mezzanotte locale) da cui una cena è "tardiva". Scelta di progetto, non una
   * soglia clinica: predefinito 21:00 (1260).
   */
  lateDinnerFromMinutes?: number;
  /**
   * Oggi (`YYYY-MM-DD`), per sapere se il risultato è datato: senza `today` si confronta l'ultimo
   * giorno usato con `to`, se passato. Senza nessuno dei due la freschezza non è verificabile.
   */
  today?: string;
  /** Giorni tra l'ultimo giorno usato e la data di riferimento oltre i quali il risultato è datato. Predefinito 7. */
  staleToleranceDays?: number;
  /** Soglie dei giorni completi per l'affidabilità. Predefinito moderata da 14, buona da 28. */
  reliabilitySteps?: ReliabilitySteps;
}

export interface TimingDay {
  date: string;
  /** Minuti dalla mezzanotte locale. */
  firstMealMinutes: number;
  lastMealMinutes: number;
  /** Durata della finestra alimentare del giorno, in minuti. */
  windowMinutes: number;
  mealCount: number;
  /** Ora dell'ultima cena del giorno, se tracciata. */
  dinnerMinutes?: number;
  lateDinner: boolean;
  /** Ora dell'ultima bevanda con caffeina registrata nel giorno. */
  lastCaffeineMinutes?: number;
}

export interface MinutesSummary {
  mean: number;
  median: number;
  sd: number;
  n: number;
}

export type TimingInsufficientReason = "no_data" | "few_complete_days";

export interface TimingResult {
  status: "ok";
  days: TimingDay[];
  /** Orario del primo pasto. */
  firstMeal: MinutesSummary;
  /** Orario dell'ultimo pasto. */
  lastMeal: MinutesSummary;
  /** Durata della finestra alimentare. */
  eatingWindow: MinutesSummary;
  lateDinner: { days: number; of: number; share: number; fromMinutes: number };
  /**
   * Ultima caffeina: solo i giorni con almeno una bevanda con caffeina registrata. Un giorno senza
   * non dice che non c'è stata caffeina, può non essere stata registrata.
   */
  lastCaffeine?: MinutesSummary;
  daysWithoutCaffeineRecord: number;
  /** Variabilità degli orari tra i giorni (deviazione standard, in minuti): più è bassa, più è regolare. */
  regularity: { firstMealSdMinutes: number; lastMealSdMinutes: number; windowSdMinutes: number };
  reliability: Reliability;
  basis: DataBasis;
  /** Quanto è recente l'ultimo giorno usato. Se `dated`, non descrive le abitudini attuali. */
  freshness: Freshness;
  warnings: string[];
}

export type TimingAnalysis =
  | TimingResult
  | (Insufficient<TimingInsufficientReason> & { completeDays: number });

function summary(values: readonly number[]): MinutesSummary {
  return {
    mean: round(mean(values), 1),
    median: round(median(values), 1),
    sd: round(sampleSd(values), 1),
    n: values.length,
  };
}

/** Formatta minuti dalla mezzanotte come `HH:MM`. */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Orari di un giorno dai suoi pasti e dalle sue bevande; `undefined` se non ha pasti con un orario valido. */
export function timingOfDay(day: DiaryDay, timeZone: string, lateFromMinutes: number): TimingDay | undefined {
  const meals = day.meals
    .map((m) => ({ kind: m.kind, minutes: localMoment(m.at, timeZone)?.minutes }))
    .filter((m): m is { kind: typeof m.kind; minutes: number } => m.minutes !== undefined);
  if (meals.length === 0) return undefined;
  const minutes = meals.map((m) => m.minutes);
  const first = Math.min(...minutes);
  const last = Math.max(...minutes);
  const dinners = meals.filter((m) => m.kind === "dinner").map((m) => m.minutes);
  const caffeine = day.drinks
    .filter((d) => (d.caffeineMg ?? 0) > 0)
    .map((d) => localMoment(d.at, timeZone)?.minutes)
    .filter((m): m is number => m !== undefined);
  const dinner = dinners.length > 0 ? Math.max(...dinners) : undefined;
  return {
    date: day.date,
    firstMealMinutes: first,
    lastMealMinutes: last,
    windowMinutes: last - first,
    mealCount: meals.length,
    ...(dinner !== undefined ? { dinnerMinutes: dinner } : {}),
    lateDinner: dinner !== undefined && dinner >= lateFromMinutes,
    ...(caffeine.length > 0 ? { lastCaffeineMinutes: Math.max(...caffeine) } : {}),
  };
}

export function analyzeMealTiming(diary: DiaryState, options: TimingOptions = {}): TimingAnalysis {
  const minDays = options.minCompleteDays ?? 7;
  const lateFrom = options.lateDinnerFromMinutes ?? 21 * 60;
  const steps = options.reliabilitySteps ?? { moderate: 14, good: 28 };

  const dates = diary.days.map((d) => d.date);
  const from = options.from ?? dates[0];
  const to = options.to ?? dates[dates.length - 1];
  if (from === undefined || to === undefined) {
    return { ...insufficient(["no_data"], basisOf(0, 0, 0), "nessun giorno nel diario."), completeDays: 0 };
  }
  const periodDays = dateRange(from, to).length;

  const days: TimingDay[] = [];
  for (const day of diary.days) {
    if (!inRange(day.date, from, to) || !isFullyTracked(day, day.date)) continue;
    const td = timingOfDay(day, diary.timeZone, lateFrom);
    if (td) days.push(td);
  }

  const lastDataDate = days[days.length - 1]?.date;
  const basis = basisOf(periodDays, days.length, days.length, { lastDataDate });
  const freshness = freshnessOf(lastDataDate, options.today ?? options.to, options.staleToleranceDays ?? 7);
  if (days.length < minDays) {
    return {
      ...insufficient(
        ["few_complete_days"],
        basis,
        `servono almeno ${minDays} giorni tracciati per intero, ce ne sono ${days.length}.`,
      ),
      completeDays: days.length,
    };
  }

  const withDinner = days.filter((d) => d.dinnerMinutes !== undefined);
  const lateDays = withDinner.filter((d) => d.lateDinner).length;
  const caffeineTimes = days.flatMap((d) => (d.lastCaffeineMinutes !== undefined ? [d.lastCaffeineMinutes] : []));
  const firsts = days.map((d) => d.firstMealMinutes);
  const lasts = days.map((d) => d.lastMealMinutes);
  const windows = days.map((d) => d.windowMinutes);

  return {
    status: "ok",
    days,
    firstMeal: summary(firsts),
    lastMeal: summary(lasts),
    eatingWindow: summary(windows),
    lateDinner: {
      days: lateDays,
      of: withDinner.length,
      share: withDinner.length > 0 ? round(lateDays / withDinner.length, 3) : 0,
      fromMinutes: lateFrom,
    },
    ...(caffeineTimes.length > 0 ? { lastCaffeine: summary(caffeineTimes) } : {}),
    daysWithoutCaffeineRecord: days.length - caffeineTimes.length,
    regularity: {
      firstMealSdMinutes: round(sampleSd(firsts), 1),
      lastMealSdMinutes: round(sampleSd(lasts), 1),
      windowSdMinutes: round(sampleSd(windows), 1),
    },
    reliability: reliabilityBySize(days.length, steps),
    basis,
    freshness,
    warnings: freshnessWarnings(freshness),
  };
}
