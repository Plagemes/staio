// Modifica del piano: ogni funzione prende le voci della settimana e ne restituisce di nuove; i builder
// producono gli eventi da scrivere. Una settimana è un solo evento `planWeek` che sostituisce il precedente:
// annullarlo (`void`) fa riemergere la versione di prima. Logica pura.
import { addDays, daysBetween } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import {
  InvalidPlanEventError,
  createDayType,
  createPlanStructure,
  createPlanTargets,
  createPlanWeek,
  inWeek,
  isMonday,
  type NutrientTargets,
  type PlanEventOptions,
  type PlanMealSlot,
  type PlannedEntry,
  type PlannedItem,
} from "@/core/plan";
import { generateId, voidEvent, type IdGenerator } from "@/core/ledger";
import { dayMonth } from "./dates";

export interface PlanContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type PlanResult = { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string };

const options = (ctx: PlanContext): PlanEventOptions => ({
  deviceId: ctx.deviceId,
  now: () => ctx.now,
  ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}),
});

const clone = (entry: PlannedEntry): PlannedEntry => JSON.parse(JSON.stringify(entry)) as PlannedEntry;

export function withEntry(entries: readonly PlannedEntry[], entry: PlannedEntry): PlannedEntry[] {
  return [...entries.map(clone), clone(entry)];
}

export function withoutEntry(entries: readonly PlannedEntry[], index: number): PlannedEntry[] {
  return entries.filter((_, i) => i !== index).map(clone);
}

/** Cambia le porzioni di una ricetta o preparazione, o la quantità di un alimento (stesso numero per ogni tipo). */
export function withAmount(entries: readonly PlannedEntry[], index: number, amount: number): PlannedEntry[] {
  return entries.map((entry, i) => {
    const copy = clone(entry);
    if (i !== index) return copy;
    if (copy.item.kind === "food") copy.item.quantity = { ...copy.item.quantity, value: amount };
    else copy.item.servings = amount;
    return copy;
  });
}

export function withItem(entries: readonly PlannedEntry[], index: number, item: PlannedItem): PlannedEntry[] {
  return entries.map((entry, i) => ({ ...clone(entry), ...(i === index ? { item: JSON.parse(JSON.stringify(item)) as PlannedItem } : {}) }));
}

export function entriesOn(entries: readonly PlannedEntry[], date: string): PlannedEntry[] {
  return entries.filter((e) => e.date === date);
}

/** I pasti di `from` (nelle voci di origine) diventano i pasti di `to`: quelli che `to` aveva prima si sostituiscono. */
export function copyDay(
  source: readonly PlannedEntry[],
  target: readonly PlannedEntry[],
  from: string,
  to: string,
): PlannedEntry[] {
  const kept = target.filter((e) => e.date !== to).map(clone);
  const copied = source.filter((e) => e.date === from).map((e) => ({ ...clone(e), date: to }));
  return [...kept, ...copied];
}

/** Tutta la settimana di origine, spostata sulla settimana che inizia a `targetStart` (sostituisce quella). */
export function copyWeek(source: readonly PlannedEntry[], sourceStart: string, targetStart: string): PlannedEntry[] {
  const shift = daysBetween(sourceStart, targetStart);
  return source.map((e) => ({ ...clone(e), date: addDays(e.date, shift) }));
}

function guard<T>(build: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: build() };
  } catch (e) {
    if (e instanceof InvalidPlanEventError) return { ok: false, error: "Non riesco a scrivere il piano: controlla le voci." };
    throw e;
  }
}

export function buildWeek(weekStart: string, entries: readonly PlannedEntry[], ctx: PlanContext, message: string): PlanResult {
  if (!isMonday(weekStart)) return { ok: false, error: "La settimana deve iniziare di lunedì." };
  if (entries.some((e) => !inWeek(weekStart, e.date))) return { ok: false, error: "Una voce cade fuori dalla settimana." };
  const r = guard(() => createPlanWeek({ weekStart, entries: entries.map(clone) }, options(ctx)));
  return r.ok ? { ok: true, events: [r.value], message } : r;
}

export function buildDayType(date: string, dayType: string, ctx: PlanContext): PlanResult {
  const name = dayType.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, error: "Scrivi il nome del tipo di giornata." };
  const r = guard(() => createDayType({ date, dayType: name }, options(ctx)));
  return r.ok ? { ok: true, events: [r.value], message: `${dayMonth(date)}: giornata di tipo «${name}».` } : r;
}

/** Toglie il tipo di giornata di una data: annulla l'evento che lo definiva. */
export function buildClearDayType(eventId: string, date: string, ctx: PlanContext): PlanResult {
  const v = voidEvent({ id: eventId, deviceId: ctx.deviceId }, { now: () => ctx.now, deviceId: ctx.deviceId, idGenerator: ctx.idGenerator ?? generateId });
  return { ok: true, events: [v], message: `${dayMonth(date)}: tolto il tipo di giornata.` };
}

export function buildTargets(dayType: string, targets: NutrientTargets, ctx: PlanContext): PlanResult {
  const name = dayType.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, error: "Scrivi il nome del tipo di giornata." };
  if (Object.keys(targets).length === 0) return { ok: false, error: "Scrivi almeno un obiettivo, un minimo o un massimo." };
  const r = guard(() => createPlanTargets({ dayType: name, targets }, options(ctx)));
  return r.ok ? { ok: true, events: [r.value], message: `Obiettivi salvati per «${name}».` } : r;
}

export function buildClearTargets(eventId: string, dayType: string, ctx: PlanContext): PlanResult {
  const v = voidEvent({ id: eventId, deviceId: ctx.deviceId }, { now: () => ctx.now, deviceId: ctx.deviceId, idGenerator: ctx.idGenerator ?? generateId });
  return { ok: true, events: [v], message: `Obiettivi tolti per «${dayType}».` };
}

export interface StructureInput {
  meals: PlanMealSlot[];
  eatingFrom?: string;
  eatingTo?: string;
  excludedFoods: string[];
  allergens: string[];
  defaultDayType?: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function buildStructure(input: StructureInput, ctx: PlanContext): PlanResult {
  if (input.meals.length === 0) return { ok: false, error: "Scegli almeno un pasto." };
  if (input.meals.some((m) => m.time !== undefined && !TIME_RE.test(m.time))) {
    return { ok: false, error: "Scrivi gli orari come 08:00." };
  }
  const hasFrom = input.eatingFrom !== undefined && input.eatingFrom !== "";
  const hasTo = input.eatingTo !== undefined && input.eatingTo !== "";
  if (hasFrom !== hasTo) return { ok: false, error: "Scrivi sia l'inizio sia la fine della finestra, oppure nessuno dei due." };
  if (hasFrom && (!TIME_RE.test(input.eatingFrom as string) || !TIME_RE.test(input.eatingTo as string))) {
    return { ok: false, error: "Scrivi gli orari come 08:00." };
  }
  const clean = (list: string[]) => [...new Set(list.map((s) => s.trim().replace(/\s+/g, " ")).filter((s) => s !== ""))];
  const dayType = input.defaultDayType?.trim();
  const r = guard(() =>
    createPlanStructure(
      {
        meals: input.meals,
        ...(hasFrom ? { eatingWindow: { from: input.eatingFrom as string, to: input.eatingTo as string } } : {}),
        excludedFoods: clean(input.excludedFoods),
        allergens: clean(input.allergens),
        ...(dayType ? { defaultDayType: dayType } : {}),
      },
      options(ctx),
    ),
  );
  return r.ok ? { ok: true, events: [r.value], message: "Struttura del piano salvata." } : r;
}

/** Voce di piano a partire da una scelta. */
export function entryOf(date: string, meal: PlannedEntry["meal"], item: PlannedItem, note?: string): PlannedEntry {
  return { date, meal, item, ...(note ? { note } : {}) };
}
