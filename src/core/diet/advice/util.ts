// Piccoli strumenti condivisi dal motore dei consigli: date di calendario e lettura dei quadri.
import { DIET_THRESHOLDS, type Indicator, type IndicatorId, type WeekFrame } from "../types";

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Lunedì della settimana che contiene `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(toUtc(date)).getUTCDay(); // 0 domenica
  return addDays(date, -((dow + 6) % 7));
}

export function indicatorOf(frame: WeekFrame, id: IndicatorId): Indicator | undefined {
  return frame.indicators.find((i) => i.id === id);
}

/**
 * Il quadro intero basta per un consiglio. Le soglie sono quelle predefinite: se il quadro
 * fosse stato calcolato con soglie più basse, il motore resta comunque prudente.
 */
export function frameSufficient(frame: WeekFrame): boolean {
  return (
    frame.daysWithData >= DIET_THRESHOLDS.minDaysWithData &&
    frame.coverage.share >= DIET_THRESHOLDS.minCoverage
  );
}

export function indicatorUsable(ind: Indicator | undefined): ind is Indicator & { value: number } {
  return ind !== undefined && ind.status !== "insufficient" && typeof ind.value === "number" && Number.isFinite(ind.value);
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Normalizzazione dei nomi della spesa: minuscole, senza accenti, spazi compattati. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
