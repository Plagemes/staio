// Costruttori di eventi per i test del diario e dell'unione.
import type { ConsumeEvent, EventBase, PurchaseEvent, VoidEvent } from "../ledger";
import type {
  DiaryEvent,
  DrinkEvent,
  HabitEvent,
  MealEvent,
  MoodEvent,
  SupplementEvent,
  SymptomEvent,
  UntrackedMealEvent,
  WaterEvent,
  WeightEvent,
} from "./types";

type Fields<E extends { type: string }> = Omit<E, keyof EventBase | "type"> & Partial<EventBase>;

function make<E extends { type: string }>(
  type: E["type"],
  id: string,
  at: string,
  fields: Fields<E>,
): E {
  return {
    id,
    type,
    at,
    recordedAt: at,
    deviceId: "dev-a",
    schemaVersion: 1,
    certainty: "measured",
    source: "manual",
    ...fields,
  } as unknown as E;
}

export const meal = (id: string, at: string, f: Fields<MealEvent>) =>
  make<MealEvent>("meal", id, at, f);
export const untracked = (id: string, at: string, f: Fields<UntrackedMealEvent>) =>
  make<UntrackedMealEvent>("untrackedMeal", id, at, f);
export const water = (id: string, at: string, f: Fields<WaterEvent>) =>
  make<WaterEvent>("water", id, at, f);
export const drink = (id: string, at: string, f: Fields<DrinkEvent>) =>
  make<DrinkEvent>("drink", id, at, f);
export const weight = (id: string, at: string, f: Fields<WeightEvent>) =>
  make<WeightEvent>("weight", id, at, f);
export const mood = (id: string, at: string, f: Fields<MoodEvent>) =>
  make<MoodEvent>("mood", id, at, f);
export const symptom = (id: string, at: string, f: Fields<SymptomEvent>) =>
  make<SymptomEvent>("symptom", id, at, f);
export const supplement = (id: string, at: string, f: Fields<SupplementEvent>) =>
  make<SupplementEvent>("supplement", id, at, f);
export const habit = (id: string, at: string, f: Fields<HabitEvent>) =>
  make<HabitEvent>("habit", id, at, f);

export const voidOf = (
  id: string,
  at: string,
  targetEventId: string,
  f: Partial<EventBase> = {},
) => make<VoidEvent>("void", id, at, { targetEventId, ...f });

export const consume = (id: string, at: string, f: Fields<ConsumeEvent>) =>
  make<ConsumeEvent>("consume", id, at, f);
export const purchase = (id: string, at: string, f: Fields<PurchaseEvent>) =>
  make<PurchaseEvent>("purchase", id, at, f);

/** Un esempio valido per ogni tipo del diario. */
export function sampleDiaryEvents(): DiaryEvent[] {
  const at = "2026-03-10T08:00:00.000Z";
  return [
    meal("m1", at, {
      mealId: "meal-1",
      kind: "breakfast",
      title: "Colazione",
      items: [{ name: "Caffè", quantity: { value: 30, unit: "ml" }, certainty: "estimated" }],
      habitId: "h1",
    }),
    untracked("u1", at, { kind: "lunch" }),
    water("w1", at, { ml: 250 }),
    drink("d1", at, { name: "Espresso", ml: 30, caffeineMg: 63, alcoholG: 0 }),
    weight("k1", at, { kg: 72.4 }),
    mood("o1", at, { score: 4, tags: ["calmo"] }),
    symptom("s1", at, { kind: "digestion", score: 2, label: "gonfiore" }),
    supplement("p1", at, { name: "Vitamina D", dose: "1000 UI", lotId: "lot-d3" }),
    habit("a1", at, {
      habitId: "h1",
      title: "Solita colazione",
      kind: "breakfast",
      usualTime: "07:30",
      items: [{ name: "Caffè", quantity: { value: 30, unit: "ml" }, certainty: "estimated" }],
    }),
  ];
}

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
