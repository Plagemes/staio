// «Sposta» e «Togli dal piano» per un pasto pianificato non fatto. Ogni funzione scrive la settimana intera di nuovo
// (un solo evento `planWeek`): «Annulla» sull'avviso fa tornare la versione di prima. Logica pura.
import { getDay, localMoment, mealMoments, type DiaryState, type MealKind } from "@/core/diary";
import {
  dropMeal,
  freeSlots,
  missedMeals,
  moveMeal,
  type MissedMeal,
  type MissedOptions,
  type MoveError,
  type PlannedEntry,
  type Slot,
} from "@/core/plan";
import { MAIN_MEALS, MEAL_KIND_LABELS, momentOffer, type DeclarableKind } from "../meals";
import { dayMonth, weekdayName } from "./dates";
import { buildWeek, type PlanContext, type PlanResult } from "./edit";

const ERRORS: Record<MoveError, string> = {
  nothing_to_move: "Questo pasto non è più nel piano.",
  same_slot: "Scegli un altro giorno o un altro momento.",
  outside_week: "Posso spostarlo solo dentro questa settimana.",
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

export function buildDropMeal(weekStart: string, entries: readonly PlannedEntry[], from: Slot, ctx: PlanContext): PlanResult {
  const dropped = dropMeal(entries, from);
  if (!dropped.ok) return { ok: false, error: ERRORS[dropped.error] };
  return buildWeek(weekStart, dropped.entries, ctx, `Tolto dal piano: ${slotText(from)}.`);
}

/** Come leggere il diario e l'ora per sapere quali momenti di oggi sono passati e che cosa c'è già scritto. */
function momentReaders(args: { diary: DiaryState; now: string; timeZone: string; today: string }): Pick<MissedOptions, "status" | "overdue"> {
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

/** I pasti pianificati di questa settimana, fino a oggi, saltati o non registrati. */
export function missedThisWeek(args: WeekArgs): MissedMeal[] {
  return missedMeals(args.weekEntries, { today: args.today, ...momentReaders(args) });
}

/** I posti liberi, da oggi a domenica, dove si può spostare il pasto `from`. */
export function slotsToMoveTo(args: WeekArgs & { weekStart: string; kinds?: readonly MealKind[]; from: Slot }): Slot[] {
  return freeSlots(args.weekEntries, {
    today: args.today,
    weekStart: args.weekStart,
    kinds: args.kinds && args.kinds.length > 0 ? args.kinds : MAIN_MEALS,
    exclude: args.from,
    ...momentReaders(args),
  });
}
