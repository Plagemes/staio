import { describe, expect, it } from "vitest";
import { computeNeeds, derivePlan, getWeek, type ExpandRef } from "./index";
import { food, prepEntry, recipe, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";

const weekOf = (weekStart: string, entries: Parameters<typeof weekEv>[3]) =>
  getWeek(derivePlan([weekEv("w", T, weekStart, entries)]), weekStart);

const expand: ExpandRef = (ref, servings) => {
  if (ref.kind === "recipe" && ref.id === "ragu") {
    return [
      { name: "Carne macinata", quantity: { value: 100 * servings, unit: "g" } },
      { name: "Passata", foodId: "passata", quantity: { value: 50 * servings, unit: "ml" } },
    ];
  }
  if (ref.kind === "prep" && ref.id === "zuppa") {
    return [
      { name: "Lenticchie", quantity: { value: 40 * servings, unit: "g" } },
      { name: "Carote", quantity: { value: 30 * servings, unit: "g" } },
    ];
  }
  return undefined;
};

describe("computeNeeds", () => {
  it("settimana assente: nessun bisogno", () => {
    expect(computeNeeds(undefined)).toEqual({ weekStart: "", lines: [], unresolved: [], coveredPortions: [] });
  });

  it("alimenti diretti, sommati per prodotto, data e unità", () => {
    const week = weekOf("2026-03-09", [
      food("2026-03-09", "lunch", "Riso", 80),
      food("2026-03-09", "dinner", "riso", 70),
      food("2026-03-10", "lunch", "Riso", 80),
      food("2026-03-09", "snack", "Latte", 200, "ml"),
      food("2026-03-09", "breakfast", "Latte", 1, "pz"),
    ]);
    const { lines, unresolved } = computeNeeds(week);
    expect(unresolved).toEqual([]);
    expect(lines.map((l) => [l.date, l.product, l.quantity.value, l.quantity.unit])).toEqual([
      ["2026-03-09", "Latte", 200, "ml"],
      ["2026-03-09", "Latte", 1, "pz"],
      ["2026-03-09", "Riso", 150, "g"],
      ["2026-03-10", "Riso", 80, "g"],
    ]);
    expect(lines[2].sources).toHaveLength(2);
  });

  it("espande le ricette alla data del pasto", () => {
    const week = weekOf("2026-03-09", [
      recipe("2026-03-10", "dinner", "ragu", 2),
      recipe("2026-03-10", "lunch", "ragu", 1),
      food("2026-03-10", "lunch", "Passata", 25, "ml", "passata"),
    ]);
    const { lines } = computeNeeds(week, { expand });
    expect(lines.map((l) => [l.date, l.product, l.quantity.value])).toEqual([
      ["2026-03-10", "Carne macinata", 300],
      ["2026-03-10", "Passata", 175],
    ]);
    expect(lines[1].foodId).toBe("passata");
    expect(lines[1].sources.map((s) => s.kind).sort()).toEqual(["food", "recipe", "recipe"]);
  });

  it("riporta ricette e preparazioni non espandibili senza inventare ingredienti", () => {
    const week = weekOf("2026-03-09", [
      recipe("2026-03-10", "dinner", "sconosciuta", 2),
      prepEntry("2026-03-11", "lunch", "ignota", 1),
    ]);
    const r = computeNeeds(week, { expand });
    expect(r.lines).toEqual([]);
    expect(r.unresolved).toEqual([
      { date: "2026-03-10", meal: "dinner", kind: "recipe", refId: "sconosciuta", servings: 2 },
      { date: "2026-03-11", meal: "lunch", kind: "prep", refId: "ignota", servings: 1 },
    ]);
    expect(computeNeeds(week).unresolved).toHaveLength(2);
  });

  it("gli ingredienti di una preparazione sono datati al giorno di cottura", () => {
    const week = weekOf("2026-03-09", [
      prepEntry("2026-03-11", "lunch", "zuppa", 1),
      prepEntry("2026-03-12", "lunch", "zuppa", 1),
      prepEntry("2026-03-15", "lunch", "zuppa", 2),
    ]);
    const { lines } = computeNeeds(week, { expand, portionLifeDays: () => 3 });
    // Lotto 1 cotto l'11 (copre fino al 14): 2 porzioni. Lotto 2 cotto il 15: 2 porzioni.
    expect(lines.map((l) => [l.date, l.product, l.quantity.value])).toEqual([
      ["2026-03-11", "Carote", 60],
      ["2026-03-11", "Lenticchie", 80],
      ["2026-03-15", "Carote", 60],
      ["2026-03-15", "Lenticchie", 80],
    ]);
  });

  it("senza durata nota c'è un solo lotto, cotto il primo giorno", () => {
    const week = weekOf("2026-03-09", [
      prepEntry("2026-03-11", "lunch", "zuppa", 1),
      prepEntry("2026-03-15", "lunch", "zuppa", 1),
    ]);
    const { lines } = computeNeeds(week, { expand });
    expect(lines.map((l) => [l.date, l.product, l.quantity.value])).toEqual([
      ["2026-03-11", "Carote", 60],
      ["2026-03-11", "Lenticchie", 80],
    ]);
  });

  it("settimana a cavallo di mese e di anno: le date restano corrette", () => {
    const week = weekOf("2025-12-29", [
      food("2025-12-31", "dinner", "Lenticchie", 80),
      food("2026-01-01", "lunch", "Lenticchie", 80),
      food("2026-01-04", "lunch", "Zampone", 200),
    ]);
    const { lines } = computeNeeds(week);
    expect(lines.map((l) => l.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-04"]);
  });

  it("non dipende dall'ordine delle voci", () => {
    const entries = [
      food("2026-03-09", "lunch", "Riso", 80),
      recipe("2026-03-10", "dinner", "ragu", 2),
      prepEntry("2026-03-11", "lunch", "zuppa", 1),
    ];
    const a = computeNeeds(weekOf("2026-03-09", entries), { expand });
    const b = computeNeeds(weekOf("2026-03-09", [...entries].reverse()), { expand });
    expect(b).toEqual(a);
  });
});
