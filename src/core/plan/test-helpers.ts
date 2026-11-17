// Costruttori di eventi per i test del piano e delle preparazioni.
import type { EventBase, VoidEvent } from "../ledger";
import type {
  DayTypeEvent,
  NutrientTargets,
  PlanMealSlot,
  PlanStructureEvent,
  PlanTargetsEvent,
  PlanWeekEvent,
  PlannedEntry,
} from "./types";

type Extra = Partial<EventBase>;

function make<E>(type: string, id: string, recordedAt: string, fields: object, extra: Extra): E {
  return {
    id,
    type,
    at: recordedAt,
    recordedAt,
    deviceId: "dev-a",
    schemaVersion: 1,
    certainty: "measured",
    source: "manual",
    ...fields,
    ...extra,
  } as unknown as E;
}

export const targetsEv = (
  id: string,
  recordedAt: string,
  dayType: string,
  targets: NutrientTargets,
  extra: Extra = {},
) => make<PlanTargetsEvent>("planTargets", id, recordedAt, { dayType, targets }, extra);

export const structureEv = (
  id: string,
  recordedAt: string,
  fields: { meals?: PlanMealSlot[] } & Partial<Omit<PlanStructureEvent, keyof EventBase | "type" | "meals">>,
  extra: Extra = {},
) =>
  make<PlanStructureEvent>(
    "planStructure",
    id,
    recordedAt,
    { meals: [{ kind: "breakfast" }, { kind: "lunch" }, { kind: "dinner" }], ...fields },
    extra,
  );

export const weekEv = (
  id: string,
  recordedAt: string,
  weekStart: string,
  entries: PlannedEntry[],
  extra: Extra = {},
) => make<PlanWeekEvent>("planWeek", id, recordedAt, { weekStart, entries }, extra);

export const dayTypeEv = (
  id: string,
  recordedAt: string,
  date: string,
  dayType: string,
  extra: Extra = {},
) => make<DayTypeEvent>("dayType", id, recordedAt, { date, dayType }, extra);

export const voidEv = (id: string, recordedAt: string, targetEventId: string, extra: Extra = {}) =>
  make<VoidEvent>("void", id, recordedAt, { targetEventId }, extra);

export const food = (
  date: string,
  meal: PlannedEntry["meal"],
  name: string,
  value: number,
  unit: "g" | "ml" | "pz" = "g",
  foodId?: string,
): PlannedEntry => ({
  date,
  meal,
  item: { kind: "food", name, quantity: { value, unit }, ...(foodId ? { foodId } : {}) },
});

export const recipe = (
  date: string,
  meal: PlannedEntry["meal"],
  recipeId: string,
  servings = 1,
): PlannedEntry => ({ date, meal, item: { kind: "recipe", recipeId, servings } });

export const prepEntry = (
  date: string,
  meal: PlannedEntry["meal"],
  prepId: string,
  servings = 1,
): PlannedEntry => ({ date, meal, item: { kind: "prep", prepId, servings } });

/** PRNG deterministico (mulberry32) per i test con seme fisso. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
