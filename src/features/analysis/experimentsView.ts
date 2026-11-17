// Esperimenti per le schermate: stato, modulo di creazione, eventi di modifica, testi del confronto.
// Gli eventi non si modificano mai. Chiudere, ritirare, ripristinare, rinominare e dichiarare
// l'aderenza scrivono eventi PARZIALI che dichiarano solo il campo che cambia: così due dispositivi
// che modificano campi diversi non si cancellano a vicenda (si annullano con un `void`).
import {
  EXPERIMENT_LIMITS,
  EXPERIMENT_MEASURES,
  OUTCOME_LABELS,
  createExperiment,
  updateExperiment,
  type AdherenceInfo,
  type Experiment,
  type ExperimentAnomaly,
  type ExperimentBody,
  type ExperimentPatch,
  type ExperimentUpdateEvent,
  type ExperimentComparisonOk,
  type ExperimentMeasure,
  type MeasureComparison,
  type MeasureInsufficientReason,
  type OutcomeKey,
} from "@/core/analysis";
import { addDays, daysBetween } from "@/core/diary";
import { formatCalendarDate } from "../format";
import { generateId, isCalendarDate } from "@/core/ledger";
import { EXPERIMENT_DEFAULT_DAYS, EXPERIMENT_MIN } from "./config";
import { days, formatDecimal, formatPercent, formatSigned, plural, weighIns } from "./present";

export type ExperimentStatus = "upcoming" | "ongoing" | "ended";

export function experimentStatus(e: Pick<Experiment, "startDate" | "endDate">, today: string): ExperimentStatus {
  if (today < e.startDate) return "upcoming";
  if (today > e.endDate) return "ended";
  return "ongoing";
}

export const STATUS_LABELS: Record<ExperimentStatus, string> = {
  upcoming: "Programmato",
  ongoing: "In corso",
  ended: "Concluso",
};

export function experimentLength(e: Pick<Experiment, "startDate" | "endDate">): number {
  return daysBetween(e.startDate, e.endDate) + 1;
}

/** "Giorno 4 di 14", "Inizia tra 3 giorni", "Concluso da 5 giorni". */
export function progressText(e: Pick<Experiment, "startDate" | "endDate">, today: string): string {
  const total = experimentLength(e);
  switch (experimentStatus(e, today)) {
    case "upcoming": {
      const d = daysBetween(today, e.startDate);
      return d === 1 ? "Inizia domani" : `Inizia tra ${d} giorni`;
    }
    case "ongoing":
      return `Giorno ${daysBetween(e.startDate, today) + 1} di ${total}`;
    case "ended": {
      const d = daysBetween(e.endDate, today);
      return d === 1 ? `Concluso ieri · ${days(total)}` : `Concluso da ${d} giorni · ${days(total)}`;
    }
  }
}

export interface SplitExperiments {
  /** In corso e programmati: prima quelli già iniziati. */
  active: Experiment[];
  /** Conclusi, dal più recente. */
  ended: Experiment[];
}

export function splitExperiments(list: readonly Experiment[], today: string): SplitExperiments {
  const active = list.filter((e) => experimentStatus(e, today) !== "ended");
  active.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const ended = list.filter((e) => experimentStatus(e, today) === "ended");
  ended.sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0));
  return { active, ended };
}

/** Il periodo di riferimento: i giorni immediatamente prima dell'inizio, tanti quanti quelli dell'esperimento. */
export function referencePeriod(startDate: string, endDate: string): { from: string; to: string; days: number } {
  const length = daysBetween(startDate, endDate) + 1;
  return { from: addDays(startDate, -length), to: addDays(startDate, -1), days: length };
}

// ---------------------------------------------------------------------------------------------
// Misure

const MEASURE_NAMES: Record<ExperimentMeasure, string> = {
  ...OUTCOME_LABELS,
  weight: "variazione del peso",
  energyIntake: "energia assunta",
};

export const measureName = (m: ExperimentMeasure): string => MEASURE_NAMES[m];

export function measureChoiceLabel(m: ExperimentMeasure): string {
  const name = MEASURE_NAMES[m];
  return name[0].toUpperCase() + name.slice(1);
}

export const MEASURE_CHOICES: readonly ExperimentMeasure[] = EXPERIMENT_MEASURES;

export const isOutcomeMeasure = (m: ExperimentMeasure): m is OutcomeKey => m !== "weight" && m !== "energyIntake";

/** Cifre con cui mostrare le differenze di una misura. */
export function measureDigits(m: ExperimentMeasure): number {
  return m === "energyIntake" ? 0 : 2;
}

// ---------------------------------------------------------------------------------------------
// Modulo di creazione

export interface ExperimentFormValues {
  title: string;
  change: string;
  startDate: string;
  endDate: string;
  measures: ExperimentMeasure[];
  /** Alimenti da escludere, separati da virgola o a capo. */
  excludedFoods: string;
}

export type ExperimentFormField = "title" | "change" | "startDate" | "endDate" | "measures" | "excludedFoods";

export function emptyExperimentForm(today: string): ExperimentFormValues {
  return {
    title: "",
    change: "",
    startDate: today,
    endDate: addDays(today, EXPERIMENT_DEFAULT_DAYS - 1),
    measures: [],
    excludedFoods: "",
  };
}

export function splitFoods(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n;]/)) {
    const name = raw.trim();
    if (name === "" || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export type ExperimentFormResult =
  | { ok: true; body: ExperimentBody }
  | { ok: false; errors: Partial<Record<ExperimentFormField, string>> };

/** Legge il modulo; le regole sono quelle del motore (si prova a creare l'evento), qui solo i messaggi in italiano. */
export function parseExperimentForm(values: ExperimentFormValues, today: string): ExperimentFormResult {
  const errors: Partial<Record<ExperimentFormField, string>> = {};
  const title = values.title.trim();
  const change = values.change.trim();
  const max = EXPERIMENT_LIMITS.maxTextLength;
  if (title === "") errors.title = "Dai un titolo all'esperimento.";
  else if (title.length > max) errors.title = `Il titolo può essere lungo al massimo ${max} caratteri.`;
  if (change === "") errors.change = "Scrivi che cosa cambi, per esempio «niente caffè dopo le 14».";
  else if (change.length > max) errors.change = `Il testo può essere lungo al massimo ${max} caratteri.`;

  const startOk = isCalendarDate(values.startDate);
  const endOk = isCalendarDate(values.endDate);
  if (!startOk) errors.startDate = "Scegli il giorno di inizio.";
  if (!endOk) errors.endDate = "Scegli l'ultimo giorno.";
  if (startOk && endOk) {
    if (values.endDate < values.startDate) errors.endDate = "L'ultimo giorno non può venire prima dell'inizio.";
    else if (daysBetween(values.startDate, values.endDate) + 1 > EXPERIMENT_LIMITS.maxDays) {
      errors.endDate = `Un esperimento può durare al massimo ${EXPERIMENT_LIMITS.maxDays} giorni.`;
    } else if (values.endDate < today) {
      errors.endDate = "L'esperimento sarebbe già finito: scegli un ultimo giorno da oggi in poi.";
    }
  }
  if (values.measures.length === 0) errors.measures = "Scegli almeno una misura da osservare.";
  const foods = splitFoods(values.excludedFoods);
  if (foods.length > EXPERIMENT_LIMITS.maxExcludedFoods) {
    errors.excludedFoods = `Al massimo ${EXPERIMENT_LIMITS.maxExcludedFoods} alimenti.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: ExperimentBody = {
    experimentId: generateId(),
    title,
    change,
    startDate: values.startDate,
    endDate: values.endDate,
    measures: EXPERIMENT_MEASURES.filter((m) => values.measures.includes(m)),
    ...(foods.length > 0 ? { excludedFoods: foods } : {}),
  };
  try {
    createExperiment(body, { deviceId: "check" });
  } catch {
    return { ok: false, errors: { title: "I dati dell'esperimento non sono validi: controlla i campi." } };
  }
  return { ok: true, body };
}

// ---------------------------------------------------------------------------------------------
// Eventi di modifica: parziali, con il solo campo che cambia

/** Si può chiudere in anticipo solo ciò che è iniziato e non è ancora finito. */
export function canCloseEarly(e: Experiment, today: string): boolean {
  return experimentStatus(e, today) === "ongoing" && e.endDate > today;
}

/** Chiusura anticipata: l'ultimo giorno diventa oggi, e oggi conta se risulta completo. */
export function closeEarlyPatch(e: Experiment, today: string): ExperimentPatch | undefined {
  return canCloseEarly(e, today) ? { closedOn: today } : undefined;
}

/** Annullamento: ritira l'esperimento; «Annulla» (un `void`) lo riporta com'era. */
export const archivePatch = (): ExperimentPatch => ({ archived: true });

/** Ripristino di un esperimento annullato. */
export const restorePatch = (): ExperimentPatch => ({ archived: false });

/** Aderenza dichiarata; senza valore la toglie. */
export const adherencePatch = (adherence: number | undefined): ExperimentPatch => ({
  declaredAdherence: adherence === undefined ? null : adherence,
});

export type RenameResult =
  | { ok: true; patch: ExperimentPatch }
  | { ok: false; errors: Partial<Record<"title" | "change" | "nothing", string>> };

/** Titolo e descrizione: l'evento dichiara solo ciò che è cambiato davvero. */
export function renamePatch(e: Pick<Experiment, "title" | "change">, title: string, change: string): RenameResult {
  const errors: Partial<Record<"title" | "change" | "nothing", string>> = {};
  const t = title.trim();
  const c = change.trim();
  const max = EXPERIMENT_LIMITS.maxTextLength;
  if (t === "") errors.title = "Dai un titolo all'esperimento.";
  else if (t.length > max) errors.title = `Il titolo può essere lungo al massimo ${max} caratteri.`;
  if (c === "") errors.change = "Scrivi che cosa cambi.";
  else if (c.length > max) errors.change = `Il testo può essere lungo al massimo ${max} caratteri.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const patch: ExperimentPatch = {
    ...(t !== e.title ? { title: t } : {}),
    ...(c !== e.change ? { change: c } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: false, errors: { nothing: "Non hai cambiato nulla." } };
  return { ok: true, patch };
}

export function buildExperimentEvent(
  body: ExperimentBody,
  options: { deviceId: string; now?: () => string },
) {
  return createExperiment(body, options);
}

export function buildExperimentUpdate(
  experimentId: string,
  patch: ExperimentPatch,
  options: { deviceId: string; now?: () => string },
): ExperimentUpdateEvent {
  return updateExperiment(experimentId, patch, options);
}

/** Anomalie del registro degli esperimenti, in italiano; `titleOf` dà il titolo di un esperimento. */
export function anomalyText(a: ExperimentAnomaly, titleOf: (experimentId: string) => string | undefined): string {
  const name = a.experimentId !== undefined ? `«${titleOf(a.experimentId) ?? "esperimento"}»` : "un esperimento";
  switch (a.code) {
    case "closure_conflict": {
      const dates = [...new Set((a.closures ?? []).map((c) => c.closedOn))].sort().map((d) => formatCalendarDate(d));
      return `${name} è stato concluso in giorni diversi (${dates.join(" e ")}), forse da due dispositivi: vale il giorno più vicino all'inizio${a.applied !== undefined ? `, ${formatCalendarDate(a.applied)}` : ""}.`;
    }
    case "orphan_update":
      return `Una modifica riguarda un esperimento che non esiste più (la sua creazione è stata annullata o manca): viene ignorata.`;
    case "invalid_closure":
      return `Una chiusura di ${name} cade prima dell'inizio: viene ignorata.`;
    default:
      return "Un evento di esperimento nel registro non è leggibile e viene ignorato.";
  }
}

export const ADHERENCE_CHOICES = [
  { value: 1, label: "Tutti i giorni" },
  { value: 0.9, label: "Quasi sempre" },
  { value: 0.75, label: "Per tre quarti" },
  { value: 0.5, label: "A metà" },
  { value: 0.25, label: "Poco" },
] as const;

// ---------------------------------------------------------------------------------------------
// Testi del confronto

type Compared = Extract<MeasureComparison, { status: "compared" }>;

function assertNever(value: never): never {
  throw new Error(`Verdetto non gestito: ${String(value)}`);
}

/** Esito di una misura. A esperimento in corso è solo "provvisorio": mai una direzione né «distinguibile». */
export function verdictText(m: Compared): string {
  switch (m.verdict) {
    case "provisional":
      return "Provvisorio: l'esperimento è in corso";
    case "not_distinguishable":
      return "Non distinguibile dalla variabilità abituale";
    case "distinguishable":
      return m.direction === "lower"
        ? "Più basso del riferimento, distinguibile dalla variabilità abituale"
        : "Più alto del riferimento, distinguibile dalla variabilità abituale";
    default:
      return assertNever(m.verdict);
  }
}

export function formatMeasureValue(m: ExperimentMeasure, value: number): string {
  return formatDecimal(value, measureDigits(m));
}

/** "+0,12 punti (tra −0,31 e +0,55, al 95%)": la differenza insieme al suo intervallo. */
export function differenceText(m: Compared): string {
  const d = measureDigits(m.measure);
  return `${formatSigned(m.difference, d)} ${m.unit} (tra ${formatSigned(m.interval.low, d)} e ${formatSigned(m.interval.high, d)}, al ${formatPercent(m.interval.confidence)})`;
}

/** Cosa manca a una misura con dati insufficienti, con i numeri dei due periodi. */
export function measureMissingText(m: Extract<MeasureComparison, { status: "insufficient" }>): string[] {
  const out: string[] = [];
  const isWeight = m.measure === "weight";
  const min = isWeight ? EXPERIMENT_MIN.weighIns : EXPERIMENT_MIN.observations;
  const count = (n: number): string => (isWeight ? weighIns(n) : days(n));
  const reasons: MeasureInsufficientReason[] = m.reasons;
  if (reasons.includes("short_weight_span")) {
    out.push(`Le pesate di un periodo coprono meno di ${EXPERIMENT_MIN.weightSpanDays} giorni: servono pesate più distanziate.`);
  }
  out.push(`Riferimento: ${count(m.reference.n)} su ${min} necessari. Esperimento: ${count(m.experiment.n)} su ${min}.`);
  const missExp = Math.max(0, min - m.experiment.n);
  const missRef = Math.max(0, min - m.reference.n);
  if (missExp > 0) out.push(`Nel periodo dell'esperimento ne mancano ancora ${missExp}.`);
  if (missRef > 0) out.push(`Nel periodo di riferimento ne mancano ${missRef}: si possono ancora registrare i giorni passati.`);
  if (!isWeight) out.push("Contano solo i giorni tracciati per intero in cui il dato è stato registrato.");
  return out;
}

export function adherenceLines(a: AdherenceInfo): string[] {
  const out: string[] = [];
  if (a.declared !== undefined) out.push(`Dichiarata da te: ${formatPercent(a.declared)}.`);
  else out.push("Non hai dichiarato quanto l'hai seguito.");
  if (a.measured) {
    const m = a.measured;
    if (m.daysChecked === 0) {
      out.push("Misurata: nessun giorno completo nel periodo, non si può controllare.");
    } else {
      out.push(
        `Misurata sui pasti registrati: ${m.daysAdherent} giorni su ${m.daysChecked} completi senza ${a.excludedFoods.join(", ")}.`,
      );
    }
    out.push(
      `Nel periodo di riferimento: ${m.referenceDaysWithFood} giorni su ${m.referenceDaysChecked} completi con quegli alimenti.`,
    );
  } else if (a.excludedFoods.length === 0) {
    out.push("Non hai indicato alimenti da escludere: l'aderenza non si misura sui pasti.");
  }
  if (a.lowAdherence) out.push(`Sotto il ${formatPercent(a.minAdherence)}: l'affidabilità resta bassa.`);
  return out;
}

/** Una riga: quante misure sono state confrontate insieme e che la soglia ne tiene conto. */
export function multiplicityText(mult: ExperimentComparisonOk["multiplicity"], provisional: boolean): string {
  const alpha = formatPercent(mult.alpha);
  const compared =
    mult.measuresCompared === mult.measuresRequested
      ? `${mult.measuresCompared} ${mult.measuresCompared === 1 ? "misura confrontata" : "misure confrontate insieme"}`
      : `${mult.measuresCompared} misure confrontate su ${mult.measuresRequested} richieste (le altre hanno dati insufficienti)`;
  if (mult.measuresCompared <= 1) return `${compared}: nessuna correzione necessaria.`;
  return provisional
    ? `${compared}. A esperimento concluso la soglia terrà conto del numero di misure (correzione di Holm, probabilità massima di una coincidenza ${alpha}).`
    : `${compared}. La soglia tiene conto del numero di misure (correzione di Holm): la probabilità che almeno una differenza appaia per caso, senza effetto reale, è al massimo ${alpha}.`;
}

/** Perché i giorni vicini valgono come meno osservazioni, in parole semplici. */
export function autocorrelationLines(m: Compared): string[] {
  const ac = m.autocorrelation;
  const side = (what: string, s: { rho: number; pairs: number; effectiveN: number }, n: number): string =>
    `${what}: somiglianza tra giorni consecutivi ${formatDecimal(s.rho, 2)} (su ${plural(s.pairs, "coppia", "coppie")}); ${plural(n, "giorno vale", "giorni valgono")} come circa ${formatDecimal(s.effectiveN, 1)} osservazioni indipendenti.`;
  const lines = [
    "I giorni vicini tendono a somigliarsi (un buon umore o una settimana tranquilla si trascinano): per questo non valgono come osservazioni del tutto indipendenti.",
  ];
  if (!ac.applied) {
    lines.push("In questo confronto si è usato il numero di giorni, senza correzione.");
    return lines;
  }
  lines.push(side("Esperimento", ac.experiment, m.experiment.n));
  lines.push(side("Riferimento", ac.reference, m.reference.n));
  lines.push("L'intervallo e la soglia usano questo numero efficace, non il numero di giorni: sono quindi più larghi e più prudenti.");
  if (m.pValue !== undefined && m.adjustedPValue !== undefined) {
    lines.push(`Valore p ${formatDecimal(m.pValue, 4)}, dopo la correzione per il numero di misure ${formatDecimal(m.adjustedPValue, 4)}.`);
  }
  return lines;
}

/** Autocorrelazione dei residui del peso, per i dettagli di dispendio e proiezione. */
export function weightAutocorrelationText(ac: { rho: number; pairs: number }): string {
  return `Le pesate di giorni vicini tendono a somigliarsi: somiglianza tra residui consecutivi ${formatDecimal(ac.rho, 2)}, su ${plural(ac.pairs, "coppia", "coppie")}. Quando è alta le pesate valgono come meno osservazioni indipendenti e l'intervallo viene allargato.`;
}
