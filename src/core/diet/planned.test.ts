import { describe, expect, it } from "vitest";
import { FOODS } from "../nutrition/data/foods";
import type { PlannedEntry } from "../plan/types";
import { createClassifier } from "./classify";
import { plannedDiet } from "./planned";
import { PORTION_KEYS, type PortionKey, type PortionStandard, type PortionTable, type PrepForDiet, type RecipeDietFacts } from "./types";

const AMOUNTS: Partial<Record<PortionKey, number>> = { legumes: 150, legumesDry: 50, grains: 80, fish: 150, fruit: 150, eggs: 50 };
const PORTIONS: PortionTable = Object.fromEntries(
  PORTION_KEYS.map((key): [PortionKey, PortionStandard] => [
    key,
    { key, amount: AMOUNTS[key] ?? 100, unit: "g", basis: "raw", source: "app", where: "test" },
  ]),
) as PortionTable;

const classifier = createClassifier({
  foods: new Map(FOODS.map((f) => [f.id, f])),
  products: new Map(),
  lotOfConsume: () => undefined,
  lots: new Map(),
  preps: new Map(),
  overrides: {},
});

const recipes = new Map<string, RecipeDietFacts>([
  ["pasta-lenticchie", { recipeId: "pasta-lenticchie", groups: ["legumes", "refinedGrains"], servingsByGroup: { legumes: 1, refinedGrains: 1 }, certainty: "estimated" }],
  ["vuota", { recipeId: "vuota", groups: [], servingsByGroup: {}, certainty: "estimated" }],
]);

const prep: PrepForDiet = {
  prepId: "zuppa",
  batchLotId: "batch-zuppa",
  portions: 4,
  ingredients: [
    { lotId: "l1", productRef: "Ceci secchi", quantity: { value: 200, unit: "g" } },
    { lotId: "l2", productRef: "Sale", quantity: { value: 5, unit: "g" } },
  ],
};
const preps = new Map([["batch-zuppa", prep]]);

const entry = (date: string, item: PlannedEntry["item"]): PlannedEntry => ({ date, meal: "lunch", item });

describe("piano della settimana", () => {
  it("somma porzioni e voci per gruppo da ricette, preparazioni e alimenti", () => {
    const out = plannedDiet(
      [
        entry("2026-11-25", { kind: "recipe", recipeId: "pasta-lenticchie", servings: 2 }),
        entry("2026-11-24", { kind: "prep", prepId: "zuppa", servings: 1 }),
        entry("2026-11-26", { kind: "food", name: "Salmone", quantity: { value: 150, unit: "g" } }),
        entry("2026-11-26", { kind: "food", name: "Mela", quantity: { value: 2, unit: "pz" } }),
        entry("2026-11-27", { kind: "food", name: "Qwerty", quantity: { value: 100, unit: "g" } }),
        entry("2026-11-27", { kind: "recipe", recipeId: "sconosciuta", servings: 1 }),
        entry("2026-11-27", { kind: "recipe", recipeId: "vuota", servings: 1 }),
        entry("2026-11-27", { kind: "prep", prepId: "nessuna", servings: 1 }),
      ],
      { recipes, preps, classifier, portions: PORTIONS },
    );
    expect(out.weekStart).toBe("2026-11-23");
    expect(out.servingsByGroup).toEqual({ legumes: 3, refinedGrains: 2, fish: 1, fruit: 2 });
    expect(out.entriesByGroup).toEqual({ legumes: 2, refinedGrains: 1, fish: 1, fruit: 1 });
    expect(out.unresolved).toBe(4);
  });

  it("settimana vuota: lunedì dal contesto, nessun gruppo", () => {
    expect(plannedDiet([], { recipes, preps, classifier, portions: PORTIONS, weekStart: "2026-11-23" })).toEqual({
      weekStart: "2026-11-23",
      servingsByGroup: {},
      entriesByGroup: {},
      unresolved: 0,
    });
  });

  it("una voce senza porzione calcolabile conta come voce, non come porzione", () => {
    const out = plannedDiet([entry("2026-11-23", { kind: "food", name: "Pizza", quantity: { value: 1, unit: "pz" } })], {
      recipes,
      preps,
      classifier,
      portions: PORTIONS,
    });
    expect(out.entriesByGroup).toEqual({ mixedDish: 1 });
    expect(out.servingsByGroup).toEqual({});
  });
});
