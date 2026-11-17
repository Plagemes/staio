// Testi e numeri delle analisi, in italiano. Funzioni pure: la regola è che un numero non esce mai
// senza la sua base e la sua affidabilità, e che un esito insufficiente dice cosa manca.
import type {
  AssociationControl,
  AssociationsResult,
  DataBasis,
  ExpenditureEstimate,
  ExpenditureResult,
  ProjectionResult,
  Reliability,
  TimingAnalysis,
} from "@/core/analysis";
import { OUTCOME_LABELS, formatMinutes } from "@/core/analysis";
import { formatCalendarDate } from "../format";
import {
  ASSOCIATION_MIN,
  EXPENDITURE_MIN,
  EXPENDITURE_WINDOW_DAYS,
  PROJECTION_MIN,
  PROJECTION_WINDOW_DAYS,
  TIMING_MIN_COMPLETE_DAYS,
} from "./config";

export type Freshness = ExpenditureEstimate["freshness"];

const formatters = new Map<number, Intl.NumberFormat>();
function numberFormat(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/** "1,5", "2350": al massimo `digits` decimali, virgola decimale, senza zeri inutili. */
export function formatDecimal(value: number, digits = 1): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return numberFormat(digits)
    .format(Object.is(rounded, -0) ? 0 : rounded)
    .replace("-", "−");
}

/** Con il segno esplicito (più o meno, vero segno meno): per le differenze. */
export function formatSigned(value: number, digits = 1): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${numberFormat(digits).format(Math.abs(rounded))}`;
}

export const formatKcal = (kcal: number): string => `${formatDecimal(kcal, 0)} kcal`;

/** "72,4 kg" con un decimale: la precisione di una bilancia domestica. */
export const formatKgValue = (kg: number): string => `${formatDecimal(kg, 1)} kg`;

export const formatKgPerWeek = (kg: number): string => `${formatSigned(kg, 2)} kg a settimana`;

/** "tra 2100 e 2600 kcal": l'intervallo, mai il solo valore centrale. */
export function formatRange(low: number, high: number, unit: string, digits = 0): string {
  return `tra ${formatDecimal(low, digits)} e ${formatDecimal(high, digits)} ${unit}`;
}

export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`;

export function plural(n: number, one: string, many: string): string {
  return `${formatDecimal(n, 0)} ${n === 1 ? one : many}`;
}

export const days = (n: number): string => plural(n, "giorno", "giorni");
export const weighIns = (n: number): string => plural(n, "pesata", "pesate");

/** "1 h 20 min", "45 min": durate in minuti. */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export const RELIABILITY_LABELS: Record<Reliability, string> = {
  low: "bassa",
  moderate: "media",
  good: "buona",
};

export const reliabilityText = (r: Reliability): string => `Affidabilità ${RELIABILITY_LABELS[r]}`;

/** Spiega cosa significa quel livello, perché "media" da sola non dice niente. */
export function reliabilityHint(r: Reliability): string {
  switch (r) {
    case "low":
      return "Pochi dati o molta incertezza: leggila come un'indicazione, non come un risultato.";
    case "moderate":
      return "Dati discreti: l'intervallo è ancora ampio e può cambiare con nuove registrazioni.";
    case "good":
      return "Dati abbondanti per questo tipo di stima, che resta comunque una stima.";
  }
}

/**
 * "Giorni usati: 20 su 28 · 24 osservazioni". Se il periodo non è finito i giorni sono quelli
 * trascorsi: lo dice, con l'ultimo giorno contato.
 */
export function basisText(basis: DataBasis, what: { used: string; observations?: { singular: string; plural: string } }): string {
  const head = basis.partial
    ? `${what.used}: ${basis.usedDays} su ${basis.periodDays} trascorsi`
    : `${what.used}: ${basis.usedDays} su ${basis.periodDays}`;
  const parts = [head];
  if (basis.partial && basis.throughDate !== undefined) {
    parts[0] += ` (periodo non finito, contato fino al ${formatCalendarDate(basis.throughDate)})`;
  }
  if (basis.excludedDays > 0) {
    parts[0] += ` (${basis.excludedDays} esclusi perché non tracciati per intero o senza il dato)`;
  }
  if (what.observations !== undefined) parts.push(`${plural(basis.observations, what.observations.singular, what.observations.plural)}`);
  return parts.join(" · ");
}

/** Data dell'ultimo dato usato e, se il risultato è datato, l'avviso. */
export function freshnessLines(f: Freshness, warnings: readonly string[]): { last?: string; dated?: string; other: string[] } {
  const last = f.lastDataDate !== undefined ? `Ultimo dato usato: ${formatCalendarDate(f.lastDataDate)}.` : undefined;
  if (f.dated && f.lastDataDate !== undefined) {
    const behind = f.daysBehind ?? 0;
    return {
      ...(last ? { last } : {}),
      dated: `Risultato datato: l'ultimo dato è di ${days(behind)} fa (soglia ${f.toleranceDays}). Non descrive la situazione attuale: registra i giorni recenti per aggiornarlo.`,
      other: [],
    };
  }
  return { ...(last ? { last } : {}), other: [...warnings] };
}

/** Come si è controllato il rischio di coincidenze, in parole semplici. */
export function associationControlText(c: AssociationControl): string[] {
  const rate = formatPercent(c.nominalFalsePositiveRate);
  const lines: string[] = [];
  if (c.method === "holm+permutation") {
    lines.push(
      `Sono stati fatti ${c.comparisons} confronti. Ognuno ha passato due controlli: una correzione per il numero di confronti e una prova di rimescolamento (i giorni vengono rimescolati ${formatDecimal(c.permutations, 0)} volte per vedere se la differenza compare anche per caso).`,
    );
  } else {
    lines.push(`Sono stati fatti ${c.comparisons} confronti, con una correzione per il loro numero (senza la prova di rimescolamento).`);
  }
  lines.push(
    `Su dati senza alcuna associazione, la probabilità che ne compaia anche una sola è al massimo del ${rate}. Questa garanzia vale se i giorni sono scambiabili tra loro, cioè senza andamenti nel tempo (stagioni, periodi di stress, cambi di abitudine): se ci sono, qualche coincidenza in più è possibile.`,
  );
  if (c.passedTTest > 0 && c.method === "holm+permutation") {
    lines.push(`${plural(c.passedTTest, "associazione aveva", "associazioni avevano")} superato il primo controllo.`);
  }
  if (c.resolutionLimited) {
    lines.push("Con così tanti confronti la prova di rimescolamento non può confermare nessuna associazione: nessuna viene mostrata.");
  }
  return lines;
}

/** Cosa mostrare quando un esito è insufficiente: il perché, e cosa manca. Mai zero né una schermata vuota. */
export interface InsufficientView {
  title: string;
  /** Perché non c'è un numero. */
  reasons: string[];
  /** Cosa serve ancora, con i numeri. */
  missing: string[];
}

const TITLE = "Dati insufficienti per una stima";

function need(have: number, min: number): number {
  return Math.max(0, min - have);
}

export interface ExpenditureContext {
  /** Giorni tra la prima e l'ultima pesata della finestra. */
  weightSpanDays: number;
}

export function expenditureInsufficient(
  result: Extract<ExpenditureResult, { status: "insufficient" }>,
  ctx: ExpenditureContext,
): InsufficientView {
  const reasons: string[] = [];
  const missing: string[] = [];
  const used = result.basis.usedDays;
  for (const reason of result.reasons) {
    switch (reason) {
      case "no_data":
        reasons.push("Non c'è ancora nessun dato di pasti o di peso.");
        missing.push(
          `Servono almeno ${EXPENDITURE_MIN.completeDays} giorni tracciati per intero e ${EXPENDITURE_MIN.weighIns} pesate.`,
        );
        break;
      case "few_complete_days":
        reasons.push(
          `Negli ultimi ${EXPENDITURE_WINDOW_DAYS} giorni ne hai ${used} tracciati per intero con l'energia nota.`,
        );
        missing.push(`Mancano ancora ${days(need(used, EXPENDITURE_MIN.completeDays))} tracciati per intero (colazione, pranzo e cena).`);
        break;
      case "partial_energy":
        reasons.push(
          `${days(result.exclusions.partialEnergyDays)} completi non contano perché per alcune voci manca il valore dell'energia: la somma sarebbe un minimo, non l'assunzione.`,
        );
        break;
      case "few_weigh_ins":
        reasons.push(`Nella finestra hai ${weighIns(result.weighIns)}.`);
        missing.push(`Mancano ancora ${weighIns(need(result.weighIns, EXPENDITURE_MIN.weighIns))}.`);
        break;
      case "short_weight_span":
        reasons.push(`Le pesate coprono ${days(ctx.weightSpanDays)}, troppo pochi per vedere un andamento.`);
        missing.push(
          `Servono pesate distribuite su almeno ${EXPENDITURE_MIN.spanDays} giorni: ancora ${days(need(ctx.weightSpanDays, EXPENDITURE_MIN.spanDays))}.`,
        );
        break;
      case "low_used_share":
        reasons.push("Meno della metà dei giorni della finestra è tracciata per intero.");
        missing.push("Servono più giorni con colazione, pranzo e cena tracciati.");
        break;
      case "implausible_estimate":
        reasons.push(
          "Il bilancio tra energia registrata e variazione del peso dà un valore incoerente: i dati del periodo non bastano per una stima.",
        );
        missing.push("Più giorni di dati, pesate regolari e quantità registrate con cura rendono il calcolo possibile.");
        break;
    }
  }
  if (result.exclusions.incompleteDays > 0 && !result.reasons.includes("few_complete_days")) {
    reasons.push(`${days(result.exclusions.incompleteDays)} nella finestra non sono tracciati per intero.`);
  }
  return { title: TITLE, reasons, missing };
}

export interface ProjectionContext {
  weightSpanDays: number;
  /** Giorni dall'ultima pesata a oggi, se c'è una pesata. */
  daysSinceLastWeighIn?: number;
}

export function projectionInsufficient(
  result: Extract<ProjectionResult, { status: "insufficient" }>,
  ctx: ProjectionContext,
): InsufficientView {
  const reasons: string[] = [];
  const missing: string[] = [];
  for (const reason of result.reasons) {
    switch (reason) {
      case "no_data":
        reasons.push("Non hai ancora registrato nessuna pesata.");
        missing.push(`Servono almeno ${PROJECTION_MIN.weighIns} pesate in ${PROJECTION_WINDOW_DAYS} giorni.`);
        break;
      case "few_weigh_ins":
        reasons.push(`Negli ultimi ${PROJECTION_WINDOW_DAYS} giorni hai ${weighIns(result.weighIns)}.`);
        missing.push(`Mancano ancora ${weighIns(need(result.weighIns, PROJECTION_MIN.weighIns))}.`);
        break;
      case "short_weight_span":
        reasons.push(`Le pesate coprono ${days(ctx.weightSpanDays)}.`);
        missing.push(
          `Servono pesate distribuite su almeno ${PROJECTION_MIN.spanDays} giorni: ancora ${days(need(ctx.weightSpanDays, PROJECTION_MIN.spanDays))}.`,
        );
        break;
      case "noisy_trend":
        reasons.push("Da una pesata all'altra il peso oscilla troppo (più di 2 kg attorno alla tendenza) per proiettarla.");
        missing.push("Pesarsi nelle stesse condizioni (stessa ora, prima di mangiare) riduce il rumore.");
        break;
      case "stale_data":
        reasons.push(
          ctx.daysSinceLastWeighIn !== undefined
            ? `L'ultima pesata è di ${days(ctx.daysSinceLastWeighIn)} fa.`
            : "L'ultima pesata è troppo vecchia.",
        );
        missing.push(`Serve una pesata recente (negli ultimi ${PROJECTION_MIN.staleDays} giorni).`);
        break;
    }
  }
  return { title: TITLE, reasons, missing };
}

export function timingInsufficient(result: Extract<TimingAnalysis, { status: "insufficient" }>): InsufficientView {
  if (result.reasons.includes("no_data")) {
    return {
      title: TITLE,
      reasons: ["Non c'è ancora nessun giorno nel diario."],
      missing: [`Servono almeno ${TIMING_MIN_COMPLETE_DAYS} giorni tracciati per intero.`],
    };
  }
  return {
    title: TITLE,
    reasons: [
      `Ci sono ${days(result.completeDays)} tracciati per intero con un orario nel periodo: un pasto mancante falserebbe gli orari, quindi i giorni con vuoti non contano.`,
    ],
    missing: [`Mancano ancora ${days(need(result.completeDays, TIMING_MIN_COMPLETE_DAYS))} tracciati per intero.`],
  };
}

export function associationsInsufficient(
  result: Extract<AssociationsResult, { status: "insufficient" }>,
): InsufficientView {
  const reasons: string[] = [];
  const missing: string[] = [];
  for (const reason of result.reasons) {
    switch (reason) {
      case "no_data":
        reasons.push("Non c'è ancora nessun dato.");
        missing.push(`Servono almeno ${ASSOCIATION_MIN.completeDays} giorni tracciati per intero, con umore o sintomi registrati.`);
        break;
      case "few_complete_days":
        reasons.push(`Hai ${days(result.basis.usedDays)} tracciati per intero negli ultimi giorni considerati.`);
        missing.push(`Mancano ancora ${days(need(result.basis.usedDays, ASSOCIATION_MIN.completeDays))} tracciati per intero.`);
        break;
      case "no_testable_comparisons": {
        reasons.push(
          `Nessun alimento o orario compare in almeno ${ASSOCIATION_MIN.daysWith} giorni e manca in almeno ${ASSOCIATION_MIN.daysWithout} giorni con l'esito registrato.`,
        );
        const outcomes = Object.entries(result.basis.outcomeDays)
          .filter(([, n]) => n > 0)
          .map(([key, n]) => `${OUTCOME_LABELS[key as keyof typeof OUTCOME_LABELS]}: ${n}`);
        missing.push(
          outcomes.length > 0
            ? `Giorni completi con l'esito registrato: ${outcomes.join(", ")}. Servono più giorni con umore o sintomi.`
            : "Nessun giorno completo ha umore o sintomi registrati: senza, non c'è nulla da associare.",
        );
        break;
      }
    }
  }
  return { title: TITLE, reasons, missing };
}

/** Testo della regolarità: quanto variano gli orari da un giorno all'altro. */
export function regularityText(sdMinutes: number): string {
  if (sdMinutes < 30) return `molto regolare (scarto tipico ${formatDuration(sdMinutes)})`;
  if (sdMinutes < 60) return `abbastanza regolare (scarto tipico ${formatDuration(sdMinutes)})`;
  return `variabile (scarto tipico ${formatDuration(sdMinutes)})`;
}

export const formatClock = (minutes: number): string => formatMinutes(minutes);
