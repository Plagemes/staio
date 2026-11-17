import { describe, expect, it } from "vitest";
import { deriveDiary, type MealItem, type MealKind } from "../diary";
import { declaration, meal } from "../diary/test-helpers";
import { compareWeek, derivePlan, getAdherenceDay } from "./index";
import { food, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";
const W = "2026-03-09";
const DATE = "2026-03-09";
const HOURS: Record<MealKind, string> = { breakfast: "06:30", lunch: "11:30", dinner: "18:30", snack: "14:30" };
const item = (name: string): MealItem => ({ name, quantity: { value: 100, unit: "g" }, certainty: "estimated" });
const eaten = (kind: MealKind, id: string) =>
  meal(`ev-${id}`, `${DATE}T${HOURS[kind]}:00.000Z`, { mealId: id, kind, items: [item("Altro")] });
const decl = (kind: "breakfast" | "lunch" | "dinner", status: "skipped" | "untracked") =>
  declaration(`decl-${kind}`, `${DATE}T20:00:00.000Z`, { date: DATE, kind, status });

const state = derivePlan([
  weekEv("w", T, W, [food(DATE, "breakfast", "Yogurt", 125), food(DATE, "lunch", "Riso", 80), food(DATE, "dinner", "Pesce", 150)]),
]);

describe("compareWeek con momenti dichiarati", () => {
  it("pranzo «saltato»: il pasto pianificato risulta non fatto, e il giorno si confronta", () => {
    const diary = deriveDiary([eaten("breakfast", "b"), eaten("dinner", "d"), decl("lunch", "skipped")]);
    const week = compareWeek(state, W, diary);
    expect(week.excluded.gaps).toEqual([]);
    expect(week.excluded.declared).toEqual([]);
    const day = getAdherenceDay(week, DATE)!;
    const rice = day.entries.find((e) => e.planned.kind === "food" && e.planned.name === "Riso")!;
    expect(rice).toMatchObject({ status: "skipped", declaredSkipped: true, actual: [] });
  });

  it("senza dichiarazione il giorno ha vuoti e non si giudica nulla", () => {
    const diary = deriveDiary([eaten("breakfast", "b"), eaten("dinner", "d")]);
    const week = compareWeek(state, W, diary);
    expect(week.excluded.gaps).toEqual([DATE]);
    expect(getAdherenceDay(week, DATE)).toBeUndefined();
  });

  it("«mangiato, non registrato» esclude il giorno come dichiarato", () => {
    const diary = deriveDiary([eaten("breakfast", "b"), eaten("dinner", "d"), decl("lunch", "untracked")]);
    const week = compareWeek(state, W, diary);
    expect(week.excluded.declared).toEqual([DATE]);
    expect(getAdherenceDay(week, DATE)).toBeUndefined();
  });

  it("un pasto registrato dopo «saltato» vince: il pasto pianificato non è più dichiarato saltato", () => {
    const lunch = meal("ev-l", `${DATE}T${HOURS.lunch}:00.000Z`, { mealId: "l", kind: "lunch", items: [item("Riso")] });
    const diary = deriveDiary([eaten("breakfast", "b"), eaten("dinner", "d"), lunch, decl("lunch", "skipped")]);
    const day = getAdherenceDay(compareWeek(state, W, diary), DATE)!;
    const rice = day.entries.find((e) => e.planned.kind === "food" && e.planned.name === "Riso")!;
    expect(rice.status).toBe("respected");
    expect(rice.declaredSkipped).toBeUndefined();
  });
});
