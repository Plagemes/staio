// Stima del dispendio energetico medio giornaliero dal bilancio tra energia assunta e andamento
// del peso. È una stima statistica di un periodo, non una misura: ha un intervallo e dichiara le
// sue ipotesi.

import {
  addDays,
  daysBetween,
  weightMovingAverage,
  weightSeries,
  type DiaryState,
  type WeightAveragePoint,
} from "../diary";
import { worseCertainty, type Certainty } from "../ledger";
import type { ComparableDay } from "../nutrition";
import {
  basisOf,
  freshnessOf,
  freshnessWarnings,
  insufficient,
  latestDate,
  inRange,
  reliabilityBySize,
  lowerReliability,
  type DataBasis,
  type Freshness,
  type Insufficient,
  type Reliability,
} from "./common";
import { linearFit, mean, round, sampleSd, tCritical } from "./stats";

/**
 * Energia equivalente a 1 kg di variazione di peso corporeo, in kcal.
 * Origine: approssimazione di uso comune (circa 7700 kcal/kg, dal contenuto energetico del grasso
 * corporeo, ~9 kcal/g con una parte di acqua). Limite: è una media; la composizione di ciò che si
 * perde o si guadagna (grasso, massa magra, acqua, glicogeno) cambia il valore, soprattutto nel
 * breve periodo. È un parametro: va cambiato con `energyPerKgKcal`, non dato per vero.
 */
export const DEFAULT_ENERGY_PER_KG_KCAL = 7700;

/**
 * Errore sistematico relativo attribuito all'energia assunta, per la peggiore certezza dei giorni
 * usati. Scelta di progetto, non misurata: le quantità registrate a mano e i valori di tabella
 * hanno un errore che la sola variabilità tra i giorni non mostra.
 */
export const DEFAULT_INTAKE_SYSTEMATIC_ERROR: Readonly<Record<Certainty, number>> = {
  measured: 0.05,
  label: 0.1,
  estimated: 0.2,
};

export interface ExpenditureOptions {
  /** Ultimo giorno della finestra (incluso). Predefinito: l'ultimo giorno con dati di peso o energia. */
  to?: string;
  /** Primo giorno della finestra. Predefinito: `to` meno `windowDays - 1`. */
  from?: string;
  /** Ampiezza della finestra in giorni. Predefinito 28. */
  windowDays?: number;
  /** Giorni completi con l'energia nota, minimi. Predefinito 14. */
  minCompleteDays?: number;
  /** Pesate minime nella finestra (una per giorno). Predefinito 8. */
  minWeighIns?: number;
  /** Giorni minimi tra la prima e l'ultima pesata. Predefinito 14. */
  minWeightSpanDays?: number;
  /**
   * Oggi (`YYYY-MM-DD`), per sapere se il risultato è datato: senza `today` si confronta l'ultimo
   * dato con `to`, se passato. Senza nessuno dei due la freschezza non è verificabile.
   */
  today?: string;
  /** Giorni tra l'ultimo dato e la data di riferimento oltre i quali il risultato è datato. Predefinito 7. */
  staleToleranceDays?: number;
  /**
   * Quota minima di giorni della finestra usati. Predefinito 0,6: con la finestra e il minimo di
   * giorni predefiniti (14 su 28) basta a escludere un periodo in cui metà dei giorni ha vuoti.
   */
  minUsedShare?: number;
  /**
   * Quota di dato mancante dell'energia di un giorno oltre la quale il giorno non conta (energia
   * parziale: il totale sarebbe un minimo, non l'assunzione). Predefinito 0,1.
   */
  maxEnergyMissingShare?: number;
  /** Ampiezza in giorni della media mobile del peso restituita per la visualizzazione. Predefinito 7. */
  smoothingDays?: number;
  /** Vedi `DEFAULT_ENERGY_PER_KG_KCAL`. */
  energyPerKgKcal?: number;
  /** Livello dell'intervallo. Predefinito 0,95. */
  confidence?: number;
  /** Errore sistematico relativo dell'energia assunta per certezza; vedi `DEFAULT_INTAKE_SYSTEMATIC_ERROR`. */
  intakeSystematicError?: Partial<Record<Certainty, number>>;
  /**
   * Limiti larghi di plausibilità (kcal/giorno) per intercettare dati incoerenti, non per
   * giudicare: fuori da qui non si mostra il numero. Predefinito 800 e 6000.
   */
  plausibleRangeKcal?: readonly [number, number];
}

export type ExpenditureInsufficientReason =
  | "no_data"
  | "few_complete_days"
  | "few_weigh_ins"
  | "short_weight_span"
  | "low_used_share"
  /** Troppi giorni completi con energia parziale (quota di dato mancante sopra soglia). */
  | "partial_energy"
  | "implausible_estimate";

export interface ExpenditureExclusions {
  /** Giorni con dati nel diario ma non tracciati per intero. */
  incompleteDays: number;
  /** Giorni completi con energia mancante o parziale. */
  partialEnergyDays: number;
  /** Giorni della finestra senza alcuna voce. */
  emptyDays: number;
}

export interface ExpenditureEstimate {
  status: "ok";
  window: { from: string; to: string };
  /** Dispendio medio giornaliero stimato, in kcal. */
  expenditureKcal: number;
  interval: { low: number; high: number; confidence: number };
  /** Energia media assunta nei giorni usati, in kcal. */
  meanIntakeKcal: number;
  /** Variazione di peso stimata, in kg a settimana, con il suo intervallo. */
  weightTrendKgPerWeek: number;
  weightTrendInterval: { low: number; high: number };
  /** Autocorrelazione dei residui del peso (su coppie di giorni adiacenti) usata per allargare l'intervallo. */
  weightAutocorrelation: { rho: number; pairs: number };
  energyPerKgKcal: number;
  /** Media mobile del peso nella finestra, per la visualizzazione. */
  smoothedWeights: WeightAveragePoint[];
  reliability: Reliability;
  /** La peggiore certezza tra i giorni usati. */
  intakeCertainty: Certainty;
  /** Quanto è recente l'ultimo dato usato rispetto a `today` (o `to`). Se `dated`, non è la situazione attuale. */
  freshness: Freshness;
  /** Avvertenze per l'utente, in italiano (per esempio un risultato datato). */
  warnings: string[];
  basis: DataBasis;
  weighIns: number;
  exclusions: ExpenditureExclusions;
  /** Ipotesi su cui la stima poggia, in italiano. */
  assumptions: string[];
}

export type ExpenditureResult =
  | ExpenditureEstimate
  | (Insufficient<ExpenditureInsufficientReason> & {
      window?: { from: string; to: string };
      weighIns: number;
      exclusions: ExpenditureExclusions;
    });

const ASSUMPTIONS = [
  "Il peso cambia in modo regolare nel periodo: oscillazioni di acqua e contenuto intestinale sono trattate come rumore.",
  "I giorni completi rappresentano anche gli altri giorni del periodo.",
  "Un chilo di variazione di peso corrisponde a una quantità fissa di energia (parametro modificabile, vedi energyPerKgKcal).",
  "L'energia assunta è quella registrata, con i suoi limiti di precisione: le quantità e i valori di tabella sono stime.",
  "L'attività e il dispendio del periodo restano abbastanza stabili: è una media del periodo, non un valore per un giorno.",
];

/**
 * Dispendio medio giornaliero dal bilancio: energia assunta meno l'energia equivalente alla
 * variazione di peso. La variazione di peso è la pendenza della retta sulle pesate della finestra
 * (che liscia le oscillazioni), con l'intervallo gonfiato se i residui sono correlati. L'energia
 * assunta è la media dei soli giorni completi con l'energia nota e non parziale.
 *
 * Sotto le soglie minime non dà un numero (`status: "insufficient"`).
 */
export function estimateExpenditure(
  diary: DiaryState,
  intakeDays: readonly ComparableDay[],
  options: ExpenditureOptions = {},
): ExpenditureResult {
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? 28));
  const minCompleteDays = options.minCompleteDays ?? 14;
  const minWeighIns = Math.max(3, options.minWeighIns ?? 8);
  const minSpan = options.minWeightSpanDays ?? 14;
  const minUsedShare = options.minUsedShare ?? 0.6;
  const staleTolerance = options.staleToleranceDays ?? 7;
  const maxMissing = options.maxEnergyMissingShare ?? 0.1;
  const energyPerKg = options.energyPerKgKcal ?? DEFAULT_ENERGY_PER_KG_KCAL;
  const confidence = options.confidence ?? 0.95;
  const systematic = { ...DEFAULT_INTAKE_SYSTEMATIC_ERROR, ...options.intakeSystematicError };
  const [minPlausible, maxPlausible] = options.plausibleRangeKcal ?? [800, 6000];

  const allDates = [...diary.days.map((d) => d.date), ...intakeDays.map((d) => d.date)];
  const noExclusions: ExpenditureExclusions = { incompleteDays: 0, partialEnergyDays: 0, emptyDays: 0 };
  const lastDate = allDates.reduce<string | undefined>((m, d) => (m === undefined || d > m ? d : m), undefined);
  const to = options.to ?? lastDate;
  if (to === undefined) {
    return {
      ...insufficient(["no_data"], basisOf(0, 0, 0), "nessun dato nel periodo."),
      weighIns: 0,
      exclusions: noExclusions,
    };
  }
  const from = options.from ?? addDays(to, -(windowDays - 1));
  const periodDays = Math.max(0, daysBetween(from, to) + 1);
  const window = { from, to };

  const diaryDates = new Set(diary.days.map((d) => d.date));
  const intakeByDate = new Map(intakeDays.map((d) => [d.date, d]));
  const inWindow = [...new Set([...diaryDates, ...intakeByDate.keys()])].filter((d) =>
    inRange(d, from, to),
  );
  const usable: { date: string; kcal: number; certainty: Certainty }[] = [];
  let incompleteDays = 0;
  let partialEnergyDays = 0;
  for (const date of inWindow.sort()) {
    const day = intakeByDate.get(date);
    if (!day || !day.complete) {
      incompleteDays++;
      continue;
    }
    const energy = day.totals.energyKcal;
    if (!energy || energy.missingShare > maxMissing) {
      partialEnergyDays++;
      continue;
    }
    usable.push({ date, kcal: energy.value, certainty: energy.certainty });
  }
  const exclusions: ExpenditureExclusions = {
    incompleteDays,
    partialEnergyDays,
    emptyDays: Math.max(0, periodDays - inWindow.length),
  };

  const weights = weightSeries(diary, { from, to });
  const lastDataDate = latestDate([usable[usable.length - 1]?.date, weights[weights.length - 1]?.date]);
  const basis = basisOf(periodDays, usable.length, weights.length, { lastDataDate });
  const freshness = freshnessOf(lastDataDate, options.today ?? options.to, staleTolerance);
  const span = weights.length >= 2 ? daysBetween(weights[0].date, weights[weights.length - 1].date) : 0;

  const reasons: ExpenditureInsufficientReason[] = [];
  const details: string[] = [];
  if (usable.length < minCompleteDays) {
    reasons.push("few_complete_days");
    details.push(`servono almeno ${minCompleteDays} giorni completi con l'energia nota, ce ne sono ${usable.length}`);
    if (partialEnergyDays > 0) reasons.push("partial_energy");
  }
  if (weights.length < minWeighIns) {
    reasons.push("few_weigh_ins");
    details.push(`servono almeno ${minWeighIns} pesate, ce ne sono ${weights.length}`);
  } else if (span < minSpan) {
    reasons.push("short_weight_span");
    details.push(`le pesate coprono ${span} giorni, ne servono almeno ${minSpan}`);
  }
  if (periodDays > 0 && usable.length / periodDays < minUsedShare && !reasons.includes("few_complete_days")) {
    reasons.push("low_used_share");
    details.push("troppi giorni del periodo non sono tracciati per intero");
  }
  const fail = (r: ExpenditureInsufficientReason[], detail: string): ExpenditureResult => ({
    ...insufficient(r, basis, detail),
    window,
    weighIns: weights.length,
    exclusions,
  });
  if (reasons.length > 0) return fail(reasons, `${details.join("; ")}.`);

  const fit = linearFit(weights.map((w) => ({ x: daysBetween(from, w.date), y: w.kg })));
  if (!fit) return fail(["few_weigh_ins"], "le pesate non permettono di stimare un andamento.");

  const kcals = usable.map((u) => u.kcal);
  const meanIntake = mean(kcals);
  const seIntake = sampleSd(kcals) / Math.sqrt(kcals.length);
  const expenditure = meanIntake - fit.slope * energyPerKg;
  const seSlopeKcal = fit.slopeSe * energyPerKg;
  const se = Math.sqrt(seSlopeKcal ** 2 + seIntake ** 2);
  const df = Math.max(1, Math.min(fit.df, kcals.length - 1));
  let worst: Certainty = usable[0].certainty;
  for (const u of usable) worst = worseCertainty(worst, u.certainty);
  const half = tCritical(confidence, df) * se + systematic[worst] * meanIntake;

  if (!(expenditure >= minPlausible && expenditure <= maxPlausible)) {
    return fail(
      ["implausible_estimate"],
      "il bilancio tra energia e peso dà un valore incoerente: i dati del periodo non bastano per una stima.",
    );
  }

  const usedShare = usable.length / periodDays;
  const relativeHalf = half / expenditure;
  let reliability: Reliability = relativeHalf <= 0.15 ? "good" : relativeHalf <= 0.3 ? "moderate" : "low";
  reliability = lowerReliability(reliability, reliabilityBySize(usedShare * 100, { moderate: 60, good: 80 }));

  const trendHalf = tCritical(confidence, fit.df) * fit.slopeSe;
  return {
    status: "ok",
    window,
    expenditureKcal: Math.round(expenditure),
    interval: {
      low: Math.round(expenditure - half),
      high: Math.round(expenditure + half),
      confidence,
    },
    meanIntakeKcal: Math.round(meanIntake),
    weightTrendKgPerWeek: round(fit.slope * 7, 3),
    weightAutocorrelation: { rho: round(fit.autocorrelation, 3), pairs: fit.autocorrelationPairs },
    weightTrendInterval: {
      low: round((fit.slope - trendHalf) * 7, 3),
      high: round((fit.slope + trendHalf) * 7, 3),
    },
    energyPerKgKcal: energyPerKg,
    smoothedWeights: weightMovingAverage(diary, {
      from,
      to,
      ...(options.smoothingDays !== undefined ? { windowDays: options.smoothingDays } : {}),
    }),
    reliability,
    intakeCertainty: worst,
    freshness,
    warnings: freshnessWarnings(freshness),
    basis,
    weighIns: weights.length,
    exclusions,
    assumptions: [...ASSUMPTIONS],
  };
}
