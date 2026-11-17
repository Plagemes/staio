// Esperimenti personali: un periodo in cui l'utente cambia una cosa e osserva alcune misure,
// confrontato con un periodo di riferimento precedente della stessa durata.
// Il confronto dice se la differenza è distinguibile dalla variabilità abituale dei dati: non dice
// perché ci sia, e due periodi consecutivi differiscono anche per molto altro.

import { addDays, daysBetween, weightSeries, type DiaryDay, type DiaryState } from "../diary";
import { nameTokens, type DayIntake } from "../nutrition";
import type { Experiment, ExperimentMeasure } from "./experimentEvents";
import {
  basisOf,
  formatNumber,
  insufficient,
  isFullyTracked,
  lowerReliability,
  reliabilityBySize,
  type DataBasis,
  type Insufficient,
  type Reliability,
  type ReliabilitySteps,
} from "./common";
import { OUTCOME_KEYS, OUTCOME_LABELS, dailyOutcome, type OutcomeKey } from "./outcomes";
import {
  holmAdjust,
  lag1Autocorrelation,
  linearFit,
  round,
  tCritical,
  twoSidedP,
  welch,
  type Autocorrelation,
} from "./stats";

// ---------------------------------------------------------------------------------------------
// Confronto

export interface ExperimentCompareOptions {
  /**
   * Oggi (`YYYY-MM-DD`): se precede la fine dell'esperimento, il confronto usa i giorni trascorsi
   * (e un periodo di riferimento della stessa durata). Predefinito: l'esperimento è concluso.
   */
  asOf?: string;
  /** Osservazioni minime per periodo e misura. Predefinito 7. */
  minObservations?: number;
  /** Pesate minime per periodo. Predefinito 6. */
  minWeighIns?: number;
  /** Giorni minimi tra la prima e l'ultima pesata di un periodo. Predefinito 7. */
  minWeightSpanDays?: number;
  /** Quota di dato mancante dell'energia oltre la quale il giorno non conta. Predefinito 0,1. */
  maxEnergyMissingShare?: number;
  /** Aderenza sotto la quale il risultato è segnalato e resta poco affidabile. Predefinito 0,8. */
  minAdherence?: number;
  confidence?: number;
  /** Soglie delle osservazioni (del periodo più scarso) per l'affidabilità. Predefinito 10 e 20. */
  reliabilitySteps?: ReliabilitySteps;
}

export interface ComparedPeriod {
  from: string;
  to: string;
  days: number;
  /** Giorni tracciati per intero. */
  completeDays: number;
  /** Giorni del periodo esclusi perché con vuoti. */
  excludedDays: number;
}

export interface PeriodStats {
  /** Osservazioni (valori giornalieri, o pesate per la misura `weight`). */
  n: number;
  /** Media dei valori giornalieri; per `weight`, variazione in kg a settimana. */
  mean: number;
  /** Deviazione standard dei valori giornalieri; per `weight`, dei pesi attorno alla tendenza. */
  sd: number;
}

export interface AutocorrelationInfo {
  /** Il confronto usa la numerosità efficace, non il numero di giorni. */
  applied: boolean;
  reference: { rho: number; pairs: number; effectiveN: number };
  experiment: { rho: number; pairs: number; effectiveN: number };
}

export type MeasureInsufficientReason = "few_observations" | "short_weight_span";

export type MeasureComparison =
  | {
      measure: ExperimentMeasure;
      label: string;
      unit: string;
      status: "insufficient";
      reasons: MeasureInsufficientReason[];
      reference: { n: number };
      experiment: { n: number };
      message: string;
    }
  | {
      measure: ExperimentMeasure;
      label: string;
      unit: string;
      status: "compared";
      reference: PeriodStats;
      experiment: PeriodStats;
      /** Periodo dell'esperimento meno periodo di riferimento, nell'unità della misura. */
      difference: number;
      interval: { low: number; high: number; confidence: number };
      /** Differenza in unità della variabilità abituale (deviazione standard del riferimento), se non nulla. */
      differenceInUsualSds?: number;
      /** Differenza standardizzata (d di Cohen); assente per `weight`. */
      standardizedDifference?: number;
      /**
       * `distinguishable`: la differenza supera la variabilità abituale anche dopo la correzione per
       * il numero di misure confrontate (Holm). `provisional`: l'esperimento non è concluso e non si
       * dichiara nulla; `difference` e `interval` sono solo provvisori.
       */
      verdict: "distinguishable" | "not_distinguishable" | "provisional";
      /** Vero a esperimento in corso (stesso valore di `ExperimentComparisonOk.provisional`). */
      provisional: boolean;
      /** Solo se `distinguishable`. */
      direction?: "higher" | "lower";
      /** Valore p del confronto di questa misura e valore corretto per il numero di misure (Holm). Assenti se provvisorio. */
      pValue?: number;
      adjustedPValue?: number;
      /** Autocorrelazione tra giorni consecutivi e numerosità efficace usate per l'intervallo e il valore p. */
      autocorrelation: AutocorrelationInfo;
      reliability: Reliability;
      /** Testo per l'utente, in italiano. */
      summary: string;
    };

export interface AdherenceInfo {
  declared?: number;
  /** Misurata sui pasti registrati: giorni completi dell'esperimento senza gli alimenti esclusi. */
  measured?: {
    daysChecked: number;
    daysAdherent: number;
    share?: number;
    /** Nel periodo di riferimento: giorni completi e quanti contenevano gli alimenti esclusi. */
    referenceDaysChecked: number;
    referenceDaysWithFood: number;
  };
  excludedFoods: string[];
  minAdherence: number;
  lowAdherence: boolean;
}

export type ExperimentInsufficientReason = "not_started" | "no_measure_computable";

export interface ExperimentComparisonOk {
  status: "ok";
  experimentId: string;
  title: string;
  change: string;
  /** L'esperimento non è concluso: si confrontano i giorni trascorsi. */
  ongoing: boolean;
  /** Come `ongoing`: i risultati sono provvisori e non dichiarano "distinguibile". */
  provisional: boolean;
  /** Quante misure sono state confrontate e con quale correzione. */
  multiplicity: {
    measuresRequested: number;
    measuresCompared: number;
    correction: "holm";
    /** Probabilità massima dichiarata di almeno un falso "distinguibile" tra le misure, senza effetto reale. */
    alpha: number;
  };
  periods: { reference: ComparedPeriod; experiment: ComparedPeriod };
  measures: MeasureComparison[];
  adherence: AdherenceInfo;
  basis: DataBasis;
  /** Avvertenze per l'utente, in italiano. */
  caveats: string[];
}

export type ExperimentComparison =
  | ExperimentComparisonOk
  | (Insufficient<ExperimentInsufficientReason> & {
      experimentId: string;
      periods?: { reference: ComparedPeriod; experiment: ComparedPeriod };
      measures?: MeasureComparison[];
      /** Aderenza e avvertenze, quando calcolabili anche senza un confronto. */
      adherence?: AdherenceInfo;
      caveats?: string[];
    });

export interface ExperimentInputs {
  diary: DiaryState;
  /** Giorni con l'energia e le voci (da `computeIntake`): servono per l'energia e per l'aderenza. */
  intakeDays?: readonly DayIntake[];
}

const MEASURE_LABELS: Record<ExperimentMeasure, string> = {
  ...OUTCOME_LABELS,
  weight: "variazione del peso",
  energyIntake: "energia assunta",
};

const MEASURE_UNITS: Record<ExperimentMeasure, string> = {
  mood: "punti",
  symptomDigestion: "punti",
  symptomEnergy: "punti",
  symptomSleep: "punti",
  symptomOther: "punti",
  weight: "kg a settimana",
  energyIntake: "kcal",
};

interface FoodNames {
  names: string[];
  refs: string[];
}

const BASE_CAVEATS = [
  "I due periodi sono consecutivi: differiscono anche per stagione, impegni e altre abitudini. Il confronto descrive i dati, non spiega il perché.",
  "Un solo esperimento non basta a trarre conclusioni: ripeterlo aumenta la fiducia.",
] as const;

function foodsOfDay(date: string, day: DiaryDay | undefined, intake: DayIntake | undefined): FoodNames {
  const names: string[] = [];
  const refs: string[] = [];
  for (const meal of day?.meals ?? []) {
    for (const item of meal.items) {
      names.push(item.name);
      if (item.foodId !== undefined && item.foodId !== "") refs.push(item.foodId);
    }
  }
  if (intake && intake.date === date) {
    const lines = [...intake.meals.flatMap((m) => m.lines), ...intake.standalone];
    for (const line of lines) {
      names.push(line.label);
      if (line.status === "ok") {
        names.push(line.composition.name);
        if (line.composition.ref !== undefined) refs.push(line.composition.ref);
      }
    }
  }
  return { names, refs };
}

/**
 * Un alimento escluso corrisponde se coincide con l'identificativo di tabella di una voce, oppure
 * se tutte le sue parole (normalizzate come nella ricerca per nome) stanno nel nome della voce.
 */
function matchesFood(excluded: string, foods: FoodNames): boolean {
  const id = excluded.trim().toLowerCase();
  if (foods.refs.some((r) => r.toLowerCase() === id)) return true;
  const tokens = nameTokens(excluded);
  if (tokens.length === 0) return false;
  return foods.names.some((n) => {
    const have = new Set(nameTokens(n));
    return tokens.every((t) => have.has(t));
  });
}

function describeSummary(
  label: string,
  unit: string,
  digits: number,
  difference: number,
  verdict: "distinguishable" | "not_distinguishable" | "provisional",
  ref: PeriodStats,
  exp: PeriodStats,
  isChange: boolean,
  interval: { low: number; high: number },
): string {
  const abs = formatNumber(Math.abs(difference), digits);
  const what = isChange ? "La variazione" : "La media";
  const direction = difference > 0 ? "più alta" : "più bassa";
  const values = `${formatNumber(exp.mean, digits)} contro ${formatNumber(ref.mean, digits)} ${unit}, con ${exp.n} e ${ref.n} osservazioni`;
  if (verdict === "provisional") {
    return `Finora ${what.toLowerCase()} di ${label} nel periodo dell'esperimento (${values}) differisce di ${formatNumber(difference, digits)} ${unit} dal riferimento, con un intervallo provvisorio tra ${formatNumber(interval.low, digits)} e ${formatNumber(interval.high, digits)}. L'esperimento non è concluso: non si dichiara se la differenza sia distinguibile dalla variabilità abituale.`;
  }
  if (verdict === "distinguishable") {
    return `${what} di ${label} nel periodo dell'esperimento è stata ${direction} di ${abs} ${unit} rispetto al periodo di riferimento (${values}). La differenza è distinguibile dalla variabilità abituale di questi dati; descrive l'andamento osservato, non una spiegazione.`;
  }
  return `${what} di ${label} nel periodo dell'esperimento (${values}) non si distingue dal periodo di riferimento: la differenza di ${abs} ${unit} rientra nella variabilità abituale di questi dati.`;
}

/**
 * Confronta il periodo di un esperimento con il periodo di riferimento immediatamente precedente
 * della stessa durata, misura per misura.
 *
 * - Umore, sintomi ed energia: differenza tra le medie dei valori giornalieri nei soli giorni
 *   tracciati per intero, con intervallo (Welch) e variabilità. Il peso, che non dipende dal
 *   tracciamento dei pasti, usa tutte le pesate e confronta la variazione in kg a settimana.
 * - Le serie giornaliere non sono indipendenti: i confronti usano la numerosità efficace stimata
 *   dall'autocorrelazione tra giorni adiacenti. Con più misure nello stesso esperimento il verdetto
 *   "distinguibile" è corretto per il numero di confronti (Holm). A esperimento in corso (`asOf`
 *   prima della fine) il risultato è provvisorio e non dichiara "distinguibile".
 * - "Distinguibile" vuol dire che la differenza supera la variabilità abituale anche dopo la
 *   correzione; l'intervallo riportato è al livello `confidence`, senza correzione. Con
 *   un'aderenza bassa (dichiarata o misurata) l'affidabilità resta bassa.
 * - Sotto le osservazioni minime per periodo la misura è "dati insufficienti".
 */
export function compareExperiment(
  experiment: Experiment,
  inputs: ExperimentInputs,
  options: ExperimentCompareOptions = {},
): ExperimentComparison {
  const minObs = options.minObservations ?? 7;
  const minWeighIns = Math.max(3, options.minWeighIns ?? 6);
  const minSpan = options.minWeightSpanDays ?? 7;
  const maxMissing = options.maxEnergyMissingShare ?? 0.1;
  const minAdherence = options.minAdherence ?? 0.8;
  const confidence = options.confidence ?? 0.95;
  const steps = options.reliabilitySteps ?? { moderate: 10, good: 20 };
  const { diary } = inputs;

  const end =
    options.asOf !== undefined && options.asOf < experiment.endDate ? options.asOf : experiment.endDate;
  // Concluso solo dal giorno dopo la fine: il giorno di fine (o di una chiusura anticipata) conta
  // se risulta già completo, ma il verdetto resta provvisorio finché il giorno non è finito.
  const ongoing = options.asOf !== undefined && options.asOf <= experiment.endDate;
  if (end < experiment.startDate) {
    const declared = experiment.declaredAdherence;
    return {
      ...insufficient(["not_started"], basisOf(0, 0, 0), "l'esperimento non è ancora iniziato."),
      experimentId: experiment.experimentId,
      adherence: {
        ...(declared !== undefined ? { declared } : {}),
        excludedFoods: [...experiment.excludedFoods],
        minAdherence,
        lowAdherence: declared !== undefined && declared < minAdherence,
      },
      caveats: [...BASE_CAVEATS, "L'esperimento non è ancora iniziato: non ci sono giorni da confrontare."],
    };
  }
  const length = daysBetween(experiment.startDate, end) + 1;
  const refFrom = addDays(experiment.startDate, -length);
  const refTo = addDays(experiment.startDate, -1);
  const expRange = { from: experiment.startDate, to: end };
  const refRange = { from: refFrom, to: refTo };

  const dayByDate = new Map(diary.days.map((d) => [d.date, d]));
  const intakeByDate = new Map((inputs.intakeDays ?? []).map((d) => [d.date, d]));
  const isComplete = (date: string): boolean => {
    const intake = intakeByDate.get(date);
    return isFullyTracked(dayByDate.get(date), date) && (intake === undefined || intake.complete);
  };
  const completeDates = (range: { from: string; to: string }): string[] => {
    const out: string[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) if (isComplete(d)) out.push(d);
    return out;
  };
  const refComplete = completeDates(refRange);
  const expComplete = completeDates(expRange);
  const periodInfo = (range: { from: string; to: string }, complete: string[]): ComparedPeriod => ({
    ...range,
    days: length,
    completeDays: complete.length,
    excludedDays: length - complete.length,
  });
  const periods = { reference: periodInfo(refRange, refComplete), experiment: periodInfo(expRange, expComplete) };

  /** Valori giornalieri con la posizione del giorno nel periodo (0 = primo giorno). */
  const dailyValues = (
    measure: ExperimentMeasure,
    dates: string[],
    periodFrom: string,
  ): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (const date of dates) {
      const x = daysBetween(periodFrom, date);
      if (measure === "energyIntake") {
        const energy = intakeByDate.get(date)?.totals.energyKcal;
        if (energy && energy.missingShare <= maxMissing) out.push({ x, y: energy.value });
      } else if ((OUTCOME_KEYS as readonly string[]).includes(measure)) {
        const v = dailyOutcome(dayByDate.get(date), measure as OutcomeKey);
        if (v !== undefined) out.push({ x, y: v });
      }
    }
    return out;
  };

  const weightFit = (range: { from: string; to: string }) => {
    const points = weightSeries(diary, range);
    const span = points.length >= 2 ? daysBetween(points[0].date, points[points.length - 1].date) : 0;
    const fit = linearFit(points.map((p) => ({ x: daysBetween(range.from, p.date), y: p.kg })));
    return { n: points.length, span, fit };
  };

  // Aderenza: dichiarata e misurata sui pasti registrati.
  const excludedFoods = experiment.excludedFoods;
  const adherence: AdherenceInfo = {
    ...(experiment.declaredAdherence !== undefined ? { declared: experiment.declaredAdherence } : {}),
    excludedFoods: [...excludedFoods],
    minAdherence,
    lowAdherence: false,
  };
  const caveats: string[] = [...BASE_CAVEATS];
  if (excludedFoods.length > 0) {
    const withFood = (dates: string[]): number =>
      dates.filter((d) => {
        const foods = foodsOfDay(d, dayByDate.get(d), intakeByDate.get(d));
        return excludedFoods.some((f) => matchesFood(f, foods));
      }).length;
    const expWithFood = withFood(expComplete);
    const refWithFood = withFood(refComplete);
    const daysAdherent = expComplete.length - expWithFood;
    adherence.measured = {
      daysChecked: expComplete.length,
      daysAdherent,
      ...(expComplete.length > 0 ? { share: round(daysAdherent / expComplete.length, 3) } : {}),
      referenceDaysChecked: refComplete.length,
      referenceDaysWithFood: refWithFood,
    };
    caveats.push(
      "L'aderenza misurata considera le voci dei pasti registrati: ciò che non è stato registrato non si vede.",
    );
    if (refComplete.length > 0 && refWithFood === 0) {
      caveats.push(
        "Nel periodo di riferimento gli alimenti esclusi non compaiono: l'esperimento non cambia nulla rispetto al riferimento.",
      );
    }
  }
  const measuredShare = adherence.measured?.share;
  adherence.lowAdherence =
    (adherence.declared !== undefined && adherence.declared < minAdherence) ||
    (measuredShare !== undefined && measuredShare < minAdherence);
  if (adherence.lowAdherence) {
    caveats.push("L'aderenza è bassa: la differenza, anche se presente, riguarda un cambiamento seguito solo in parte.");
  }
  if (ongoing) caveats.push("L'esperimento non è concluso: il confronto usa i giorni trascorsi.");

  interface Draft {
    measure: ExperimentMeasure;
    label: string;
    unit: string;
    digits: number;
    isChange: boolean;
    reference: PeriodStats;
    experiment: PeriodStats;
    difference: number;
    low: number;
    high: number;
    p: number;
    differenceInUsualSds?: number;
    standardizedDifference?: number;
    reliabilityN: number;
    autocorrelation: AutocorrelationInfo;
  }
  const entries: (MeasureComparison | Draft)[] = [];
  const acInfo = (r: Autocorrelation, effectiveN: number): AutocorrelationInfo["reference"] => ({
    rho: round(r.rho, 3),
    pairs: r.pairs,
    effectiveN: round(effectiveN, 1),
  });
  for (const measure of experiment.measures) {
    const label = MEASURE_LABELS[measure];
    const unit = MEASURE_UNITS[measure];
    if (measure === "weight") {
      const r = weightFit(refRange);
      const e = weightFit(expRange);
      const reasons: MeasureInsufficientReason[] = [];
      if (r.n < minWeighIns || e.n < minWeighIns) reasons.push("few_observations");
      else if (r.span < minSpan || e.span < minSpan) reasons.push("short_weight_span");
      if (reasons.length > 0 || !r.fit || !e.fit) {
        entries.push({
          measure,
          label,
          unit,
          status: "insufficient",
          reasons: reasons.length > 0 ? reasons : ["few_observations"],
          reference: { n: r.n },
          experiment: { n: e.n },
          message: `Dati insufficienti: servono almeno ${minWeighIns} pesate per periodo, distribuite su almeno ${minSpan} giorni (${r.n} e ${e.n}).`,
        });
        continue;
      }
      const diff = (e.fit.slope - r.fit.slope) * 7;
      const se = Math.sqrt(e.fit.slopeSe ** 2 + r.fit.slopeSe ** 2) * 7;
      const df = Math.min(e.fit.df, r.fit.df);
      const half = tCritical(confidence, df) * se;
      entries.push({
        measure,
        label,
        unit,
        digits: 2,
        isChange: true,
        reference: { n: r.n, mean: round(r.fit.slope * 7, 3), sd: round(r.fit.residualSd, 3) },
        experiment: { n: e.n, mean: round(e.fit.slope * 7, 3), sd: round(e.fit.residualSd, 3) },
        difference: diff,
        low: diff - half,
        high: diff + half,
        p: se > 0 ? twoSidedP(diff / se, df) : diff === 0 ? 1 : 0,
        reliabilityN: Math.min(r.fit.effectiveN, e.fit.effectiveN),
        // La pendenza porta già l'allargamento per l'autocorrelazione dei residui.
        autocorrelation: {
          applied: true,
          reference: acInfo(
            { rho: r.fit.autocorrelation, pairs: r.fit.autocorrelationPairs, inflation: r.fit.inflation },
            r.fit.effectiveN,
          ),
          experiment: acInfo(
            { rho: e.fit.autocorrelation, pairs: e.fit.autocorrelationPairs, inflation: e.fit.inflation },
            e.fit.effectiveN,
          ),
        },
      });
      continue;
    }

    const aPoints = dailyValues(measure, expComplete, expRange.from);
    const bPoints = dailyValues(measure, refComplete, refRange.from);
    if (aPoints.length < Math.max(2, minObs) || bPoints.length < Math.max(2, minObs)) {
      entries.push({
        measure,
        label,
        unit,
        status: "insufficient",
        reasons: ["few_observations"],
        reference: { n: bPoints.length },
        experiment: { n: aPoints.length },
        message: `Dati insufficienti: servono almeno ${minObs} giorni tracciati per intero con il dato in ciascun periodo (${bPoints.length} nel riferimento, ${aPoints.length} nell'esperimento).`,
      });
      continue;
    }
    // I giorni consecutivi non sono indipendenti: la numerosità efficace tiene conto dell'autocorrelazione.
    const acA = lag1Autocorrelation(aPoints.map((p) => ({ x: p.x, e: p.y })));
    const acB = lag1Autocorrelation(bPoints.map((p) => ({ x: p.x, e: p.y })));
    const effA = aPoints.length / acA.inflation;
    const effB = bPoints.length / acB.inflation;
    const w = welch(
      aPoints.map((p) => p.y),
      bPoints.map((p) => p.y),
      confidence,
      { a: effA, b: effB },
    );
    if (!w) continue;
    entries.push({
      measure,
      label,
      unit,
      digits: measure === "energyIntake" ? 0 : 2,
      isChange: false,
      reference: { n: w.nB, mean: round(w.meanB, 3), sd: round(w.sdB, 3) },
      experiment: { n: w.nA, mean: round(w.meanA, 3), sd: round(w.sdA, 3) },
      difference: w.difference,
      low: w.low,
      high: w.high,
      p: w.p,
      ...(w.sdB > 0 ? { differenceInUsualSds: round(w.difference / w.sdB, 3) } : {}),
      standardizedDifference: round(w.standardized, 3),
      reliabilityN: Math.min(effA, effB),
      autocorrelation: { applied: true, reference: acInfo(acB, effB), experiment: acInfo(acA, effA) },
    });
  }

  // Più misure nello stesso esperimento sono più occasioni di un falso "distinguibile": correzione di
  // Holm sulle misure confrontate. A esperimento in corso non si dichiara nulla.
  const alpha = 1 - confidence;
  const drafts = entries.filter((x): x is Draft => !("status" in x));
  const adjusted = holmAdjust(drafts.map((d) => d.p));
  const adjustedOf = new Map(drafts.map((d, i) => [d, adjusted[i]]));
  const measures: MeasureComparison[] = entries.map((x): MeasureComparison => {
    if ("status" in x) return x;
    const adjustedP = adjustedOf.get(x) as number;
    const reliability = lowerReliability(
      reliabilityBySize(Math.floor(x.reliabilityN), steps),
      adherence.lowAdherence || ongoing ? "low" : "good",
    );
    const verdict: "distinguishable" | "not_distinguishable" | "provisional" = ongoing
      ? "provisional"
      : adjustedP <= alpha
        ? "distinguishable"
        : "not_distinguishable";
    return {
      measure: x.measure,
      label: x.label,
      unit: x.unit,
      status: "compared",
      provisional: ongoing,
      reference: x.reference,
      experiment: x.experiment,
      difference: round(x.difference, 3),
      interval: { low: round(x.low, 3), high: round(x.high, 3), confidence },
      ...(x.differenceInUsualSds !== undefined ? { differenceInUsualSds: x.differenceInUsualSds } : {}),
      ...(x.standardizedDifference !== undefined ? { standardizedDifference: x.standardizedDifference } : {}),
      verdict,
      ...(verdict === "distinguishable" ? { direction: x.difference > 0 ? ("higher" as const) : ("lower" as const) } : {}),
      ...(!ongoing ? { pValue: x.p, adjustedPValue: adjustedP } : {}),
      autocorrelation: x.autocorrelation,
      reliability,
      summary: describeSummary(x.label, x.unit, x.digits, x.difference, verdict, x.reference, x.experiment, x.isChange, {
        low: x.low,
        high: x.high,
      }),
    };
  });

  const observations = Math.max(0, ...measures.map((m) => (m.status === "compared" ? m.experiment.n + m.reference.n : 0)));
  const basis = basisOf(length * 2, periods.reference.completeDays + periods.experiment.completeDays, observations);

  if (drafts.length === 0) {
    return {
      ...insufficient(["no_measure_computable"], basis, "nessuna misura ha osservazioni sufficienti in entrambi i periodi."),
      experimentId: experiment.experimentId,
      periods,
      measures,
      adherence,
      caveats,
    };
  }
  if (ongoing) {
    caveats.push(
      "Finché l'esperimento non è concluso le differenze sono provvisorie: non si dichiara se siano distinguibili dalla variabilità abituale.",
    );
  }
  if (drafts.length > 1) {
    caveats.push(
      `Sono state confrontate ${drafts.length} misure: i verdetti sono corretti per il numero di confronti (Holm), così una coincidenza su una sola misura non basta.`,
    );
  }
  return {
    status: "ok",
    experimentId: experiment.experimentId,
    title: experiment.title,
    change: experiment.change,
    ongoing,
    provisional: ongoing,
    periods,
    measures,
    multiplicity: {
      measuresRequested: experiment.measures.length,
      measuresCompared: drafts.length,
      correction: "holm",
      alpha: round(alpha, 6),
    },
    adherence,
    basis,
    caveats,
  };
}

export * from "./experimentEvents";
