import { describe, expect, it } from "vitest";
import { deriveDiary, getDay, mealMoments, type MealItem, type MealKind } from "../diary";
import { declaration, meal } from "../diary/test-helpers";
import {
  compareWeek,
  computeNeeds,
  derivePlan,
  dropMeal,
  freeSlots,
  getAdherenceDay,
  getWeek,
  missedMeals,
  moveMeal,
  moveMealToWeek,
  type MomentStatus,
  type PlannedEntry,
} from "./index";
import { food, weekEv } from "./test-helpers";

const T = "2026-11-09T07:00:00.000Z";
const W = "2026-11-16"; // lunedì
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";

const entries = (): PlannedEntry[] => [
  food(MON, "breakfast", "Yogurt", 125),
  food(MON, "lunch", "Riso", 80),
  food(MON, "lunch", "Pollo", 120),
  food(MON, "dinner", "Pesce", 150),
  food(TUE, "dinner", "Zuppa", 300),
];

const none = (): MomentStatus => "none";
const statusFrom = (table: Record<string, MomentStatus>) => (date: string, meal: MealKind): MomentStatus => table[`${date}|${meal}`] ?? "none";
const base = { today: TUE, overdue: () => false };

describe("missedMeals", () => {
  it("un momento dichiarato saltato è mancato, con tutte le sue voci", () => {
    const r = missedMeals(entries(), { ...base, status: statusFrom({ [`${MON}|lunch`]: "skipped" }) });
    const lunch = r.find((m) => m.meal === "lunch" && m.date === MON)!;
    expect(lunch.reason).toBe("skipped");
    expect(lunch.entries.map((e) => (e.item.kind === "food" ? e.item.name : ""))).toEqual(["Riso", "Pollo"]);
  });

  it("un giorno passato senza niente nel diario è «non registrato»; uno registrato o «mangiato, non registrato» no", () => {
    const r = missedMeals(entries(), {
      ...base,
      status: statusFrom({ [`${MON}|breakfast`]: "recorded", [`${MON}|lunch`]: "untracked" }),
    });
    expect(r.map((m) => `${m.date}|${m.meal}|${m.reason}`)).toEqual([`${MON}|dinner|not_logged`]);
  });

  it("oggi un momento non ancora passato non è mancato; passato sì; il futuro mai", () => {
    const tuesday = [food(TUE, "dinner", "Zuppa", 300), food(WED, "lunch", "Pasta", 80)];
    expect(missedMeals(tuesday, { ...base, status: none })).toEqual([]);
    const late = missedMeals(tuesday, { ...base, status: none, overdue: (m) => m === "dinner" });
    expect(late.map((m) => `${m.date}|${m.meal}`)).toEqual([`${TUE}|dinner`]);
    // anche dichiarato saltato, un giorno futuro non è mancato
    expect(missedMeals(tuesday, { ...base, status: statusFrom({ [`${WED}|lunch`]: "skipped" }) })).toEqual([]);
  });

  it("gli spuntini non si offrono", () => {
    expect(missedMeals([food(MON, "snack", "Mela", 100)], { ...base, status: none })).toEqual([]);
  });
});

describe("freeSlots", () => {
  const opts = { ...base, weekStart: W, kinds: ["breakfast", "lunch", "dinner"] as MealKind[], status: none };

  it("solo da oggi a domenica, senza i posti già pianificati né quello di partenza", () => {
    const slots = freeSlots(entries(), { ...opts, exclude: { date: MON, meal: "lunch" } });
    expect(slots.some((s) => s.date < TUE)).toBe(false);
    expect(slots.some((s) => s.date === TUE && s.meal === "dinner")).toBe(false); // occupato dalla zuppa
    expect(slots[0]).toEqual({ date: TUE, meal: "breakfast" });
    expect(slots.at(-1)).toEqual({ date: "2026-11-22", meal: "dinner" });
    expect(slots).toHaveLength(2 + 3 * 5); // martedì: colazione e pranzo, poi mercoledì-domenica
  });

  it("oggi non offre un momento già passato o già pieno nel diario", () => {
    const slots = freeSlots([], {
      ...opts,
      overdue: (m) => m === "breakfast",
      status: statusFrom({ [`${TUE}|lunch`]: "recorded" }),
    });
    expect(slots.filter((s) => s.date === TUE)).toEqual([{ date: TUE, meal: "dinner" }]);
  });
});

describe("moveMeal e dropMeal", () => {
  it("sposta tutte le voci del posto, senza toccare le altre né l'originale", () => {
    const before = entries();
    const r = moveMeal(before, W, { date: MON, meal: "lunch" }, { date: THU, meal: "dinner" });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.entries.filter((e) => e.date === THU).map((e) => e.meal)).toEqual(["dinner", "dinner"]);
    expect(r.entries).toHaveLength(before.length);
    expect(r.entries.filter((e) => e.date === MON && e.meal === "lunch")).toEqual([]);
    expect(before).toEqual(entries());
  });

  it("rifiuta un posto occupato, lo stesso posto, una data fuori settimana e un posto vuoto", () => {
    const from = { date: MON, meal: "lunch" } as const;
    expect(moveMeal(entries(), W, from, { date: TUE, meal: "dinner" })).toEqual({ ok: false, error: "slot_taken" });
    expect(moveMeal(entries(), W, from, from)).toEqual({ ok: false, error: "same_slot" });
    expect(moveMeal(entries(), W, from, { date: "2026-11-23", meal: "lunch" })).toEqual({ ok: false, error: "outside_week" });
    expect(moveMeal(entries(), W, { date: WED, meal: "lunch" }, { date: THU, meal: "lunch" })).toEqual({ ok: false, error: "nothing_to_move" });
  });

  it("un giorno con altri pasti ma il posto libero si accetta", () => {
    const r = moveMeal(entries(), W, { date: MON, meal: "lunch" }, { date: TUE, meal: "lunch" });
    expect(r.ok).toBe(true);
  });

  it("toglie dal piano solo le voci di quel posto", () => {
    const r = dropMeal(entries(), { date: MON, meal: "lunch" });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.entries).toHaveLength(3);
    expect(dropMeal(entries(), { date: WED, meal: "lunch" })).toEqual({ ok: false, error: "nothing_to_move" });
  });
});

describe("un pasto spostato non è un pasto mancato", () => {
  const item = (name: string): MealItem => ({ name, quantity: { value: 100, unit: "g" }, certainty: "estimated" });
  const eaten = (kind: MealKind, hour: string) =>
    meal(`ev-${kind}`, `${MON}T${hour}:00.000Z`, { mealId: kind, kind, items: [item(kind === "breakfast" ? "Yogurt" : "Pesce")] });
  const skipLunch = declaration("decl", `${MON}T14:00:00.000Z`, { date: MON, kind: "lunch", status: "skipped" });
  const diary = deriveDiary([eaten("breakfast", "06:30"), eaten("dinner", "18:30"), skipLunch]);

  const planned = [food(MON, "breakfast", "Yogurt", 125), food(MON, "lunch", "Riso", 80), food(MON, "dinner", "Pesce", 150)];
  const before = derivePlan([weekEv("w1", T, W, planned)]);

  it("prima dello spostamento il pranzo risulta saltato; dopo, né saltato né contato due volte", () => {
    const skipped = getAdherenceDay(compareWeek(before, W, diary), MON)!;
    expect(skipped.counts).toMatchObject({ respected: 2, skipped: 1 });

    const moved = moveMeal(planned, W, { date: MON, meal: "lunch" }, { date: THU, meal: "lunch" });
    if (!moved.ok) throw new Error("atteso ok");
    const after = derivePlan([weekEv("w1", T, W, planned), weekEv("w2", "2026-11-16T15:00:00.000Z", W, moved.entries)]);
    const week = compareWeek(after, W, diary);
    expect(getAdherenceDay(week, MON)!.counts).toMatchObject({ respected: 2, skipped: 0, substituted: 0 });
    expect(week.totals.skipped).toBe(0);
    // giovedì non è tracciato: il pasto spostato non si giudica ancora, ma non è in doppio
    expect(week.excluded.gaps).toContain(THU);
    expect(getWeek(after, W)!.entries.filter((e) => e.item.kind === "food" && e.item.name === "Riso")).toHaveLength(1);
  });

  it("gli ingredienti contano una volta sola, nella nuova data", () => {
    const moved = moveMeal(planned, W, { date: MON, meal: "lunch" }, { date: THU, meal: "lunch" });
    if (!moved.ok) throw new Error("atteso ok");
    const total = (list: PlannedEntry[]) => {
      const lines = computeNeeds(derivePlan([weekEv("w", T, W, list)]).weeks[0]).lines;
      return { lines, grams: lines.reduce((s, l) => s + l.quantity.value, 0) };
    };
    const a = total(planned);
    const b = total(moved.entries);
    expect(b.grams).toBe(a.grams);
    expect(b.lines.find((l) => l.product === "Riso")).toMatchObject({ date: THU, quantity: { value: 80, unit: "g" } });
    expect(a.lines.find((l) => l.product === "Riso")?.date).toBe(MON);
  });

  it("tolto dal piano, il pasto non è né saltato né nella spesa", () => {
    const dropped = dropMeal(planned, { date: MON, meal: "lunch" });
    if (!dropped.ok) throw new Error("atteso ok");
    const after = derivePlan([weekEv("w2", T, W, dropped.entries)]);
    expect(getAdherenceDay(compareWeek(after, W, diary), MON)!.counts.skipped).toBe(0);
    expect(computeNeeds(getWeek(after, W)).lines.some((l) => l.product === "Riso")).toBe(false);
  });

  it("missedMeals e il diario: il pranzo dichiarato saltato è proposto, la colazione registrata no", () => {
    const day = getDay(diary, MON);
    const moments = new Map(mealMoments(day).map((m) => [m.kind, m.status]));
    const r = missedMeals(planned, { today: MON, overdue: () => false, status: (_d, k) => moments.get(k as "breakfast") ?? "none" });
    expect(r.map((m) => m.meal)).toEqual(["lunch"]);
  });
});

describe("moveMealToWeek", () => {
  const NEXT = "2026-11-23";
  const source = { weekStart: W, entries: entries() };
  const target = { weekStart: NEXT, entries: [food("2026-11-24", "dinner", "Lasagne", 300)] };

  it("toglie le voci dalla settimana di partenza e le mette in quella di arrivo, una volta sola", () => {
    const r = moveMealToWeek(source, target, { date: MON, meal: "lunch" }, { date: "2026-11-23", meal: "lunch" });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.from.some((e) => e.date === MON && e.meal === "lunch")).toBe(false);
    expect(r.from).toHaveLength(entries().length - 2);
    expect(r.to.filter((e) => e.date === "2026-11-23" && e.meal === "lunch")).toHaveLength(2);
    expect(r.to).toHaveLength(3);
    expect(source.entries).toEqual(entries());
  });

  it("rifiuta posto occupato, fuori dalla settimana di arrivo, stessa settimana, pasto assente", () => {
    const from = { date: MON, meal: "lunch" } as const;
    expect(moveMealToWeek(source, target, from, { date: "2026-11-24", meal: "dinner" })).toEqual({ ok: false, error: "slot_taken" });
    expect(moveMealToWeek(source, target, from, { date: "2026-11-30", meal: "lunch" })).toEqual({ ok: false, error: "outside_week" });
    expect(moveMealToWeek(source, source, from, { date: THU, meal: "lunch" })).toEqual({ ok: false, error: "same_week" });
    expect(moveMealToWeek(source, target, { date: WED, meal: "lunch" }, { date: "2026-11-23", meal: "lunch" })).toEqual({ ok: false, error: "nothing_to_move" });
  });
});
