// Associazioni osservate tra ciò che si è mangiato e umore o sintomi (stesso giorno o giorno dopo).
// Cercare tra molte coppie fa emergere per caso qualche "scoperta": per questo ogni confronto passa
// da minimi di giorni con e senza l'esposizione, dalla correzione per il numero di confronti fatti
// (Holm), da una differenza minima e da un elenco limitato. Sotto le soglie non si mostra nulla.
//
// Perché la prova di permutazione: con punteggi discreti da 1 a 5 e gruppi piccoli o sbilanciati la
// t di Student è troppo ottimista nelle code, proprio dove la correzione per molti confronti
// lavora (misurato su dati casuali: un valore p nominale di 0,0001 si è presentato 13 volte su
// 10.000 con gruppi di 8 e 30 giorni, e 0,001 quattro volte su mille). La dipendenza tra confronti
// non c'entra, perché Holm vale comunque. Per questo ogni associazione che supera la t deve
// superare anche una prova di permutazione a seme fisso, corretta per il numero di confronti.
// Un'associazione non dice che una cosa ne spieghi un'altra.

import { addDays, dateRange, type DiaryDay, type DiaryState } from "../diary";
import { normalizeName, type DayIntake } from "../nutrition";
import {
  basisOf,
  formatNumber,
  insufficient,
  inRange,
  isFullyTracked,
  lowerReliability,
  reliabilityBySize,
  type DataBasis,
  type Insufficient,
  type Reliability,
  type ReliabilitySteps,
} from "./common";
import { OUTCOME_KEYS, OUTCOME_LABELS, dailyOutcome, type OutcomeKey } from "./outcomes";
import { hashSeed, holmAdjust, median, permutationTest, round, welch } from "./stats";
import { formatMinutes, timingOfDay } from "./timing";

export type ExposureKind =
  | "food"
  | "foodGroup"
  | "alcohol"
  | "caffeineHigh"
  | "lateDinner"
  | "lateCaffeine";

export interface Exposure {
  /** Identificativo stabile, per esempio `food:uovo`. */
  id: string;
  kind: ExposureKind;
  /** Nome per l'utente, in italiano. */
  label: string;
}

export interface AssociationOptions {
  from?: string;
  to?: string;
  /** Giorni completi minimi in tutto. Predefinito 14. */
  minCompleteDays?: number;
  /** Giorni minimi con l'esposizione (e l'esito osservato). Predefinito 8. */
  minDaysWith?: number;
  /** Giorni minimi senza l'esposizione (e con l'esito osservato). Predefinito 8. */
  minDaysWithout?: number;
  /** Probabilità massima di almeno un falso positivo su tutti i confronti (Holm). Predefinito 0,01. */
  alpha?: number;
  /**
   * Differenza minima standardizzata (d di Cohen) per mostrare un'associazione. Predefinito 0,5,
   * la soglia convenzionale di effetto "medio" (Cohen, 1988): differenze più piccole, anche se
   * statisticamente nette, non si mostrano.
   */
  minStandardizedDifference?: number;
  /** Numero massimo di associazioni mostrate. Predefinito 5. */
  maxResults?: number;
  /** Cena tardiva dalle (minuti dalla mezzanotte). Scelta di progetto: predefinito 21:00. */
  lateDinnerFromMinutes?: number;
  /** Caffeina tardiva dalle (minuti). Scelta di progetto: predefinito 16:00. */
  lateCaffeineFromMinutes?: number;
  /**
   * Soglia della caffeina "alta" in mg al giorno. Predefinito: il valore mediano dei giorni
   * completi della persona (ciò che per lei è sopra il solito), non un valore di riferimento.
   */
  caffeineHighMg?: number;
  /** Gruppo alimentare di un alimento di tabella (per esempio dalla sua `group`); abilita le esposizioni di gruppo. */
  groupOfFoodRef?: (ref: string) => string | undefined;
  /**
   * Verifica con la prova di permutazione le associazioni che superano la t (predefinito: sì).
   * Disattivarla serve solo a misurare il tasso di falsi positivi della sola t.
   */
  permutationCheck?: boolean;
  /** Tetto al numero di permutazioni per confronto. Predefinito 200000. */
  maxPermutations?: number;
  reliabilitySteps?: ReliabilitySteps;
}

export type AssociationInsufficientReason =
  | "no_data"
  | "few_complete_days"
  | "no_testable_comparisons";

export interface GroupStats {
  days: number;
  mean: number;
  sd: number;
}

export interface Association {
  exposure: Exposure;
  outcome: OutcomeKey;
  /** 0: stesso giorno; 1: il giorno dopo. */
  lag: 0 | 1;
  withExposure: GroupStats;
  withoutExposure: GroupStats;
  /** Media con l'esposizione meno media senza, in punti. */
  difference: number;
  /** Intervallo della differenza, al livello corretto per il numero di confronti (Bonferroni). */
  interval: { low: number; high: number; confidence: number };
  standardizedDifference: number;
  direction: "higher" | "lower";
  /** Forza secondo le soglie convenzionali di Cohen: sotto 0,5 piccola, da 0,5 media, da 0,8 grande. */
  strength: "small" | "moderate" | "large";
  pValue: number;
  /** Valore p corretto per il numero di confronti (Holm), dalla t. */
  adjustedPValue: number;
  /** Valore p della prova di permutazione (a seme fisso); assente se la verifica è disattivata. */
  permutationPValue?: number;
  reliability: Reliability;
  /** Testo per l'utente, in italiano. */
  summary: string;
}

export interface AssociationBasisInfo extends DataBasis {
  /** Per esito, i giorni completi con l'esito osservato lo stesso giorno. */
  outcomeDays: Record<OutcomeKey, number>;
}

export interface AssociationsFound {
  status: "ok";
  /** Le associazioni più solide, già corrette per i confronti multipli; può essere vuoto. */
  associations: Association[];
  /** Confronti fatti (la famiglia su cui si corregge). */
  tested: number;
  /** Quanti hanno superato la correzione e la differenza minima. */
  passed: number;
  basis: AssociationBasisInfo;
  /** Come si è controllato il rischio di falsi positivi. */
  control: AssociationControl;
  /** Avvertenze per l'utente, in italiano. */
  caveats: string[];
}

export interface AssociationControl {
  /**
   * Probabilità massima dichiarata che, su dati senza alcuna associazione, almeno una compaia nel
   * risultato. Vale per giorni scambiabili tra loro (senza andamenti nel tempo).
   */
  nominalFalsePositiveRate: number;
  method: "holm+permutation" | "holm";
  /** Confronti fatti. */
  comparisons: number;
  /** Permutazioni per confronto verificato (0 se la verifica è disattivata). */
  permutations: number;
  /** Con troppi confronti per il tetto di permutazioni nessuna associazione può essere confermata. */
  resolutionLimited: boolean;
  /** Associazioni che avevano superato la sola t, prima della prova di permutazione. */
  passedTTest: number;
}

export type AssociationsResult =
  | AssociationsFound
  | (Insufficient<AssociationInsufficientReason> & { basis: AssociationBasisInfo });

const CAVEATS = [
  "Sono associazioni osservate nei tuoi dati: non dicono che una cosa ne spieghi un'altra.",
  "Per gli esiti dello stesso giorno l'ordine nel tempo tra pasto ed esito non è verificato.",
  "Sono stati confrontati molti alimenti e orari: qualche coincidenza è attesa. La correzione per i confronti multipli ne riduce il numero ma non lo azzera.",
];

interface DayFacts {
  date: string;
  exposures: Set<string>;
}

function foodKey(
  line: {
    label: string;
    status: "ok" | "unresolved";
    composition?: { name: string; ref?: string };
  },
  normalize: (label: string) => string,
): { key: string; label: string; ref?: string } | undefined {
  if (line.status === "ok" && line.composition?.ref !== undefined) {
    return { key: `food:${line.composition.ref}`, label: line.composition.name, ref: line.composition.ref };
  }
  const name = normalize(line.label);
  return name === "" ? undefined : { key: `food:${name}`, label: line.label.trim() };
}

function strengthOf(d: number): Association["strength"] {
  const a = Math.abs(d);
  return a >= 0.8 ? "large" : a >= 0.5 ? "moderate" : "small";
}

const STRENGTH_TEXT = { small: "piccola", moderate: "media", large: "grande" } as const;
const RELIABILITY_TEXT = { low: "bassa", moderate: "media", good: "buona" } as const;

export function describeAssociation(a: Omit<Association, "summary">): string {
  const when = a.lag === 0 ? "lo stesso giorno" : "il giorno dopo";
  const direction = a.direction === "higher" ? "più alto" : "più basso";
  return `Nei giorni con ${a.exposure.label} (${a.withExposure.days} giorni) il punteggio di ${OUTCOME_LABELS[a.outcome]} ${when} è stato in media ${direction} di ${formatNumber(Math.abs(a.difference), 2)} punti rispetto agli altri giorni (${a.withoutExposure.days} giorni). Associazione osservata, forza ${STRENGTH_TEXT[a.strength]}, affidabilità ${RELIABILITY_TEXT[a.reliability]}; non indica che una cosa ne spieghi un'altra.`;
}

/**
 * Cerca le associazioni più solide tra esposizioni alimentari e orarie e gli esiti (umore e
 * sintomi) dello stesso giorno o del giorno dopo, sui soli giorni tracciati per intero.
 * Un giorno senza registrazioni dell'esito non conta come esito basso. Il risultato non dipende
 * dall'ordine degli eventi.
 */
export function findAssociations(
  diary: DiaryState,
  intakeDays: readonly DayIntake[],
  options: AssociationOptions = {},
): AssociationsResult {
  const minComplete = options.minCompleteDays ?? 14;
  const minWith = Math.max(2, options.minDaysWith ?? 8);
  const minWithout = Math.max(2, options.minDaysWithout ?? 8);
  const alpha = options.alpha ?? 0.01;
  const minD = options.minStandardizedDifference ?? 0.5;
  const maxResults = Math.max(0, Math.floor(options.maxResults ?? 5));
  const lateDinnerFrom = options.lateDinnerFromMinutes ?? 21 * 60;
  const lateCaffeineFrom = options.lateCaffeineFromMinutes ?? 16 * 60;
  const steps = options.reliabilitySteps ?? { moderate: 12, good: 20 };

  const emptyOutcomeDays = Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 0])) as Record<OutcomeKey, number>;
  const dates = [...diary.days.map((d) => d.date), ...intakeDays.map((d) => d.date)].sort();
  const from = options.from ?? dates[0];
  const to = options.to ?? dates[dates.length - 1];
  if (from === undefined || to === undefined) {
    return {
      ...insufficient(["no_data"], basisOf(0, 0, 0), "nessun dato nel periodo."),
      basis: { ...basisOf(0, 0, 0), outcomeDays: emptyOutcomeDays },
    };
  }
  const periodDays = dateRange(from, to).length;

  const dayByDate = new Map<string, DiaryDay>(diary.days.map((d) => [d.date, d]));
  const intakeByDate = new Map(intakeDays.map((d) => [d.date, d]));
  const completeDates = [...intakeByDate.keys()]
    .filter((d) => inRange(d, from, to) && intakeByDate.get(d)?.complete === true && isFullyTracked(dayByDate.get(d), d))
    .sort();

  const outcomeDays = { ...emptyOutcomeDays };
  let outcomeObservations = 0;
  for (const d of completeDates) {
    for (const key of OUTCOME_KEYS) {
      if (dailyOutcome(dayByDate.get(d), key) !== undefined) {
        outcomeDays[key]++;
        outcomeObservations++;
      }
    }
  }
  const basis: AssociationBasisInfo = {
    ...basisOf(periodDays, completeDates.length, outcomeObservations),
    outcomeDays,
  };
  if (completeDates.length < minComplete) {
    return {
      ...insufficient(
        ["few_complete_days"],
        basis,
        `servono almeno ${minComplete} giorni tracciati per intero, ce ne sono ${completeDates.length}.`,
      ),
      basis,
    };
  }

  // La normalizzazione dei nomi è costosa e le stesse voci ricorrono ogni giorno.
  const normalized = new Map<string, string>();
  const normalize = (label: string): string => {
    let v = normalized.get(label);
    if (v === undefined) normalized.set(label, (v = normalizeName(label)));
    return v;
  };

  // Esposizioni per giorno completo.
  const caffeineValues = completeDates.map((d) => dayByDate.get(d)?.caffeineMg ?? 0);
  const caffeineThreshold = options.caffeineHighMg ?? median(caffeineValues);
  const meta = new Map<string, Exposure>();
  const facts: DayFacts[] = completeDates.map((date) => {
    const exposures = new Set<string>();
    const note = (exposure: Exposure): void => {
      exposures.add(exposure.id);
      const cur = meta.get(exposure.id);
      // A parità di id si tiene l'etichetta minore, così il risultato non dipende dall'ordine.
      if (!cur || exposure.label < cur.label) meta.set(exposure.id, exposure);
    };
    const intake = intakeByDate.get(date);
    const lines = intake ? [...intake.meals.flatMap((m) => m.lines), ...intake.standalone] : [];
    for (const line of lines) {
      const k = foodKey(line, normalize);
      if (!k) continue;
      note({ id: k.key, kind: "food", label: k.label });
      const group = k.ref !== undefined ? options.groupOfFoodRef?.(k.ref) : undefined;
      if (group !== undefined && group !== "") {
        note({ id: `group:${group}`, kind: "foodGroup", label: `alimenti del gruppo «${group}»` });
      }
    }
    return { date, exposures };
  });
  // Esposizioni definite per ogni giorno completo (presenti o assenti): le registriamo a parte.
  const universal = new Map<string, Set<string>>();
  const defineUniversal = (exposure: Exposure, presentOn: Set<string>): void => {
    meta.set(exposure.id, exposure);
    universal.set(exposure.id, presentOn);
  };
  const alcoholDays = new Set<string>();
  const caffeineHighDays = new Set<string>();
  const lateDinnerDays = new Set<string>();
  const lateCaffeineDays = new Set<string>();
  for (const date of completeDates) {
    const day = dayByDate.get(date);
    if (!day) continue;
    if (day.alcoholG > 0) alcoholDays.add(date);
    if (day.caffeineMg > caffeineThreshold) caffeineHighDays.add(date);
    const t = timingOfDay(day, diary.timeZone, lateDinnerFrom);
    if (t?.lateDinner) lateDinnerDays.add(date);
    if (t?.lastCaffeineMinutes !== undefined && t.lastCaffeineMinutes >= lateCaffeineFrom) lateCaffeineDays.add(date);
  }
  defineUniversal({ id: "alcohol:any", kind: "alcohol", label: "alcol" }, alcoholDays);
  defineUniversal(
    { id: "caffeine:high", kind: "caffeineHigh", label: `caffeina sopra ${formatNumber(caffeineThreshold, 0)} mg` },
    caffeineHighDays,
  );
  defineUniversal(
    { id: "timing:lateDinner", kind: "lateDinner", label: `cena dopo le ${formatMinutes(lateDinnerFrom)}` },
    lateDinnerDays,
  );
  defineUniversal(
    { id: "timing:lateCaffeine", kind: "lateCaffeine", label: `ultima caffeina dopo le ${formatMinutes(lateCaffeineFrom)}` },
    lateCaffeineDays,
  );
  for (const [id, present] of universal) {
    for (const f of facts) if (present.has(f.date)) f.exposures.add(id);
  }

  // Esito per giorno completo e ritardo.
  const outcomeOn = (date: string, key: OutcomeKey, lag: 0 | 1): number | undefined =>
    dailyOutcome(dayByDate.get(lag === 0 ? date : addDays(date, 1)), key);

  interface Candidate {
    exposure: Exposure;
    outcome: OutcomeKey;
    lag: 0 | 1;
    w: NonNullable<ReturnType<typeof welch>>;
    withValues: number[];
    withoutValues: number[];
  }
  const candidates: Candidate[] = [];
  const exposureIds = [...meta.keys()].sort();
  for (const id of exposureIds) {
    const exposure = meta.get(id) as Exposure;
    for (const outcome of OUTCOME_KEYS) {
      for (const lag of [0, 1] as const) {
        const withValues: number[] = [];
        const withoutValues: number[] = [];
        for (const f of facts) {
          const v = outcomeOn(f.date, outcome, lag);
          if (v === undefined) continue;
          (f.exposures.has(id) ? withValues : withoutValues).push(v);
        }
        if (withValues.length < minWith || withoutValues.length < minWithout) continue;
        const w = welch(withValues, withoutValues);
        if (w) candidates.push({ exposure, outcome, lag, w, withValues, withoutValues });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      ...insufficient(
        ["no_testable_comparisons"],
        basis,
        `nessun confronto ha almeno ${minWith} giorni con e ${minWithout} giorni senza l'esposizione, con l'esito osservato.`,
      ),
      basis,
    };
  }

  const adjusted = holmAdjust(candidates.map((c) => c.w.p));
  const m = candidates.length;
  const survivors = candidates
    .map((c, i) => ({ c, adjustedP: adjusted[i] }))
    .filter(({ c, adjustedP }) => adjustedP <= alpha && Math.abs(c.w.standardized) >= minD);
  const checkPermutations = options.permutationCheck !== false;
  const threshold = alpha / m;
  // Per poter confermare una soglia di alpha/m servono almeno m/alpha permutazioni; se ne usano il doppio.
  const wanted = Math.ceil((2 * m) / alpha);
  const permutations = checkPermutations ? Math.min(wanted, Math.max(1, Math.floor(options.maxPermutations ?? 200_000))) : 0;
  const maxExceedances = Math.floor(threshold * (permutations + 1)) - 1;
  const passedTTest = survivors.length;
  const verified: { c: Candidate; adjustedP: number; permutationP?: number }[] = [];
  for (const { c, adjustedP } of survivors) {
    if (!checkPermutations) {
      verified.push({ c, adjustedP });
      continue;
    }
    if (maxExceedances < 0) continue;
    const perm = permutationTest(
      c.withValues,
      c.withoutValues,
      permutations,
      maxExceedances,
      hashSeed(`${c.exposure.id}|${c.outcome}|${c.lag}`),
    );
    if (perm.p !== undefined && perm.p <= threshold) verified.push({ c, adjustedP, permutationP: perm.p });
  }
  verified.sort(
    (x, y) =>
      Math.abs(y.c.w.standardized) - Math.abs(x.c.w.standardized) ||
      x.adjustedP - y.adjustedP ||
      (x.c.exposure.id < y.c.exposure.id ? -1 : x.c.exposure.id > y.c.exposure.id ? 1 : 0) ||
      (x.c.outcome < y.c.outcome ? -1 : x.c.outcome > y.c.outcome ? 1 : 0) ||
      x.c.lag - y.c.lag,
  );

  const associations: Association[] = verified.slice(0, maxResults).map(({ c, adjustedP, permutationP }) => {
    const level = 1 - alpha / m;
    const wide = welch(
      // Ricalcolo dell'intervallo al livello corretto per i confronti: stessi dati, stesso test.
      withGroup(facts, c, outcomeOn, true),
      withGroup(facts, c, outcomeOn, false),
      level,
    ) ?? c.w;
    const minN = Math.min(c.w.nA, c.w.nB);
    let reliability = reliabilityBySize(minN, steps);
    if (adjustedP > 0.001) reliability = lowerReliability(reliability, "moderate");
    const base: Omit<Association, "summary"> = {
      exposure: c.exposure,
      outcome: c.outcome,
      lag: c.lag,
      withExposure: { days: c.w.nA, mean: round(c.w.meanA, 3), sd: round(c.w.sdA, 3) },
      withoutExposure: { days: c.w.nB, mean: round(c.w.meanB, 3), sd: round(c.w.sdB, 3) },
      difference: round(c.w.difference, 3),
      interval: { low: round(wide.low, 3), high: round(wide.high, 3), confidence: round(level, 6) },
      standardizedDifference: round(c.w.standardized, 3),
      direction: c.w.difference > 0 ? "higher" : "lower",
      strength: strengthOf(c.w.standardized),
      pValue: c.w.p,
      adjustedPValue: adjustedP,
      ...(permutationP !== undefined ? { permutationPValue: permutationP } : {}),
      reliability,
    };
    return { ...base, summary: describeAssociation(base) };
  });

  return {
    status: "ok",
    associations,
    tested: m,
    passed: verified.length,
    basis,
    control: {
      nominalFalsePositiveRate: alpha,
      method: checkPermutations ? "holm+permutation" : "holm",
      comparisons: m,
      permutations,
      resolutionLimited: checkPermutations && maxExceedances < 0,
      passedTTest,
    },
    caveats: [...CAVEATS],
  };
}

function withGroup(
  facts: readonly DayFacts[],
  c: { exposure: Exposure; outcome: OutcomeKey; lag: 0 | 1 },
  outcomeOn: (date: string, key: OutcomeKey, lag: 0 | 1) => number | undefined,
  exposed: boolean,
): number[] {
  const out: number[] = [];
  for (const f of facts) {
    if (f.exposures.has(c.exposure.id) !== exposed) continue;
    const v = outcomeOn(f.date, c.outcome, c.lag);
    if (v !== undefined) out.push(v);
  }
  return out;
}
