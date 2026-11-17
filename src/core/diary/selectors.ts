import { isIsoInstant, worseCertainty, type Certainty } from "../ledger";
import { addDays, dateRange, localMoment } from "./calendar";
import type { DiaryDay, DiaryDrink, DiaryHabit, DiaryState } from "./derive";
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
 * Stato di un momento del giorno (colazione, pranzo o cena):
 * - `recorded`: c'è almeno un pasto registrato (prevale su ogni dichiarazione).
 * - `skipped`: dichiarato «saltato». Dato vero: l'assunzione di quel momento è zero, misurata.
 * - `untracked`: «mangiato, non registrato». Il dato manca, la giornata è incompleta.
 * - `none`: niente di segnato. Il dato manca e non si sa altro: non è un digiuno.
 */
export type MealMomentStatus = "recorded" | "skipped" | "untracked" | "none";

export interface MealMoment {
  kind: MealKind;
  status: MealMomentStatus;
  /** Evento della dichiarazione che conta (`skipped`, o `untracked` da nuova dichiarazione). */
  declarationEventId?: string;
}

/** I tre momenti principali di un giorno, nell'ordine colazione, pranzo, cena. */
export function mealMoments(day: DiaryDay | undefined): MealMoment[] {
  return MAIN_MEAL_KINDS.map((kind): MealMoment => {
    if (day?.meals.some((m) => m.kind === kind)) return { kind, status: "recorded" };
    const decl = day?.declarations.find((d) => d.kind === kind && d.supersededBy === undefined);
    if (decl) return { kind, status: decl.status, declarationEventId: decl.eventId };
    if (day?.untrackedMeals.some((m) => m.kind === kind)) return { kind, status: "untracked" };
    return { kind, status: "none" };
  });
}

/**
 * Momento del giorno di un istante, dall'ora locale (minuti dalla mezzanotte): la stessa regola
 * con cui si propone il tipo di pasto. `snack` vale come «fuori pasto» (notte, metà pomeriggio, tardi).
 */
export function momentOfMinutes(minutes: number): MealKind {
  if (minutes < 5 * 60) return "snack";
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60 + 30) return "lunch";
  if (minutes < 18 * 60 + 30) return "snack";
  if (minutes < 23 * 60) return "dinner";
  return "snack";
}

export interface DrinksByMoment {
  breakfast: DiaryDrink[];
  lunch: DiaryDrink[];
  dinner: DiaryDrink[];
  /** Fuori dai tre momenti principali. */
  offMeal: DiaryDrink[];
}

/**
 * Le bevande del giorno divise per momento secondo la loro ora (stessa regola di `momentOfMinutes`),
 * in ordine di orario. Una bevanda non è un pasto: non cambia lo stato di un momento.
 */
export function drinksByMoment(day: DiaryDay | undefined, timeZone: string): DrinksByMoment {
  const out: DrinksByMoment = { breakfast: [], lunch: [], dinner: [], offMeal: [] };
  const sorted = [...(day?.drinks ?? [])].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.eventId < b.eventId ? -1 : 1,
  );
  for (const d of sorted) {
    const m = localMoment(d.at, timeZone);
    const kind = m ? momentOfMinutes(m.minutes) : "snack";
    if (kind === "snack") out.offMeal.push(d);
    else out[kind].push(d);
  }
  return out;
}

/** Sotto questa energia (kcal) una bevanda non interrompe l'intervallo senza cibo. */
export const DRINK_ENERGY_THRESHOLD_KCAL = 5;

/**
 * Una bevanda interrompe l'intervallo senza cibo se porta energia: alcol, zuccheri o energia dichiarata
 * da 5 kcal in su. `no` se dichiara un'energia sotto soglia (tè o caffè senza zucchero), `unknown` se
 * non dice nulla sull'energia: non si assume né che ne abbia né che non ne abbia.
 */
export function drinkBreaksFast(d: Pick<DiaryDrink, "energyKcal" | "alcoholG" | "sugarsG">): "yes" | "no" | "unknown" {
  if ((d.alcoholG ?? 0) > 0 || (d.sugarsG ?? 0) > 0) return "yes";
  if (d.energyKcal === undefined) return "unknown";
  return d.energyKcal >= DRINK_ENERGY_THRESHOLD_KCAL ? "yes" : "no";
}

export interface DayFluids {
  waterMl: number;
  /** Bevande senza alcol (tè, caffè, cola...). */
  otherMl: number;
  /** Bevande con alcol: si contano a parte, mai insieme all'acqua. */
  alcoholicMl: number;
}

/** Liquidi del giorno, distinti: acqua, altre bevande e bevande alcoliche. */
export function dayFluids(day: DiaryDay | undefined): DayFluids {
  let other = 0;
  let alcoholic = 0;
  for (const d of day?.drinks ?? []) {
    if ((d.alcoholG ?? 0) > 0) alcoholic += d.ml;
    else other += d.ml;
  }
  return { waterMl: day?.waterMl ?? 0, otherMl: norm(other), alcoholicMl: norm(alcoholic) };
}

/**
 * Contano solo colazione, pranzo e cena, una volta ciascuno; gli spuntini non contano.
 * - `complete`: ogni momento ha un pasto registrato o è dichiarato «saltato» (un dato vero).
 * - `declared`: ogni momento è registrato, saltato o dichiarato, ma almeno uno solo come
 *   «mangiato, non registrato»: incompleto ma dichiarato.
 * - `gaps`: manca almeno uno dei tre momenti, né registrato né dichiarato.
 */
export type DayCoverageStatus = "complete" | "declared" | "gaps";

export interface DayCoverage {
  date: string;
  status: DayCoverageStatus;
  /** Numero di pasti tracciati (di ogni tipo, spuntini compresi). */
  tracked: number;
  /** Numero di pasti segnati come non tracciati (vecchi eventi e dichiarazioni «non registrato» in vigore). */
  untracked: number;
  /** Tra colazione, pranzo e cena, i momenti dichiarati «saltati» e senza pasto registrato. */
  skipped: MealKind[];
  /** Tra colazione, pranzo e cena, i tipi senza né un pasto tracciato né una dichiarazione. */
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
  const declaredUntracked = (day?.declarations ?? []).filter(
    (d) => d.status === "untracked" && d.supersededBy === undefined,
  ).length;
  const untracked = (day?.untrackedMeals.length ?? 0) + declaredUntracked;
  const moments = mealMoments(day);
  const skipped = moments.filter((m) => m.status === "skipped").map((m) => m.kind);
  const missing = moments.filter((m) => m.status === "none").map((m) => m.kind);
  let status: DayCoverageStatus = "gaps";
  if (missing.length === 0) {
    status = moments.some((m) => m.status === "untracked") ? "declared" : "complete";
  }
  return { date, status, tracked, untracked, skipped, missing };
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
 * oggi esiste già un pasto di quel tipo, tracciato, segnato come non tracciato o dichiarato saltato.
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
  const doneKinds = new Set<MealKind>(
    mealMoments(today)
      .filter((m) => m.status !== "none")
      .map((m) => m.kind),
  );
  // Gli spuntini non hanno un momento dichiarabile: restano a parte.
  for (const m of today?.meals ?? []) doneKinds.add(m.kind);
  for (const m of today?.untrackedMeals ?? []) doneKinds.add(m.kind);

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
