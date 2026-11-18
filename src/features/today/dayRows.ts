// Le righe «Acqua» e «Corpo» del diario di un giorno: i bicchieri d'acqua dal registro, le misure del corpo dal
// diario già calcolato. Logica pura: nessun secondo modello del diario, solo letture di `DiaryDay` e del registro.
import {
  createWeight,
  deriveDiary,
  familyConsumes,
  InvalidDiaryEventError,
  localDate,
  mealsWithPantry,
  validateDiaryEvent,
  type DiaryDay,
  type DiaryState,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent } from "@/core/ledger";
import { freezeShared } from "@/data";
import { buildUndo } from "../actions";
import { linkedConsumes } from "../drinks";
import { formatTime } from "../format";
import { formatKg, formatMl, parseWeightKg, SYMPTOM_LABELS } from "../health";

const mealsByLog = new WeakMap<readonly AnyEvent[], { diary: DiaryState; meals: readonly MealWithPantry[] }>();

/**
 * I pasti del diario con i loro consumi (`mealsWithPantry`), calcolati una volta per stato del registro: Oggi li chiede
 * in più punti (il diario del giorno, «Come ieri») e ogni volta si rileggerebbe il registro intero. Il diario deve
 * essere quello dello stesso registro. Il risultato è condiviso: non si modifica sul posto.
 */
export function mealsWithPantryOf(diary: DiaryState, log: readonly AnyEvent[]): readonly MealWithPantry[] {
  const known = mealsByLog.get(log);
  if (known !== undefined && known.diary === diary) return known.meals;
  const meals = freezeShared(mealsWithPantry(diary, log));
  mealsByLog.set(log, { diary, meals });
  return meals;
}

/** Un bicchiere: un evento `water` non annullato. */
export interface WaterGlass {
  eventId: string;
  at: string;
  ml: number;
  /** «10:42» nel fuso del diario. */
  time: string;
  /** «10:42 · 200 ml» */
  text: string;
}

const byAt = (a: { at: string; eventId: string }, b: { at: string; eventId: string }): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;

/**
 * I bicchieri d'acqua di un giorno, dal più recente. Valgono gli eventi `water` validi, non annullati, il cui istante
 * cade in quel giorno nel fuso del diario: gli stessi che il diario somma in `waterMl`.
 */
export function waterGlasses(
  log: readonly AnyEvent[],
  date: string,
  timeZone: string,
  voided: ReadonlySet<string>,
): WaterGlass[] {
  const glasses: WaterGlass[] = [];
  for (const e of log) {
    if (e.type !== "water" || voided.has(e.id)) continue;
    if (localDate(e.at, timeZone) !== date || validateDiaryEvent(e).length > 0) continue;
    const time = formatTime(e.at, timeZone);
    glasses.push({ eventId: e.id, at: e.at, ml: e.ml, time, text: `${time} · ${formatMl(e.ml)}` });
  }
  return glasses.sort((a, b) => byAt(b, a));
}

export type BodyKind = "weight" | "mood" | "symptom" | "supplement";

/** Una voce della riga «Corpo». */
export interface BodyLine {
  eventId: string;
  at: string;
  kind: BodyKind;
  /** «07:40» */
  time: string;
  /** «Peso 72,4 kg», «Umore 4 su 5», «Energia 3 su 5», «Vitamina D, 1 capsula» */
  text: string;
  /** Solo per il peso: il valore, per il foglio che lo corregge. */
  kg?: number;
}

const symptomName = (s: DiaryDay["symptoms"][number]): string =>
  s.kind === "other" ? (s.label?.trim() || "Altro") : SYMPTOM_LABELS[s.kind];

/** Le voci del corpo di un giorno, in ordine di ora: pesate, umori, sintomi, integratori. */
export function bodyLines(day: DiaryDay | undefined, timeZone: string): BodyLine[] {
  if (!day) return [];
  const time = (at: string) => formatTime(at, timeZone);
  const lines: BodyLine[] = [
    ...day.weights.map((w): BodyLine => ({ eventId: w.eventId, at: w.at, kind: "weight", time: time(w.at), text: `Peso ${formatKg(w.kg)}`, kg: w.kg })),
    ...day.moods.map((m): BodyLine => ({ eventId: m.eventId, at: m.at, kind: "mood", time: time(m.at), text: `Umore ${m.score} su 5` })),
    ...day.symptoms.map((s): BodyLine => ({ eventId: s.eventId, at: s.at, kind: "symptom", time: time(s.at), text: `${symptomName(s)} ${s.score} su 5` })),
    ...day.supplements.map(
      (s): BodyLine => ({ eventId: s.eventId, at: s.at, kind: "supplement", time: time(s.at), text: s.dose?.trim() ? `${s.name}, ${s.dose.trim()}` : s.name }),
    ),
  ];
  return lines.sort(byAt);
}

/** Il peso come si scrive nel campo, senza arrotondare: «72,45». */
export const weightInputText = (kg: number): string => String(kg).replace(".", ",");

export type WeightCorrection =
  | { ok: true; unchanged: true }
  | { ok: true; unchanged: false; events: AnyEvent[]; message: string }
  | { ok: false; error: string };

/**
 * Correggere una pesata: l'annullamento della pesata e una pesata nuova alla stessa ora, da scrivere insieme. Il
 * registro va letto al momento del tocco: una pesata già annullata altrove non si fa rivivere. Un valore uguale a
 * quello salvato non cambia niente e non scrive niente.
 */
export function buildWeightCorrection(
  log: readonly AnyEvent[],
  eventId: string,
  text: string,
  ctx: { deviceId: string; now: string; timeZone?: string },
): WeightCorrection {
  const old = log.find((e) => e.id === eventId);
  const voided = new Set(deriveDiary(log, ctx.timeZone ? { timeZone: ctx.timeZone } : {}).voidedEventIds);
  if (!old || old.type !== "weight" || voided.has(old.id)) return { ok: false, error: "Questa pesata non c'è più." };
  const read = parseWeightKg(text);
  if (!read.ok) return { ok: false, error: read.error };
  if (Math.abs(read.value - old.kg) < 1e-9) return { ok: true, unchanged: true };
  try {
    const replacement = createWeight(
      { kg: read.value },
      { deviceId: ctx.deviceId, now: () => ctx.now, at: old.at, certainty: old.certainty, source: old.source, ...(old.note !== undefined ? { note: old.note } : {}) },
    );
    return {
      ok: true,
      unchanged: false,
      events: [...buildUndo([old], { deviceId: ctx.deviceId, now: ctx.now }), replacement],
      message: `Corretto: peso ${formatKg(read.value)}.`,
    };
  } catch (e) {
    if (e instanceof InvalidDiaryEventError) return { ok: false, error: "Questo valore non è accettabile: controlla il numero." };
    throw e;
  }
}

/**
 * I consumi da annullare o da spostare insieme a una bevanda: quelli collegati e tutta la loro famiglia. Se il consumo
 * scalato è stato corretto da due telefoni prima dell'unione, ne vale uno ma l'altro c'è ancora: annullando solo quello
 * che vale, l'altro tornerebbe a contare.
 */
export function drinkConsumes(drinkEventId: string, log: readonly AnyEvent[], voided: Iterable<string>): ConsumeEvent[] {
  const linked = linkedConsumes(drinkEventId, log, voided);
  return linked.length > 0 ? familyConsumes(log, linked) : [];
}

const last = <T extends { at: string; eventId: string }>(list: readonly T[]): T | undefined => [...list].sort(byAt).pop();

/**
 * Il riepilogo della riga «Corpo»: ciò che c'è, in quest'ordine, «peso 72,4 kg · umore 4 · 2 note · 1 integratore».
 * Peso e umore dicono l'ultimo del giorno. `null` se nel giorno non c'è niente: la riga non compare.
 */
export function bodySummary(day: DiaryDay | undefined): string | null {
  if (!day) return null;
  const parts: string[] = [];
  const weight = last(day.weights);
  if (weight) parts.push(`peso ${formatKg(weight.kg)}`);
  const mood = last(day.moods);
  if (mood) parts.push(`umore ${mood.score}`);
  const notes = day.symptoms.length;
  if (notes > 0) parts.push(notes === 1 ? "1 nota" : `${notes} note`);
  const supplements = day.supplements.length;
  if (supplements > 0) parts.push(supplements === 1 ? "1 integratore" : `${supplements} integratori`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
