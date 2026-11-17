import { describe, expect, it } from "vitest";
import { derivePlan } from "../plan";
import { food, prepEntry, seededRandom, shuffled, weekEv } from "../plan/test-helpers";
import { buildPrepSchedule, portionLifeDays } from "./index";

const T = "2026-03-01T10:00:00.000Z";

const planOf = (weekStart: string, entries: Parameters<typeof weekEv>[3]) =>
  derivePlan([weekEv("w", T, weekStart, entries)]);

describe("buildPrepSchedule", () => {
  it("settimana senza preparazioni o assente: nessun compito", () => {
    expect(buildPrepSchedule(derivePlan([]), "2026-03-09")).toEqual({ weekStart: "2026-03-09", tasks: [], coverage: [] });
    const onlyFood = planOf("2026-03-09", [food("2026-03-09", "lunch", "Riso", 80)]);
    expect(buildPrepSchedule(onlyFood, "2026-03-09").tasks).toEqual([]);
  });

  it("un lotto entro il primo giorno in cui serve, con le porzioni sommate", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-11", "dinner", "zuppa", 1),
      prepEntry("2026-03-10", "lunch", "zuppa", 2),
      prepEntry("2026-03-12", "lunch", "zuppa", 1),
    ]);
    const { tasks } = buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => 3 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      prepId: "zuppa",
      cookBy: "2026-03-10",
      servings: 4,
      lastUse: "2026-03-12",
      lifeDays: 3,
      lifeKnown: true,
      goodUntil: "2026-03-13",
    });
    expect(tasks[0].uses.map((u) => [u.date, u.meal, u.servings])).toEqual([
      ["2026-03-10", "lunch", 2],
      ["2026-03-11", "dinner", 1],
      ["2026-03-12", "lunch", 1],
    ]);
  });

  it("se la durata non basta fino all'ultimo uso, un secondo lotto", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-09", "lunch", "zuppa", 1),
      prepEntry("2026-03-11", "lunch", "zuppa", 1), // ancora buona: scade l'11
      prepEntry("2026-03-12", "lunch", "zuppa", 1), // oltre
      prepEntry("2026-03-15", "lunch", "zuppa", 1),
    ]);
    const { tasks } = buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => 2 });
    expect(tasks.map((t) => [t.cookBy, t.servings, t.lastUse])).toEqual([
      ["2026-03-09", 2, "2026-03-11"],
      ["2026-03-12", 1, "2026-03-12"],
      ["2026-03-15", 1, "2026-03-15"],
    ]);
  });

  it("durata zero: da cucinare il giorno stesso di ogni uso", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-09", "lunch", "insalata", 1),
      prepEntry("2026-03-09", "dinner", "insalata", 1),
      prepEntry("2026-03-10", "lunch", "insalata", 1),
    ]);
    const { tasks } = buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => 0 });
    expect(tasks.map((t) => [t.cookBy, t.servings])).toEqual([
      ["2026-03-09", 2],
      ["2026-03-10", 1],
    ]);
  });

  it("durata ignota: un solo lotto, dichiarato come non verificato", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-10", "lunch", "zuppa", 1),
      prepEntry("2026-03-15", "lunch", "zuppa", 1),
    ]);
    const { tasks } = buildPrepSchedule(state, "2026-03-09");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ lifeKnown: false, servings: 2, cookBy: "2026-03-10" });
    expect(tasks[0].lifeDays).toBeUndefined();
    expect(tasks[0].goodUntil).toBeUndefined();
    // Una durata non valida vale come ignota.
    expect(buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => Number.NaN }).tasks[0].lifeKnown).toBe(false);
    expect(buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => -1 }).tasks[0].lifeKnown).toBe(false);
  });

  it("più preparazioni, ognuna con la sua durata, in ordine di scadenza di cottura", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-12", "lunch", "ragu", 2),
      prepEntry("2026-03-10", "lunch", "zuppa", 1),
      prepEntry("2026-03-10", "dinner", "ragu", 1),
    ]);
    const life = (id: string) => (id === "ragu" ? 5 : 1);
    const { tasks } = buildPrepSchedule(state, "2026-03-09", { portionLifeDays: life });
    expect(tasks.map((t) => [t.prepId, t.cookBy, t.servings])).toEqual([
      ["ragu", "2026-03-10", 3],
      ["zuppa", "2026-03-10", 1],
    ]);
  });

  it("settimana a cavallo di mese, di anno e di febbraio bisestile", () => {
    const month = planOf("2026-03-30", [
      prepEntry("2026-03-31", "lunch", "zuppa", 1),
      prepEntry("2026-04-02", "lunch", "zuppa", 1),
      prepEntry("2026-04-05", "lunch", "zuppa", 1),
    ]);
    const m = buildPrepSchedule(month, "2026-03-30", { portionLifeDays: () => 3 }).tasks;
    expect(m.map((t) => [t.cookBy, t.goodUntil, t.servings])).toEqual([
      ["2026-03-31", "2026-04-03", 2],
      ["2026-04-05", "2026-04-08", 1],
    ]);

    const year = planOf("2025-12-29", [
      prepEntry("2025-12-30", "lunch", "zuppa", 1),
      prepEntry("2026-01-01", "lunch", "zuppa", 1),
    ]);
    const y = buildPrepSchedule(year, "2025-12-29", { portionLifeDays: () => 3 }).tasks;
    expect(y).toHaveLength(1);
    expect(y[0]).toMatchObject({ cookBy: "2025-12-30", goodUntil: "2026-01-02", lastUse: "2026-01-01" });

    const leap = planOf("2024-02-26", [
      prepEntry("2024-02-27", "lunch", "zuppa", 1),
      prepEntry("2024-03-01", "lunch", "zuppa", 1),
    ]);
    const l = buildPrepSchedule(leap, "2024-02-26", { portionLifeDays: () => 3 }).tasks;
    expect(l).toHaveLength(1);
    expect(l[0].goodUntil).toBe("2024-03-01");
  });

  it("usa la durata del motore delle scadenze", () => {
    const state = planOf("2026-03-09", [
      prepEntry("2026-03-09", "lunch", "zuppa", 1),
      prepEntry("2026-03-13", "lunch", "zuppa", 1),
    ]);
    const life = (cookedOn: string) =>
      portionLifeDays({ location: "frigo", cookedOn });
    // Avanzi cucinati in frigo: 3 giorni, quindi il 13 serve un secondo lotto.
    const { tasks } = buildPrepSchedule(state, "2026-03-09", { portionLifeDays: () => life("2026-03-09") });
    expect(tasks.map((t) => t.cookBy)).toEqual(["2026-03-09", "2026-03-13"]);
  });

  it("non dipende dall'ordine degli eventi né delle voci", () => {
    const entries = [
      prepEntry("2026-03-09", "lunch", "zuppa", 1),
      prepEntry("2026-03-11", "lunch", "zuppa", 1),
      prepEntry("2026-03-14", "dinner", "ragu", 2),
      prepEntry("2026-03-12", "dinner", "zuppa", 1),
    ];
    const expected = buildPrepSchedule(planOf("2026-03-09", entries), "2026-03-09", { portionLifeDays: () => 2 });
    for (let seed = 1; seed <= 10; seed++) {
      const mixed = shuffled(entries, seededRandom(seed));
      expect(buildPrepSchedule(planOf("2026-03-09", mixed), "2026-03-09", { portionLifeDays: () => 2 })).toEqual(expected);
    }
  });
});
