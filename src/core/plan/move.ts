// Pasti pianificati non fatti: quali sono, dove si possono spostare, come si spostano o si tolgono.
// Una settimana di piano è un solo evento `planWeek` che sostituisce il precedente, quindi spostare un pasto
// vuol dire riscrivere la settimana con le sue voci su un altro giorno o momento: lo stesso pasto non esiste mai
// in due posti (la lista della spesa e l'aderenza lo contano una volta sola) e quello di partenza non risulta mancato.

import type { MealKind } from "../diary";
import { inWeek, weekDates } from "./calendar";
import type { PlannedEntry } from "./types";

/** Un posto nel piano: un giorno e un momento. */
export interface Slot {
  date: string;
  meal: MealKind;
}

/** Come sta un momento nel diario (stesso significato di `mealMoments`). */
export type MomentStatus = "recorded" | "skipped" | "untracked" | "none";

export type MissedReason =
  /** Il momento è stato dichiarato «saltato». */
  | "skipped"
  /** Il momento è passato e non c'è né un pasto registrato né una dichiarazione. */
  | "not_logged";

export interface MissedMeal extends Slot {
  reason: MissedReason;
  /** Le voci pianificate in quel posto: si spostano o si tolgono insieme. */
  entries: PlannedEntry[];
}

export interface MissedOptions {
  /** Oggi, `YYYY-MM-DD`. Le voci di giorni futuri non sono mai mancate. */
  today: string;
  status: (date: string, meal: MealKind) => MomentStatus;
  /** Per oggi: l'ora in cui quel momento si considera passato (da lì «non registrato» ha senso). */
  overdue: (meal: MealKind) => boolean;
}

/** Colazione, pranzo e cena sono i momenti che si possono dichiarare; gli spuntini no, quindi non si offrono. */
const DECLARABLE: readonly MealKind[] = ["breakfast", "lunch", "dinner"];
const ORDER: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];
const order = (m: MealKind): number => ORDER.indexOf(m);

const clone = (e: PlannedEntry): PlannedEntry => JSON.parse(JSON.stringify(e)) as PlannedEntry;
const at = (e: PlannedEntry, slot: Slot): boolean => e.date === slot.date && e.meal === slot.meal;

/**
 * I pasti pianificati per oggi o per un giorno già passato che non sono stati fatti: dichiarati «saltati», oppure
 * senza registrazione. Un momento «mangiato, non registrato» o registrato non è mancato. In ordine di data e momento.
 */
export function missedMeals(entries: readonly PlannedEntry[], options: MissedOptions): MissedMeal[] {
  const slots = new Map<string, MissedMeal>();
  for (const entry of entries) {
    if (entry.date > options.today || !DECLARABLE.includes(entry.meal)) continue;
    const key = `${entry.date}|${entry.meal}`;
    const known = slots.get(key);
    if (known) {
      known.entries.push(clone(entry));
      continue;
    }
    const status = options.status(entry.date, entry.meal);
    let reason: MissedReason | undefined;
    if (status === "skipped") reason = "skipped";
    else if (status === "none" && (entry.date < options.today || options.overdue(entry.meal))) reason = "not_logged";
    if (reason) slots.set(key, { date: entry.date, meal: entry.meal, reason, entries: [clone(entry)] });
  }
  return [...slots.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order(a.meal) - order(b.meal)));
}

export interface FreeSlotsOptions extends MissedOptions {
  weekStart: string;
  /** I momenti del piano (quelli della struttura, altrimenti colazione, pranzo e cena). */
  kinds: readonly MealKind[];
  /** Il posto di partenza: non si offre. */
  exclude?: Slot;
}

/**
 * I posti liberi da oggi a domenica: senza voci pianificate e, per colazione, pranzo e cena, senza niente nel diario
 * (per oggi, e solo se il momento non è già passato). Mai giorni precedenti a oggi né altre settimane.
 */
export function freeSlots(entries: readonly PlannedEntry[], options: FreeSlotsOptions): Slot[] {
  const taken = new Set(entries.map((e) => `${e.date}|${e.meal}`));
  const kinds = [...new Set(options.kinds)].sort((a, b) => order(a) - order(b));
  const out: Slot[] = [];
  for (const date of weekDates(options.weekStart)) {
    if (date < options.today) continue;
    for (const meal of kinds) {
      if (taken.has(`${date}|${meal}`)) continue;
      if (options.exclude && at({ date, meal } as PlannedEntry, options.exclude)) continue;
      if (DECLARABLE.includes(meal)) {
        if (options.status(date, meal) !== "none") continue;
        if (date === options.today && options.overdue(meal)) continue;
      }
      out.push({ date, meal });
    }
  }
  return out;
}

export type MoveError = "nothing_to_move" | "same_slot" | "outside_week" | "slot_taken" | "same_week";

export type MoveResult = { ok: true; entries: PlannedEntry[] } | { ok: false; error: MoveError };

/**
 * Sposta tutte le voci di un posto su un altro posto libero della stessa settimana. Le altre voci non cambiano, e
 * nemmeno l'ordine. Un posto già occupato non si accetta: non si mescolano due pasti.
 */
export function moveMeal(entries: readonly PlannedEntry[], weekStart: string, from: Slot, to: Slot): MoveResult {
  if (from.date === to.date && from.meal === to.meal) return { ok: false, error: "same_slot" };
  if (!inWeek(weekStart, to.date)) return { ok: false, error: "outside_week" };
  if (!entries.some((e) => at(e, from))) return { ok: false, error: "nothing_to_move" };
  if (entries.some((e) => at(e, to))) return { ok: false, error: "slot_taken" };
  return { ok: true, entries: entries.map((e) => (at(e, from) ? { ...clone(e), date: to.date, meal: to.meal } : clone(e))) };
}

/** Una settimana di piano: il lunedì e le sue voci. */
export interface WeekEntries {
  weekStart: string;
  entries: readonly PlannedEntry[];
}

export type MoveAcrossResult = { ok: true; from: PlannedEntry[]; to: PlannedEntry[] } | { ok: false; error: MoveError };

/**
 * Sposta le voci di un posto su un posto libero di un'altra settimana. Restituisce le due settimane già riscritte: chi
 * scrive deve metterle nello stesso gruppo di eventi, così o cambiano entrambe o nessuna. Il pasto esce dalla
 * settimana di partenza e compare solo in quella di arrivo: spesa e aderenza lo contano una volta sola.
 */
export function moveMealToWeek(source: WeekEntries, target: WeekEntries, from: Slot, to: Slot): MoveAcrossResult {
  if (source.weekStart === target.weekStart) return { ok: false, error: "same_week" };
  if (!inWeek(target.weekStart, to.date)) return { ok: false, error: "outside_week" };
  if (!source.entries.some((e) => at(e, from))) return { ok: false, error: "nothing_to_move" };
  if (target.entries.some((e) => at(e, to))) return { ok: false, error: "slot_taken" };
  const moving = source.entries.filter((e) => at(e, from)).map((e) => ({ ...clone(e), date: to.date, meal: to.meal }));
  return {
    ok: true,
    from: source.entries.filter((e) => !at(e, from)).map(clone),
    to: [...target.entries.map(clone), ...moving],
  };
}

/** Toglie dal piano tutte le voci di un posto. */
export function dropMeal(entries: readonly PlannedEntry[], from: Slot): MoveResult {
  if (!entries.some((e) => at(e, from))) return { ok: false, error: "nothing_to_move" };
  return { ok: true, entries: entries.filter((e) => !at(e, from)).map(clone) };
}
