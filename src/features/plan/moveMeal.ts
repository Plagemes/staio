// «Sposta» e «Togli dal piano» per un pasto pianificato non fatto. Ogni funzione scrive la settimana intera di nuovo
// (un solo evento `planWeek`): «Annulla» sull'avviso fa tornare la versione di prima. Logica pura.
import { getDay, localMoment, mealMoments, type DiaryState, type MealKind } from "@/core/diary";
import {
  compareDayEntries,
  dropMeal,
  freeSlots,
  inWeek,
  missedMeals,
  moveMeal,
  moveMealToWeek,
  type AdherenceOptions,
  type MissedMeal,
  type MissedOptions,
  type MoveError,
  type PlannedEntry,
  type Slot,
  type WeekEntries,
} from "@/core/plan";
import { MAIN_MEALS, MEAL_KIND_LABELS, momentOffer, type DeclarableKind } from "../meals";
import { dayMonth, weekdayName } from "./dates";
import { buildWeek, type PlanContext, type PlanResult } from "./edit";
import { addDays } from "@/core/diary";

const ERRORS: Record<MoveError, string> = {
  nothing_to_move: "Questo pasto non è più nel piano.",
  same_slot: "Scegli un altro giorno o un altro momento.",
  outside_week: "Posso spostarlo solo in questa settimana o nella successiva.",
  same_week: "Scegli un posto di un'altra settimana.",
  slot_taken: "Quel momento ha già un pasto pianificato: scegline uno libero.",
};

/** "lunedì 16 nov, pranzo" */
export function slotText(slot: Slot): string {
  return `${weekdayName(slot.date)} ${dayMonth(slot.date)}, ${MEAL_KIND_LABELS[slot.meal].toLowerCase()}`;
}

export function buildMoveMeal(weekStart: string, entries: readonly PlannedEntry[], from: Slot, to: Slot, ctx: PlanContext): PlanResult {
  const moved = moveMeal(entries, weekStart, from, to);
  if (!moved.ok) return { ok: false, error: ERRORS[moved.error] };
  return buildWeek(weekStart, moved.entries, ctx, `Spostato: da ${slotText(from)} a ${slotText(to)}.`);
}

/**
 * Sposta un pasto da una settimana a un'altra (di solito la successiva): un solo gruppo di eventi con le due settimane
 * riscritte, che `appendEvents` scrive in un'unica transazione. Se la scrittura fallisce non cambia nulla, quindi il
 * pasto non sparisce mai da una settimana senza comparire nell'altra; «Annulla» annulla le due insieme.
 */
export function buildMoveMealToWeek(source: WeekEntries, target: WeekEntries, from: Slot, to: Slot, ctx: PlanContext): PlanResult {
  const moved = moveMealToWeek(source, target, from, to);
  if (!moved.ok) return { ok: false, error: ERRORS[moved.error] };
  const a = buildWeek(source.weekStart, moved.from, ctx, "");
  if (!a.ok) return a;
  const b = buildWeek(target.weekStart, moved.to, ctx, "");
  if (!b.ok) return b;
  return { ok: true, events: [...a.events, ...b.events], message: `Spostato: da ${slotText(from)} a ${slotText(to)}.` };
}

/** Sposta dentro la settimana di partenza oppure, se il posto è in un'altra, tra le due settimane. */
export function buildMoveMealAnywhere(source: WeekEntries, target: WeekEntries, from: Slot, to: Slot, ctx: PlanContext): PlanResult {
  return inWeek(source.weekStart, to.date) ? buildMoveMeal(source.weekStart, source.entries, from, to, ctx) : buildMoveMealToWeek(source, target, from, to, ctx);
}

/** Il lunedì della settimana dopo `weekStart`. */
export const nextWeekStart = (weekStart: string): string => addDays(weekStart, 7);

export function buildDropMeal(weekStart: string, entries: readonly PlannedEntry[], from: Slot, ctx: PlanContext): PlanResult {
  const dropped = dropMeal(entries, from);
  if (!dropped.ok) return { ok: false, error: ERRORS[dropped.error] };
  return buildWeek(weekStart, dropped.entries, ctx, `Tolto dal piano: ${slotText(from)}.`);
}

/** Come leggere il diario e l'ora per sapere quali momenti di oggi sono passati e che cosa c'è già scritto. */
export function momentReaders(args: { diary: DiaryState; now: string; timeZone: string; today: string }): Pick<MissedOptions, "status" | "overdue"> {
  const minutes = localMoment(args.now, args.timeZone)?.minutes ?? 0;
  return {
    status: (date, meal) => mealMoments(getDay(args.diary, date)).find((m) => m.kind === meal)?.status ?? "none",
    overdue: (meal) => momentOffer(meal as DeclarableKind, minutes) === "declare",
  };
}

interface WeekArgs {
  weekEntries: readonly PlannedEntry[];
  diary: DiaryState;
  now: string;
  timeZone: string;
  today: string;
}

/**
 * I pasti pianificati di questa settimana, fino a oggi, saltati o non registrati. Con `adherence` un pasto che è stato
 * mangiato in un altro momento dello stesso giorno (pianificato a pranzo, mangiato a cena) non risulta mancato: lo
 * riconosce l'aderenza del piano, con gli stessi criteri della verifica.
 */
export function missedThisWeek(args: WeekArgs & { adherence?: AdherenceOptions }): MissedMeal[] {
  const missed = missedMeals(args.weekEntries, { today: args.today, ...momentReaders(args) });
  const { adherence } = args;
  if (!adherence) return missed;
  const eaten = new Map<string, ReturnType<typeof compareDayEntries>>();
  return missed.filter((m) => {
    let day = eaten.get(m.date);
    if (!day) {
      day = compareDayEntries(m.date, args.weekEntries, args.diary, adherence);
      eaten.set(m.date, day);
    }
    const results = day.entries.filter((r) => r.meal === m.meal);
    return !(results.length > 0 && results.every((r) => r.status === "respected"));
  });
}

/**
 * I posti liberi, da oggi a domenica, dove si può spostare il pasto `from`; con `nextWeek` anche quelli della settimana
 * dopo (tutti i suoi giorni, nessun vincolo di orario).
 */
export function slotsToMoveTo(args: WeekArgs & { weekStart: string; kinds?: readonly MealKind[]; from: Slot; nextWeek?: WeekEntries }): Slot[] {
  const kinds = args.kinds && args.kinds.length > 0 ? args.kinds : MAIN_MEALS;
  const readers = momentReaders(args);
  const thisWeek = freeSlots(args.weekEntries, { today: args.today, weekStart: args.weekStart, kinds, exclude: args.from, ...readers });
  if (!args.nextWeek) return thisWeek;
  const later = freeSlots(args.nextWeek.entries, { today: args.today, weekStart: args.nextWeek.weekStart, kinds, ...readers });
  return [...thisWeek, ...later];
}

/** I posti liberi di una settimana, da oggi a domenica, per i momenti scelti: dove «Proponi una settimana» può mettere una ricetta. */
export function slotsToFill(args: WeekArgs & { weekStart: string; kinds: readonly MealKind[] }): Slot[] {
  return freeSlots(args.weekEntries, { today: args.today, weekStart: args.weekStart, kinds: args.kinds, ...momentReaders(args) });
}
