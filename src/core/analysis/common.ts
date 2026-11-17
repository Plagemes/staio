// Tipi e aiuti comuni a tutte le analisi personali.
// Regola di fondo: un risultato dice su quanti dati si basa e con quale affidabilità; sotto la
// soglia minima non dà un numero ma "dati insufficienti". Si parla di andamenti e associazioni
// osservate, mai di diagnosi, cause o carenze.

import { dayCoverage, daysBetween, type DiaryDay } from "../diary";

/** Affidabilità del risultato, secondo la quantità di dati su cui si basa. */
export type Reliability = "low" | "moderate" | "good";

/** Su quali dati si basa un risultato. */
export interface DataBasis {
  /** Giorni di calendario del periodo considerato. */
  periodDays: number;
  /** Giorni effettivamente usati (tracciati per intero, con il dato richiesto). */
  usedDays: number;
  /** Giorni del periodo esclusi perché con vuoti o senza il dato: `periodDays - usedDays`. */
  excludedDays: number;
  /** Osservazioni usate (pesate, valori giornalieri, ...). */
  observations: number;
  /** Data dell'ultimo dato usato (`YYYY-MM-DD`), se c'è. */
  lastDataDate?: string;
  /** Il periodo non è ancora finito: i giorni futuri non sono contati. Vedi `throughDate`. */
  partial?: boolean;
  /** Ultimo giorno contato di un periodo parziale. */
  throughDate?: string;
}

/**
 * Quanto è recente un risultato rispetto a una data di riferimento (la fine richiesta della finestra
 * o "oggi"). Un risultato `dated` non va presentato come attuale.
 */
export interface Freshness {
  lastDataDate?: string;
  /** Data di confronto; assente se non è stata passata né `to` né `today`: la freschezza non è verificabile. */
  referenceDate?: string;
  /** Giorni tra l'ultimo dato e la data di riferimento. */
  daysBehind?: number;
  toleranceDays: number;
  /** L'ultimo dato è più vecchio della tolleranza rispetto alla data di riferimento. */
  dated: boolean;
}

export function freshnessOf(
  lastDataDate: string | undefined,
  referenceDate: string | undefined,
  toleranceDays: number,
): Freshness {
  const daysBehind =
    lastDataDate !== undefined && referenceDate !== undefined
      ? Math.max(0, daysBetween(lastDataDate, referenceDate))
      : undefined;
  return {
    ...(lastDataDate !== undefined ? { lastDataDate } : {}),
    ...(referenceDate !== undefined ? { referenceDate } : {}),
    ...(daysBehind !== undefined ? { daysBehind } : {}),
    toleranceDays,
    dated: daysBehind !== undefined && daysBehind > toleranceDays,
  };
}

/** Avvertenze in italiano per un risultato datato (vuoto se è attuale o non verificabile). */
export function freshnessWarnings(f: Freshness): string[] {
  if (!f.dated || f.lastDataDate === undefined) return [];
  return [
    `Risultato datato: l'ultimo dato è del ${f.lastDataDate}, ${f.daysBehind} giorni prima della data di riferimento. Non descrive la situazione attuale.`,
  ];
}

/** Risultato sotto la soglia minima di dati: nessun numero, solo i motivi. */
export interface Insufficient<Reason extends string> {
  status: "insufficient";
  reasons: Reason[];
  basis: DataBasis;
  /** Testo per l'utente, in italiano. */
  message: string;
}

/** Soglie del numero di dati per i gradi di affidabilità; sotto `moderate` l'affidabilità è bassa. */
export interface ReliabilitySteps {
  moderate: number;
  good: number;
}

export function reliabilityBySize(n: number, steps: ReliabilitySteps): Reliability {
  if (n >= steps.good) return "good";
  if (n >= steps.moderate) return "moderate";
  return "low";
}

const RELIABILITY_RANK: Record<Reliability, number> = { low: 0, moderate: 1, good: 2 };

/** La meno affidabile tra due affidabilità. */
export function lowerReliability(a: Reliability, b: Reliability): Reliability {
  return RELIABILITY_RANK[a] <= RELIABILITY_RANK[b] ? a : b;
}

export function basisOf(
  periodDays: number,
  usedDays: number,
  observations: number,
  extra: Pick<DataBasis, "lastDataDate" | "partial" | "throughDate"> = {},
): DataBasis {
  return {
    periodDays,
    usedDays,
    excludedDays: Math.max(0, periodDays - usedDays),
    observations,
    ...(extra.lastDataDate !== undefined ? { lastDataDate: extra.lastDataDate } : {}),
    ...(extra.partial === true ? { partial: true } : {}),
    ...(extra.throughDate !== undefined ? { throughDate: extra.throughDate } : {}),
  };
}

/** La più recente tra le date (`undefined` se non ce n'è nessuna). */
export function latestDate(dates: readonly (string | undefined)[]): string | undefined {
  let out: string | undefined;
  for (const d of dates) if (d !== undefined && (out === undefined || d > out)) out = d;
  return out;
}

export function insufficient<Reason extends string>(
  reasons: Reason[],
  basis: DataBasis,
  detail: string,
): Insufficient<Reason> {
  return {
    status: "insufficient",
    reasons,
    basis,
    message: `Dati insufficienti: ${detail}`,
  };
}

/**
 * Giorno tracciato per intero secondo il diario: colazione, pranzo e cena tracciati e nessun pasto
 * segnato come non tracciato. Non dice se le voci sono tutte risolte: per i nutrienti vale
 * `DayIntake.complete`.
 */
export function isFullyTracked(day: DiaryDay | undefined, date: string): boolean {
  const cov = dayCoverage(day, date);
  return cov.status === "complete" && cov.untracked === 0;
}

export const inRange = (date: string, from: string, to: string): boolean =>
  date >= from && date <= to;

/** Giorno della settimana, 0 = lunedì ... 6 = domenica, di una data di calendario. */
export function weekdayMonday0(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Numero con al massimo un decimale e la virgola, per i testi in italiano. */
export function formatNumber(n: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f).replace(".", ",");
}
