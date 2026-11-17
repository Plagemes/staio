import { isIsoInstant, worseCertainty, type Certainty } from "../ledger";
import { addDays, dateRange, localMoment } from "./calendar";
import type { DiaryDay, DiaryHabit, DiaryState } from "./derive";
import { MAIN_MEAL_KINDS, type MealKind } from "./types";

const norm = (n: number): number => Math.round(n * 1e6) / 1e6;

export function getDay(state: DiaryState, date: string): DiaryDay | undefined {
  return state.days.find((d) => d.date === date);
}

export interface DateRangeOptions {
  /** Primo giorno incluso (`YYYY-MM-DD`). Predefinito: primo giorno dello stato. */
  from?: string;
  /** Ultimo giorno incluso. Predefinito: ultimo giorno dello stato. */
  to?: string;
}

function resolveRange(state: DiaryState, options: DateRangeOptions): string[] {
  if (state.days.length === 0) return [];
  const from = options.from ?? state.days[0].date;
  const to = options.to ?? state.days[state.days.length - 1].date;
  return dateRange(from, to);
}

export interface WeightPoint {
  date: string;
  kg: number;
  certainty: Certainty;
}

/** Una pesata per giorno (l'ultima del giorno), in ordine di data. */
export function weightSeries(state: DiaryState, options: DateRangeOptions = {}): WeightPoint[] {
  const out: WeightPoint[] = [];
  for (const day of state.days) {
    if (options.from !== undefined && day.date < options.from) continue;
    if (options.to !== undefined && day.date > options.to) continue;
    const last = day.weights[day.weights.length - 1];
    if (last) out.push({ date: day.date, kg: last.kg, certainty: last.certainty });
  }
  return out;
}

export interface WeightAveragePoint {
  date: string;
  /** Media dei pesi giornalieri nella finestra, arrotondata a 6 decimali. */
  kg: number;
  /** Giorni con una pesata dentro la finestra. */
  samples: number;
  /** La meno affidabile tra le certezze dei pesi mediati. */
  certainty: Certainty;
}

export interface MovingAverageOptions extends DateRangeOptions {
  /**
   * Ampiezza in giorni di calendario, il giorno stesso incluso (parte intera, da 1 a 36500).
   * Un valore non valido (NaN, zero, negativo, infinito, non numerico) ricade su 7.
   */
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 36_500;

function normalizeWindow(value: unknown): number {
  if (typeof value !== "number") return DEFAULT_WINDOW_DAYS;
  const days = Math.floor(value);
  return Number.isFinite(days) && days >= 1 ? Math.min(days, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
}

/**
 * Media mobile del peso: per ogni giorno con una pesata, la media dei pesi giornalieri
 * dei `windowDays` giorni che finiscono in quel giorno. I giorni senza pesata non contano
 * (non sono zeri) e la finestra non si allarga per compensarli.
 */
export function weightMovingAverage(
  state: DiaryState,
  options: MovingAverageOptions = {},
): WeightAveragePoint[] {
  const windowDays = normalizeWindow(options.windowDays);
  const series = weightSeries(state);
  const out: WeightAveragePoint[] = [];
  for (const point of series) {
    if (options.from !== undefined && point.date < options.from) continue;
    if (options.to !== undefined && point.date > options.to) continue;
    const start = addDays(point.date, -(windowDays - 1));
    let sum = 0;
    let samples = 0;
    let certainty: Certainty = point.certainty;
    for (const p of series) {
      if (p.date < start || p.date > point.date) continue;
      sum += p.kg;
      samples++;
      certainty = worseCertainty(certainty, p.certainty);
    }
    out.push({ date: point.date, kg: norm(sum / samples), samples, certainty });
  }
  return out;
}

export interface WaterDay {
  date: string;
  ml: number;
  certainty?: Certainty;
}

/** Acqua per giorno su tutto l'intervallo: un giorno senza acqua registrata vale 0. */
export function waterByDay(state: DiaryState, options: DateRangeOptions = {}): WaterDay[] {
  const byDate = new Map(state.days.map((d) => [d.date, d]));
  return resolveRange(state, options).map((date) => {
    const day = byDate.get(date);
    return {
      date,
      ml: day?.waterMl ?? 0,
      ...(day?.waterCertainty !== undefined ? { certainty: day.waterCertainty } : {}),
    };
  });
}

/**
 * Contano solo colazione, pranzo e cena, una volta ciascuno; gli spuntini non contano.
 * - `complete`: colazione, pranzo e cena tutti tracciati.
 * - `declared`: i tre tipi sono tutti presenti ma almeno uno solo come pasto non tracciato:
 *   incompleto ma dichiarato.
 * - `gaps`: manca almeno uno dei tre tipi, né tracciato né dichiarato.
 */
export type DayCoverageStatus = "complete" | "declared" | "gaps";

export interface DayCoverage {
  date: string;
  status: DayCoverageStatus;
  /** Numero di pasti tracciati (di ogni tipo, spuntini compresi). */
  tracked: number;
  /** Numero di pasti segnati come non tracciati. */
  untracked: number;
  /** Tra colazione, pranzo e cena, i tipi senza né un pasto tracciato né uno dichiarato. */
  missing: MealKind[];
}

export interface Coverage {
  days: DayCoverage[];
  complete: number;
  declared: number;
  gaps: number;
}

export function dayCoverage(day: DiaryDay | undefined, date: string): DayCoverage {
  const tracked = day?.meals.length ?? 0;
  const untracked = day?.untrackedMeals.length ?? 0;
  const trackedKinds = new Set<MealKind>((day?.meals ?? []).map((m) => m.kind));
  const declaredKinds = new Set<MealKind>((day?.untrackedMeals ?? []).map((m) => m.kind));
  const missing = MAIN_MEAL_KINDS.filter((k) => !trackedKinds.has(k) && !declaredKinds.has(k));
  let status: DayCoverageStatus = "gaps";
  if (missing.length === 0) {
    status = MAIN_MEAL_KINDS.every((k) => trackedKinds.has(k)) ? "complete" : "declared";
  }
  return { date, status, tracked, untracked, missing };
}

/** Giorni completamente tracciati contro giorni con vuoti; i giorni senza alcuna voce sono vuoti. */
export function trackingCoverage(state: DiaryState, options: DateRangeOptions = {}): Coverage {
  const byDate = new Map(state.days.map((d) => [d.date, d]));
  const days = resolveRange(state, options).map((date) => dayCoverage(byDate.get(date), date));
  return {
    days,
    complete: days.filter((d) => d.status === "complete").length,
    declared: days.filter((d) => d.status === "declared").length,
    gaps: days.filter((d) => d.status === "gaps").length,
  };
}

export interface HabitProposalOptions {
  /** Distanza massima in minuti dall'ora abituale. Predefinito 90. */
  windowMinutes?: number;
}

// Ora di riferimento dei pasti abituali senza `usualTime`.
const DEFAULT_MEAL_MINUTES: Record<MealKind, number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
  snack: 16 * 60,
};

const parseTime = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Distanza tra due orari del giorno, in minuti, passando eventualmente per la mezzanotte. */
function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
}

/**
 * Pasti abituali da proporre a un certo istante (ISO UTC, letto nel fuso dello stato):
 * quelli con ora abituale (o, in mancanza, quella tipica del tipo di pasto) entro la finestra.
 * Si salta un pasto abituale già fatto oggi, e per colazione, pranzo e cena anche quando
 * oggi esiste già un pasto di quel tipo, tracciato o segnato come non tracciato.
 * Ordinati dal più vicino all'ora.
 */
export function habitsToPropose(
  state: DiaryState,
  at: string,
  options: HabitProposalOptions = {},
): DiaryHabit[] {
  if (!isIsoInstant(at)) return [];
  const now = localMoment(at, state.timeZone);
  if (!now) return [];
  const windowMinutes = options.windowMinutes ?? 90;
  const today = state.days.find((d) => d.date === now.date);
  const doneHabits = new Set(
    (today?.meals ?? []).flatMap((m) => (m.habitId !== undefined ? [m.habitId] : [])),
  );
  const doneKinds = new Set<MealKind>([
    ...(today?.meals ?? []).map((m) => m.kind),
    ...(today?.untrackedMeals ?? []).map((m) => m.kind),
  ]);

  const scored: { habit: DiaryHabit; distance: number }[] = [];
  for (const habit of state.habits) {
    if (doneHabits.has(habit.habitId)) continue;
    if (habit.kind !== "snack" && doneKinds.has(habit.kind)) continue;
    const reference =
      habit.usualTime !== undefined ? parseTime(habit.usualTime) : DEFAULT_MEAL_MINUTES[habit.kind];
    const distance = circularDistance(now.minutes, reference);
    if (distance <= windowMinutes) scored.push({ habit, distance });
  }
  scored.sort(
    (a, b) =>
      a.distance - b.distance ||
      (a.habit.habitId < b.habit.habitId ? -1 : a.habit.habitId > b.habit.habitId ? 1 : 0),
  );
  return scored.map((s) => s.habit);
}
