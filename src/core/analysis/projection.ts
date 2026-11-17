// Proiezione del peso: se la tendenza osservata continuasse, dove porterebbe nelle prossime
// settimane. Non è una previsione: la banda si allarga con la distanza e l'orizzonte ha un tetto.

import { addDays, daysBetween, weightSeries, type DiaryState } from "../diary";
import {
  basisOf,
  insufficient,
  lowerReliability,
  reliabilityBySize,
  type DataBasis,
  type Insufficient,
  type Reliability,
  type ReliabilitySteps,
} from "./common";
import { fitMeanSe, fitPredictionSe, fitValue, linearFit, round, tCritical } from "./stats";

export interface ProjectionOptions {
  /** Ultimo giorno di pesate considerato. Predefinito: l'ultima pesata. */
  to?: string;
  /** Giorni di pesate su cui si stima la tendenza. Predefinito 28. */
  windowDays?: number;
  /** Orizzonte richiesto in giorni. Predefinito 28. */
  horizonDays?: number;
  /** Tetto all'orizzonte, mai superato. Predefinito 84 (dodici settimane). */
  maxHorizonDays?: number;
  /** Distanza tra i punti della proiezione, in giorni. Predefinito 7. */
  stepDays?: number;
  /** Pesate minime (una per giorno) nella finestra. Predefinito 8. */
  minWeighIns?: number;
  /** Giorni minimi tra prima e ultima pesata. Predefinito 14. */
  minSpanDays?: number;
  /**
   * Oscillazione massima ammessa dei pesi attorno alla tendenza (deviazione standard dei residui,
   * in kg). Oltre, la tendenza è troppo rumorosa per proiettarla. Scelta di progetto: predefinito 2.
   */
  maxResidualSdKg?: number;
  /**
   * Oggi (`YYYY-MM-DD`), se si vuole controllare che le pesate siano recenti: con un'ultima pesata
   * più vecchia di `maxStaleDays` rispetto a `asOf` (o, se manca, a `to`) non si proietta. Senza
   * nessuno dei due il controllo non c'è.
   */
  asOf?: string;
  /** Predefinito 14. */
  maxStaleDays?: number;
  confidence?: number;
  /** Soglie delle pesate per l'affidabilità. Predefinito moderata da 12, buona da 20. */
  reliabilitySteps?: ReliabilitySteps;
}

export type ProjectionInsufficientReason =
  | "no_data"
  | "few_weigh_ins"
  | "short_weight_span"
  | "noisy_trend"
  | "stale_data";

export interface ProjectionPoint {
  date: string;
  daysAhead: number;
  /** Peso atteso se la tendenza continua. */
  expectedKg: number;
  /** Banda del peso atteso (incertezza della tendenza): si allarga con la distanza. */
  trendLowKg: number;
  trendHighKg: number;
  /** Banda di una singola pesata (tendenza più oscillazione quotidiana). */
  dailyLowKg: number;
  dailyHighKg: number;
}

export interface WeightProjection {
  status: "ok";
  /** Ultimo giorno con una pesata: da qui parte la proiezione. */
  fromDate: string;
  window: { from: string; to: string };
  /** Orizzonte effettivo in giorni (può essere minore di quello richiesto). */
  horizonDays: number;
  horizonClamped: boolean;
  /** Variazione osservata, in kg a settimana, con il suo intervallo. */
  trendKgPerWeek: number;
  trendInterval: { low: number; high: number; confidence: number };
  /** L'intervallo della tendenza non include lo zero: la variazione è distinguibile da un peso stabile. */
  trendDistinguishableFromFlat: boolean;
  /** Oscillazione dei pesi attorno alla tendenza (deviazione standard), in kg. */
  residualSdKg: number;
  /** Autocorrelazione dei residui (su coppie di giorni adiacenti) usata per allargare le bande. */
  autocorrelation: { rho: number; pairs: number };
  points: ProjectionPoint[];
  reliability: Reliability;
  basis: DataBasis;
  weighIns: number;
  assumptions: string[];
}

export type ProjectionResult =
  | WeightProjection
  | (Insufficient<ProjectionInsufficientReason> & { weighIns: number });

const ASSUMPTIONS = [
  "La tendenza osservata nella finestra continua invariata: è una proiezione, non una previsione.",
  "Le pesate sono confrontabili tra loro (stesse condizioni di misura).",
  "Più l'orizzonte è lontano rispetto ai giorni osservati, meno la proiezione è affidabile.",
];

/**
 * Andamento atteso del peso per le prossime settimane dalla retta sulle pesate recenti. Dà due
 * bande: quella dell'incertezza della tendenza e quella di una singola pesata. L'orizzonte non
 * supera mai `maxHorizonDays`. Con poche pesate, un periodo breve, pesate vecchie o una tendenza
 * troppo rumorosa non dà numeri (`status: "insufficient"`).
 */
export function projectWeight(diary: DiaryState, options: ProjectionOptions = {}): ProjectionResult {
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? 28));
  const minWeighIns = Math.max(3, options.minWeighIns ?? 8);
  const minSpan = options.minSpanDays ?? 14;
  const maxHorizon = Math.max(1, Math.floor(options.maxHorizonDays ?? 84));
  const requested = Math.max(1, Math.floor(options.horizonDays ?? 28));
  const horizonDays = Math.min(requested, maxHorizon);
  const step = Math.max(1, Math.floor(options.stepDays ?? 7));
  const confidence = options.confidence ?? 0.95;
  const maxResidualSd = options.maxResidualSdKg ?? 2;
  const steps = options.reliabilitySteps ?? { moderate: 12, good: 20 };

  const all = weightSeries(diary);
  const to = options.to ?? all[all.length - 1]?.date;
  if (to === undefined) {
    return { ...insufficient(["no_data"], basisOf(0, 0, 0), "nessuna pesata registrata."), weighIns: 0 };
  }
  const from = addDays(to, -(windowDays - 1));
  const weights = weightSeries(diary, { from, to });
  const basis = basisOf(windowDays, weights.length, weights.length, {
    lastDataDate: weights[weights.length - 1]?.date,
  });
  const span = weights.length >= 2 ? daysBetween(weights[0].date, weights[weights.length - 1].date) : 0;

  const reasons: ProjectionInsufficientReason[] = [];
  const details: string[] = [];
  if (weights.length < minWeighIns) {
    reasons.push("few_weigh_ins");
    details.push(`servono almeno ${minWeighIns} pesate negli ultimi ${windowDays} giorni, ce ne sono ${weights.length}`);
  } else if (span < minSpan) {
    reasons.push("short_weight_span");
    details.push(`le pesate coprono ${span} giorni, ne servono almeno ${minSpan}`);
  }
  const last = weights[weights.length - 1];
  // Data di confronto: oggi se passato, altrimenti la fine richiesta della finestra. Senza nessuna
  // delle due la freschezza non è verificabile e il controllo non c'è.
  const reference = options.asOf ?? options.to;
  if (last && reference !== undefined && daysBetween(last.date, reference) > (options.maxStaleDays ?? 14)) {
    reasons.push("stale_data");
    details.push(`l'ultima pesata (${last.date}) è troppo vecchia rispetto al ${reference}`);
  }
  const fail = (r: ProjectionInsufficientReason[], detail: string): ProjectionResult => ({
    ...insufficient(r, basis, detail),
    weighIns: weights.length,
  });
  if (reasons.length > 0) return fail(reasons, `${details.join("; ")}.`);

  const origin = weights[0].date;
  const fit = linearFit(weights.map((w) => ({ x: daysBetween(origin, w.date), y: w.kg })));
  if (!fit) return fail(["few_weigh_ins"], "le pesate non permettono di stimare un andamento.");
  if (fit.residualSd > maxResidualSd) {
    return fail(
      ["noisy_trend"],
      `i pesi oscillano troppo attorno alla tendenza (${round(fit.residualSd, 1)} kg) per proiettarla.`,
    );
  }

  const lastX = daysBetween(origin, last.date);
  const crit = tCritical(confidence, fit.df);
  const aheads: number[] = [];
  for (let d = 0; d < horizonDays; d += step) aheads.push(d);
  aheads.push(horizonDays);
  const points: ProjectionPoint[] = aheads.map((ahead) => {
    const x = lastX + ahead;
    const expected = fitValue(fit, x);
    const trendHalf = crit * fitMeanSe(fit, x);
    const dailyHalf = crit * fitPredictionSe(fit, x);
    return {
      date: addDays(last.date, ahead),
      daysAhead: ahead,
      expectedKg: round(expected, 2),
      trendLowKg: round(expected - trendHalf, 2),
      trendHighKg: round(expected + trendHalf, 2),
      dailyLowKg: round(expected - dailyHalf, 2),
      dailyHighKg: round(expected + dailyHalf, 2),
    };
  });

  const slopeHalf = crit * fit.slopeSe;
  let reliability = reliabilityBySize(weights.length, steps);
  const extrapolation = horizonDays / Math.max(1, span);
  if (extrapolation > 2) reliability = "low";
  else if (extrapolation > 1) reliability = lowerReliability(reliability, "moderate");

  return {
    status: "ok",
    fromDate: last.date,
    window: { from, to },
    horizonDays,
    horizonClamped: horizonDays < requested,
    trendKgPerWeek: round(fit.slope * 7, 3),
    trendInterval: {
      low: round((fit.slope - slopeHalf) * 7, 3),
      high: round((fit.slope + slopeHalf) * 7, 3),
      confidence,
    },
    trendDistinguishableFromFlat: fit.slope - slopeHalf > 0 || fit.slope + slopeHalf < 0,
    residualSdKg: round(fit.residualSd, 3),
    autocorrelation: { rho: round(fit.autocorrelation, 3), pairs: fit.autocorrelationPairs },
    points,
    reliability,
    basis,
    weighIns: weights.length,
    assumptions: [...ASSUMPTIONS],
  };
}
