import { describe, expect, it } from "vitest";
import type { MealKind } from "@/core/diary";
import type { PlannedEntry } from "@/core/plan";
import { mealCount, mealsText, tonightMoments, wantsIdeas, weekRows } from "./tonight";

const TODAY = "2026-11-18"; // mercoledì
const TOMORROW = "2026-11-19";
const at = (h: number, m = 0) => h * 60 + m;
const food = (date: string, meal: MealKind, name = "Pasta"): PlannedEntry => ({ date, meal, item: { kind: "food", name, quantity: { value: 80, unit: "g" } } });
const recipe = (date: string, meal: MealKind, recipeId = "r"): PlannedEntry => ({ date, meal, item: { kind: "recipe", recipeId, servings: 2 } });

const everything = [
  food(TODAY, "breakfast"),
  food(TODAY, "lunch"),
  food(TODAY, "dinner"),
  food(TOMORROW, "breakfast"),
  food(TOMORROW, "lunch"),
  food(TOMORROW, "dinner"),
];

const labels = (minutes: number, entries = everything, done?: (d: string, m: MealKind) => boolean) =>
  tonightMoments({ today: TODAY, nowMinutes: minutes, entries, ...(done ? { done } : {}) }).map((m) => m.label);

describe("tonightMoments", () => {
  it("alle 7:00: colazione in corso, poi pranzo e cena di oggi, e la colazione di domani (al massimo quattro)", () => {
    expect(labels(at(7))).toEqual(["Adesso · colazione", "Oggi · pranzo", "Stasera · cena", "Domani · colazione"]);
  });

  it("alle 12:00: pranzo in corso, cena, e domani", () => {
    expect(labels(at(12))).toEqual(["Adesso · pranzo", "Stasera · cena", "Domani · colazione", "Domani · pranzo"]);
  });

  it("alle 19:30: la cena di oggi è «Stasera», poi domani", () => {
    expect(labels(at(19, 30))).toEqual(["Stasera · cena", "Domani · colazione", "Domani · pranzo", "Domani · cena"]);
  });

  it("alle 16:00, tra il pranzo e la cena: nessun momento in corso, la cena è stasera", () => {
    expect(labels(at(16))).toEqual(["Stasera · cena", "Domani · colazione", "Domani · pranzo", "Domani · cena"]);
  });

  it("alle 23:30: niente di oggi, solo domani", () => {
    expect(labels(at(23, 30))).toEqual(["Domani · colazione", "Domani · pranzo", "Domani · cena"]);
  });

  it("mostra solo i momenti con voci pianificate", () => {
    expect(labels(at(12), [food(TODAY, "dinner"), food(TOMORROW, "lunch")])).toEqual(["Stasera · cena", "Domani · pranzo"]);
    expect(labels(at(12), [])).toEqual([]);
  });

  it("un momento già nel diario (cena registrata) non compare", () => {
    expect(labels(at(21), everything, (d, m) => d === TODAY && m === "dinner")).toEqual(["Domani · colazione", "Domani · pranzo", "Domani · cena"]);
  });

  it("raggruppa le voci dello stesso momento e non prende altri giorni", () => {
    const moments = tonightMoments({ today: TODAY, nowMinutes: at(19), entries: [food(TODAY, "dinner", "Pasta"), recipe(TODAY, "dinner"), food("2026-11-20", "dinner")] });
    expect(moments).toHaveLength(1);
    expect(moments[0].entries).toHaveLength(2);
  });

  it("gli spuntini non sono un momento di Piano", () => {
    expect(labels(at(12), [food(TODAY, "snack")])).toEqual([]);
  });
});

describe("weekRows", () => {
  const WEEK = "2026-11-16";
  const entries = [food("2026-11-16", "lunch"), food("2026-11-16", "dinner"), food("2026-11-17", "lunch"), food(TODAY, "lunch"), food(TODAY, "lunch", "Mela"), food(TODAY, "dinner"), food("2026-11-21", "dinner")];

  it("da oggi a domenica, una riga per giorno; i giorni passati in un numero solo", () => {
    const r = weekRows(TODAY, WEEK, entries);
    expect(r.days.map((d) => d.text)).toEqual(["Oggi · 2 pasti", "Domani · niente", "Ven 20 · niente", "Sab 21 · 1 pasto", "Dom 22 · niente"]);
    expect(r.pastMeals).toBe(3);
    expect(r.empty).toBe(false);
  });

  it("senza niente da oggi a domenica è vuota, anche se i giorni passati hanno pasti", () => {
    const r = weekRows(TODAY, WEEK, [food("2026-11-16", "lunch")]);
    expect(r.empty).toBe(true);
    expect(r.pastMeals).toBe(1);
  });

  it("di lunedì non ci sono giorni passati", () => {
    const r = weekRows(WEEK, WEEK, []);
    expect(r.days).toHaveLength(7);
    expect(r.days[0].text).toBe("Oggi · niente");
    expect(r.pastMeals).toBe(0);
  });

  it("conta i pasti, non le voci", () => {
    expect(mealCount([food(TODAY, "lunch"), food(TODAY, "lunch", "Mela"), food(TODAY, "dinner")])).toBe(2);
    expect(mealsText(0)).toBe("niente");
    expect(mealsText(1)).toBe("1 pasto");
    expect(mealsText(4)).toBe("4 pasti");
  });
});

describe("wantsIdeas", () => {
  const ideas = (minutes: number, entries: PlannedEntry[], done?: (d: string, m: MealKind) => boolean) => {
    const moments = tonightMoments({ today: TODAY, nowMinutes: minutes, entries, ...(done ? { done } : {}) });
    return wantsIdeas({ today: TODAY, nowMinutes: minutes, entries, moments, ...(done ? { done } : {}) });
  };

  it("cena di oggi vuota e niente in corso: sì", () => {
    expect(ideas(at(19), [])).toBe(true);
    expect(ideas(at(12), [food(TOMORROW, "lunch")])).toBe(true);
  });

  it("cena pianificata: no", () => {
    expect(ideas(at(19), [food(TODAY, "dinner")])).toBe(false);
  });

  it("il momento in corso è pianificato: no", () => {
    expect(ideas(at(12), [food(TODAY, "lunch")])).toBe(false);
  });

  it("cena già nel diario: no", () => {
    expect(ideas(at(21), [], (d, m) => d === TODAY && m === "dinner")).toBe(false);
  });

  it("a sera finita: no", () => {
    expect(ideas(at(23, 30), [])).toBe(false);
  });
});
