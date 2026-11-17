// Intervalli senza cibo tra due momenti in cui si è mangiato. Contano solo i giorni tracciati per
// intero: un momento senza dati (o «mangiato, non registrato») non dice se si è mangiato, quindi
// non si trasforma in un intervallo. Un momento dichiarato «saltato» è un dato vero e allunga
// l'intervallo reale. Una bevanda con energia (alcol, zuccheri, 5 kcal o più) interrompe
// l'intervallo come un pasto; tè e caffè senza zucchero no.

import {
  addDays,
  dateRange,
  drinkBreaksFast,
  localMoment,
  mealMoments,
  type DiaryState,
  type MealKind,
} from "../diary";
import { isFullyTracked } from "./common";
import { median, round } from "./stats";

export interface FoodFreeInterval {
  /** Istante dell'ultimo pasto o bevanda con energia prima dell'intervallo. */
  from: string;
  /** Istante del pasto o della bevanda con energia che lo chiude. */
  to: string;
  fromDate: string;
  toDate: string;
  minutes: number;
  /** Momenti dichiarati «saltati» dentro l'intervallo (colazione, pranzo o cena). */
  skipped: MealKind[];
  /** Bevande senza energia dichiarata dentro l'intervallo: non si sa se lo interrompono. */
  unknownDrinks: number;
}

export interface FoodFreeIntervalsOptions {
  from?: string;
  to?: string;
}

export interface FoodFreeIntervals {
  intervals: FoodFreeInterval[];
  /** Giorni dell'intervallo di date che non sono tracciati per intero: non producono intervalli. */
  excludedDays: number;
  longestMinutes?: number;
  medianMinutes?: number;
  /** Intervalli che contengono almeno un momento saltato. */
  withSkipped: number;
}

interface Point {
  at: string;
  ms: number;
  date: string;
  /** Minuti dalla mezzanotte locale. */
  minutes: number;
}

// Ore tipiche con cui si colloca un momento saltato rispetto ai pasti che lo circondano.
const REFERENCE_MINUTES: Record<MealKind, number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
  snack: 16 * 60,
};

const pointOf = (iso: string, tz: string): Point | undefined => {
  const m = localMoment(iso, tz);
  return m ? { at: iso, ms: Date.parse(iso), date: m.date, minutes: m.minutes } : undefined;
};

/** `(date, minutes)` precede strettamente `b`. */
const before = (date: string, minutes: number, b: Point): boolean =>
  date < b.date || (date === b.date && minutes < b.minutes);

export function foodFreeIntervals(diary: DiaryState, options: FoodFreeIntervalsOptions = {}): FoodFreeIntervals {
  const dates = diary.days.map((d) => d.date);
  const from = options.from ?? dates[0];
  const to = options.to ?? dates[dates.length - 1];
  if (from === undefined || to === undefined) return { intervals: [], excludedDays: 0, withSkipped: 0 };
  const byDate = new Map(diary.days.map((d) => [d.date, d]));
  const range = dateRange(from, to);
  const tracked = new Set(range.filter((d) => isFullyTracked(byDate.get(d), d)));

  const points: Point[] = [];
  const unknownDrinks: Point[] = [];
  const skippedByDate = new Map<string, MealKind[]>();
  for (const date of range) {
    if (!tracked.has(date)) continue;
    const day = byDate.get(date)!;
    for (const m of day.meals) {
      const p = pointOf(m.at, diary.timeZone);
      if (p) points.push(p);
    }
    for (const dr of day.drinks) {
      const kind = drinkBreaksFast(dr);
      const p = pointOf(dr.at, diary.timeZone);
      if (!p) continue;
      if (kind === "yes") points.push(p);
      else if (kind === "unknown") unknownDrinks.push(p);
    }
    const skipped = mealMoments(day)
      .filter((m) => m.status === "skipped")
      .map((m) => m.kind);
    if (skipped.length > 0) skippedByDate.set(date, skipped);
  }
  points.sort((a, b) => a.ms - b.ms || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const intervals: FoodFreeInterval[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    // Ogni giorno da un estremo all'altro deve essere tracciato per intero.
    let valid = true;
    const skipped: MealKind[] = [];
    for (let d = a.date; d <= b.date; d = addDays(d, 1)) {
      if (!tracked.has(d)) {
        valid = false;
        break;
      }
      for (const kind of skippedByDate.get(d) ?? []) {
        const ref = REFERENCE_MINUTES[kind];
        if (!before(d, ref, a) && before(d, ref, b)) skipped.push(kind);
      }
    }
    if (!valid) continue;
    intervals.push({
      from: a.at,
      to: b.at,
      fromDate: a.date,
      toDate: b.date,
      minutes: Math.round((b.ms - a.ms) / 60000),
      skipped,
      unknownDrinks: unknownDrinks.filter((u) => u.ms > a.ms && u.ms < b.ms).length,
    });
  }

  const minutes = intervals.map((x) => x.minutes);
  return {
    intervals,
    excludedDays: range.length - tracked.size,
    ...(minutes.length > 0
      ? { longestMinutes: Math.max(...minutes), medianMinutes: round(median(minutes), 1) }
      : {}),
    withSkipped: intervals.filter((x) => x.skipped.length > 0).length,
  };
}
