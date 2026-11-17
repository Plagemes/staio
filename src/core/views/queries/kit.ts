// Attrezzi comuni alle interrogazioni: lettura dei parametri, esiti «dati insufficienti», medie.
import { addDays, daysBetween } from "../../diary";
import { worseCertainty, type Certainty } from "../../ledger";
import { NUTRIENT_KEYS, type NutrientKey } from "../../nutrition";
import { NUTRIENT_INFO } from "../labels";
import { PERIODS, resolvePeriod, type Period, type PeriodId } from "../period";
import type { InsufficientResult, ParamDef, Params, ViewContext } from "../types";

export const periodParam = (fallback: PeriodId = "last_30_days"): ParamDef => ({
  kind: "enum",
  values: PERIODS,
  default: fallback,
  description: "periodo, relativo a oggi",
});

export const nutrientParam: ParamDef = { kind: "enum", values: NUTRIENT_KEYS, description: "nutriente" };

export const limitParam = (fallback = 5): ParamDef => ({
  kind: "int",
  min: 1,
  max: 10,
  default: fallback,
  description: "numero massimo di righe",
});

export const nutrientOf = (p: Params): NutrientKey => p.nutrient as NutrientKey;
export const nutrientLabel = (p: Params): string => NUTRIENT_INFO[nutrientOf(p)].label;
export const periodOf = (p: Params, ctx: ViewContext): Period => resolvePeriod(p.period as PeriodId, ctx.today);
export const limitOf = (p: Params): number => Number(p.limit);

export const insufficient = (reason: string, basis = ""): InsufficientResult => ({ kind: "insufficient", reason, basis });

export const noNutrition = (): InsufficientResult =>
  insufficient("I dati nutrizionali non sono ancora pronti: riprova tra un attimo.");

export const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
export const round = (n: number, digits = 6): number => Math.round(n * 10 ** digits) / 10 ** digits;

export function worst(items: readonly (Certainty | undefined)[]): Certainty | undefined {
  let out: Certainty | undefined;
  for (const c of items) if (c !== undefined) out = out === undefined ? c : worseCertainty(out, c);
  return out;
}

/** Quanti dati servono per dare una media: un solo giorno basta solo se il periodo è un giorno. */
export const minSamples = (period: Period): number => (period.days <= 1 ? 1 : 3);

/** Testo normalizzato per il confronto dei nomi: minuscolo, senza accenti né punteggiatura. */
export function normText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Radice prudente di una parola, per unire singolare e plurale («uovo» e «uova», «mela» e «mele»): si toglie la sola vocale
 * finale e solo dalle parole di almeno quattro lettere, così «uva» non diventa «uvetta».
 */
export const stemWord = (word: string): string => (word.length >= 4 ? word.replace(/[aeio]$/, "") : word);

/** Testo normalizzato con ogni parola ridotta alla radice, per cercare un nome come parola intera. */
export const stemWords = (text: string): string => normText(text).split(" ").filter(Boolean).map(stemWord).join(" ");

/** Raggruppa per giorno (periodi fino a 31 giorni) o per settimana, a partire dal primo giorno del periodo. */
export function bucketOf(period: Period): { index: (date: string) => number; start: (index: number) => string; count: number } {
  const size = period.days <= 31 ? 1 : 7;
  return {
    index: (date) => Math.floor(daysBetween(period.from, date) / size),
    start: (index) => addDays(period.from, index * size),
    count: Math.ceil(period.days / size),
  };
}
