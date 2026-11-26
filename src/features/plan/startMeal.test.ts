import { describe, expect, it } from "vitest";
import type { MealKind } from "@/core/diary";
import type { PlannedEntry } from "@/core/plan";
import { currentOrNextMoment, startMeal } from "./startMeal";

const T = "2026-11-18";
const meals: MealKind[] = ["breakfast", "lunch", "dinner"];
const at = (h: number, m = 0) => h * 60 + m;
const food = (date: string, meal: MealKind): PlannedEntry => ({ date, meal, item: { kind: "food", name: "Pasta", quantity: { value: 80, unit: "g" } } });

describe("currentOrNextMoment", () => {
  it("segue le fasce di Oggi", () => {
    expect(currentOrNextMoment(at(3))).toBe("breakfast");
    expect(currentOrNextMoment(at(8))).toBe("breakfast");
    expect(currentOrNextMoment(at(12))).toBe("lunch");
    expect(currentOrNextMoment(at(16))).toBe("dinner");
    expect(currentOrNextMoment(at(19, 30))).toBe("dinner");
    expect(currentOrNextMoment(at(23, 30))).toBeUndefined();
  });
});

describe("startMeal", () => {
  it("oggi: il momento in corso o il prossimo", () => {
    expect(startMeal({ date: T, today: T, nowMinutes: at(8), meals, entries: [] })).toBe("breakfast");
    expect(startMeal({ date: T, today: T, nowMinutes: at(12), meals, entries: [] })).toBe("lunch");
    expect(startMeal({ date: T, today: T, nowMinutes: at(16), meals, entries: [] })).toBe("dinner");
    expect(startMeal({ date: T, today: T, nowMinutes: at(19), meals, entries: [food(T, "dinner")] })).toBe("dinner");
  });

  it("oggi a tarda sera: il primo pasto", () => {
    expect(startMeal({ date: T, today: T, nowMinutes: at(23, 30), meals, entries: [] })).toBe("breakfast");
  });

  it("oggi, momento fuori dalla struttura: il primo pasto della struttura che viene dopo", () => {
    expect(startMeal({ date: T, today: T, nowMinutes: at(8), meals: ["lunch", "dinner"], entries: [] })).toBe("lunch");
    expect(startMeal({ date: T, today: T, nowMinutes: at(19), meals: ["breakfast", "lunch"], entries: [] })).toBe("breakfast");
  });

  it("giorno futuro: il primo pasto senza voci", () => {
    const d = "2026-11-19";
    expect(startMeal({ date: d, today: T, nowMinutes: at(12), meals, entries: [] })).toBe("breakfast");
    expect(startMeal({ date: d, today: T, nowMinutes: at(12), meals, entries: [food(d, "breakfast")] })).toBe("lunch");
    expect(startMeal({ date: d, today: T, nowMinutes: at(12), meals, entries: [food(d, "breakfast"), food(d, "lunch")] })).toBe("dinner");
  });

  it("giorno futuro con tutti i pasti pieni: il primo", () => {
    const d = "2026-11-19";
    expect(startMeal({ date: d, today: T, nowMinutes: at(12), meals, entries: meals.map((m) => food(d, m)) })).toBe("breakfast");
  });

  it("le voci di altri giorni non contano", () => {
    const d = "2026-11-19";
    expect(startMeal({ date: d, today: T, nowMinutes: at(12), meals, entries: [food("2026-11-20", "breakfast")] })).toBe("breakfast");
  });

  it("giorno passato: il primo", () => {
    expect(startMeal({ date: "2026-11-16", today: T, nowMinutes: at(12), meals, entries: [] })).toBe("breakfast");
  });

  it("senza struttura dei pasti: pranzo", () => {
    expect(startMeal({ date: "2026-11-19", today: T, nowMinutes: at(12), meals: [], entries: [] })).toBe("lunch");
    expect(startMeal({ date: T, today: T, nowMinutes: at(19), meals: [], entries: [] })).toBe("lunch");
  });
});
