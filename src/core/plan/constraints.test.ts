import { describe, expect, it } from "vitest";
import { checkConstraints, derivePlan, getWeek, type ExpandRef } from "./index";
import { food, prepEntry, recipe, structureEv, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";

function setup(
  structure: Parameters<typeof structureEv>[2],
  entries: Parameters<typeof weekEv>[3],
) {
  const state = derivePlan([structureEv("s", T, structure), weekEv("w", T, "2026-03-09", entries)]);
  return { structure: state.structure, week: getWeek(state, "2026-03-09") };
}

const expand: ExpandRef = (ref) => {
  if (ref.id === "carbonara") {
    return [
      { name: "Spaghetti", quantity: { value: 80, unit: "g" } },
      { name: "Uova", quantity: { value: 2, unit: "pz" } },
    ];
  }
  if (ref.id === "zuppa") return [{ name: "Lenticchie", foodId: "lenticchie-secche", quantity: { value: 50, unit: "g" } }];
  return undefined;
};

const ALLERGENS: Record<string, string[]> = {
  spaghetti: ["glutine"],
  uova: ["uova"],
  riso: [],
  lenticchie: [],
};

const allergensOf = (item: { name: string }) => ALLERGENS[item.name.toLowerCase()];

describe("checkConstraints", () => {
  it("senza struttura o senza settimana non c'è nulla da dire", () => {
    expect(checkConstraints(undefined, undefined)).toEqual({
      ok: true,
      verified: true,
      violations: [],
      unverified: [],
    });
  });

  it("trova gli alimenti esclusi per nome (tutti i termini) e per identificativo", () => {
    const { structure, week } = setup(
      { excludedFoods: ["latte", "mela verde", "lenticchie-secche"] },
      [
        food("2026-03-09", "breakfast", "Latte intero", 200, "ml"),
        food("2026-03-09", "snack", "Mela rossa", 1, "pz"),
        food("2026-03-09", "snack", "Mela verde", 1, "pz"),
        food("2026-03-10", "lunch", "Zuppa", 200, "g", "lenticchie-secche"),
        food("2026-03-10", "dinner", "Riso", 80),
      ],
    );
    const r = checkConstraints(structure, week);
    expect(r.ok).toBe(false);
    expect(r.verified).toBe(true);
    expect(r.violations.map((v) => [v.date, v.meal, v.term, v.item.name])).toEqual([
      ["2026-03-09", "breakfast", "latte", "Latte intero"],
      ["2026-03-09", "snack", "mela verde", "Mela verde"],
      ["2026-03-10", "lunch", "lenticchie-secche", "Zuppa"],
    ]);
  });

  it("l'esclusione vale anche per gli ingredienti di ricette e preparazioni", () => {
    const { structure, week } = setup({ excludedFoods: ["uova"] }, [
      recipe("2026-03-09", "dinner", "carbonara", 2),
      prepEntry("2026-03-10", "lunch", "zuppa", 1),
    ]);
    const r = checkConstraints(structure, week, { expand });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({
      code: "excluded_food",
      term: "uova",
      via: { kind: "recipe", id: "carbonara" },
    });
  });

  it("allergeni: violazione quando l'alimento li contiene", () => {
    const { structure, week } = setup({ allergens: ["Glutine"] }, [
      food("2026-03-09", "lunch", "Spaghetti", 80),
      food("2026-03-09", "dinner", "Riso", 80),
    ]);
    const r = checkConstraints(structure, week, { allergensOf });
    expect(r.violations.map((v) => [v.code, v.term, v.item.name])).toEqual([
      ["allergen", "Glutine", "Spaghetti"],
    ]);
    expect(r.verified).toBe(true);
  });

  it("allergeni: un alimento di cui non si sa nulla non è mai dichiarato sicuro", () => {
    const { structure, week } = setup({ allergens: ["glutine"] }, [
      food("2026-03-09", "lunch", "Farro", 80),
      food("2026-03-09", "dinner", "Riso", 80),
    ]);
    const r = checkConstraints(structure, week, { allergensOf });
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.unverified).toEqual([
      { code: "unknown_allergens", date: "2026-03-09", meal: "lunch", item: { name: "Farro" } },
    ]);
    // Senza funzione degli allergeni, nulla è verificabile.
    expect(checkConstraints(structure, week).unverified).toHaveLength(2);
  });

  it("allergeni: ricette e preparazioni non espandibili sono non verificate", () => {
    const { structure, week } = setup({ allergens: ["uova"] }, [
      recipe("2026-03-09", "dinner", "carbonara", 1),
      recipe("2026-03-10", "dinner", "misteriosa", 1),
    ]);
    const r = checkConstraints(structure, week, { expand, allergensOf });
    expect(r.violations.map((v) => v.item.name)).toEqual(["Uova"]);
    expect(r.unverified).toEqual([
      { code: "unresolved_ref", date: "2026-03-10", meal: "dinner", via: { kind: "recipe", id: "misteriosa" } },
    ]);
  });

  it("senza allergeni dichiarati non c'è nulla da verificare", () => {
    const { structure, week } = setup({}, [food("2026-03-09", "lunch", "Farro", 80)]);
    expect(checkConstraints(structure, week).verified).toBe(true);
  });
});
