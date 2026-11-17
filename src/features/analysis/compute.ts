// Calcolo delle analisi della pagina: chiama il motore con finestre e soglie dichiarate in `config`,
// ancorate a oggi, e raccoglie ciò che serve per i testi "cosa manca" e per il grafico.
import {
  analyzeMealTiming,
  estimateExpenditure,
  findAssociations,
  projectWeight,
  type AssociationsResult,
  type ExpenditureResult,
  type ProjectionResult,
  type TimingAnalysis,
} from "@/core/analysis";
import {
  addDays,
  daysBetween,
  weightMovingAverage,
  weightSeries,
  type DiaryState,
  type WeightAveragePoint,
  type WeightPoint,
} from "@/core/diary";
import type { DayIntake } from "@/core/nutrition";
import {
  ASSOCIATION_MAX_RESULTS,
  ASSOCIATION_MIN,
  ASSOCIATION_WINDOW_DAYS,
  EXPENDITURE_MIN,
  EXPENDITURE_WINDOW_DAYS,
  LATE_DINNER_FROM_MINUTES,
  PROJECTION_HORIZON_DAYS,
  PROJECTION_MIN,
  PROJECTION_WINDOW_DAYS,
  TIMING_MIN_COMPLETE_DAYS,
  TIMING_WINDOW_DAYS,
} from "./config";

export interface AnalysisData {
  today: string;
  expenditure: ExpenditureResult;
  projection: ProjectionResult;
  timing: TimingAnalysis;
  /** Pesate della finestra della proiezione, per il grafico anche quando la proiezione manca. */
  weights: WeightPoint[];
  average: WeightAveragePoint[];
  /** Giorni tra prima e ultima pesata della finestra della proiezione. */
  weightSpanDays: number;
  /** Giorni tra prima e ultima pesata della finestra del dispendio. */
  expenditureWeightSpanDays: number;
  daysSinceLastWeighIn?: number;
}

function spanOf(points: readonly { date: string }[]): number {
  return points.length >= 2 ? daysBetween(points[0].date, points[points.length - 1].date) : 0;
}

/**
 * Le associazioni sono a parte: fanno molti confronti e una prova di permutazione, e possono durare.
 * Chi disegna le calcola dopo il primo rendering, con lo stato "calcolo in corso".
 */
export function computeAssociations(
  diary: DiaryState,
  intakeDays: readonly DayIntake[],
  today: string,
): AssociationsResult {
  return findAssociations(diary, intakeDays, {
    from: addDays(today, -(ASSOCIATION_WINDOW_DAYS - 1)),
    to: today,
    minCompleteDays: ASSOCIATION_MIN.completeDays,
    minDaysWith: ASSOCIATION_MIN.daysWith,
    minDaysWithout: ASSOCIATION_MIN.daysWithout,
    maxResults: ASSOCIATION_MAX_RESULTS,
  });
}

export function computeAnalysis(diary: DiaryState, intakeDays: readonly DayIntake[], today: string): AnalysisData {
  const expenditure = estimateExpenditure(diary, intakeDays, {
    to: today,
    today,
    windowDays: EXPENDITURE_WINDOW_DAYS,
    minCompleteDays: EXPENDITURE_MIN.completeDays,
    minWeighIns: EXPENDITURE_MIN.weighIns,
    minWeightSpanDays: EXPENDITURE_MIN.spanDays,
  });
  const projection = projectWeight(diary, {
    to: today,
    asOf: today,
    windowDays: PROJECTION_WINDOW_DAYS,
    horizonDays: PROJECTION_HORIZON_DAYS,
    minWeighIns: PROJECTION_MIN.weighIns,
    minSpanDays: PROJECTION_MIN.spanDays,
    maxStaleDays: PROJECTION_MIN.staleDays,
  });
  const timing = analyzeMealTiming(diary, {
    from: addDays(today, -(TIMING_WINDOW_DAYS - 1)),
    to: today,
    today,
    minCompleteDays: TIMING_MIN_COMPLETE_DAYS,
    lateDinnerFromMinutes: LATE_DINNER_FROM_MINUTES,
  });
  const from = addDays(today, -(PROJECTION_WINDOW_DAYS - 1));
  const weights = weightSeries(diary, { from, to: today });
  const average = weightMovingAverage(diary, { from, to: today, windowDays: 7 });
  const last = weights[weights.length - 1];
  const expWeights = weightSeries(diary, { from: addDays(today, -(EXPENDITURE_WINDOW_DAYS - 1)), to: today });
  return {
    today,
    expenditure,
    projection,
    timing,
    weights,
    average,
    weightSpanDays: spanOf(weights),
    expenditureWeightSpanDays: spanOf(expWeights),
    ...(last ? { daysSinceLastWeighIn: daysBetween(last.date, today) } : {}),
  };
}
