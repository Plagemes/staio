import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { purchase, q } from "@/core/ledger/test-helpers";
import type { PlannedEntry } from "@/core/plan";
import type { Recipe } from "@/core/recipes";
import { buildMealEvents } from "../meals";
import { planEat } from "./eat";
import { expandRef } from "./expand";

const pantry = derivePantry([
  purchase("e1", "2026-11-10T10:00:00.000Z", {
    lotId: "L1",
    productRef: "Pasta",
    quantity: q(500, "g"),
    location: "dispensa",
    expiry: { date: "2027-01-01", kind: "best_before" },
  }),
  purchase("e2", "2026-11-11T10:00:00.000Z", {
    lotId: "L2",
    productRef: "Pasta",
    quantity: q(100, "g"),
    location: "dispensa",
    expiry: { date: "2026-12-01", kind: "best_before" },
  }),
]);
const lots = pantry.lots;
const recipes: Recipe[] = [
  {
    recipeId: "r1",
    title: "Pasta al pomodoro",
    servings: 2,
    ingredients: [
      { name: "Pasta", quantity: { value: 160, unit: "g" } },
      { name: "Passata", quantity: { value: 200, unit: "ml" } },
      { name: "Sale", quantity: { value: 1, unit: "pizzico" } },
      { name: "Basilico" },
    ],
    steps: [],
    equipment: [],
    tags: [],
    certainty: "estimated",
    updatedAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    eventId: "x",
  },
];
const expand = (ref: { kind: "recipe" | "prep"; id: string }, s: number) => expandRef({ recipes, preps: [] }, ref, s)?.ingredients;

describe("espansione", () => {
  it("scala la ricetta e dichiara gli ingredienti non contabili", () => {
    const r = expandRef({ recipes, preps: [] }, { kind: "recipe", id: "r1" }, 4);
    expect(r?.ingredients.map((i) => [i.name, i.quantity.value, i.quantity.unit])).toEqual([
      ["Pasta", 320, "g"],
      ["Passata", 400, "ml"],
    ]);
    expect(r?.skipped).toEqual(["Sale", "Basilico"]);
    expect(expandRef({ recipes, preps: [] }, { kind: "recipe", id: "nope" }, 2)).toBeUndefined();
  });
});

describe("registralo come mangiato", () => {
  it("prende dalla dispensa partendo dal lotto che scade prima e il resto lo scrive come stima", () => {
    const entry: PlannedEntry = { date: "2026-11-16", meal: "lunch", item: { kind: "recipe", recipeId: "r1", servings: 4 } };
    const plan = planEat(entry, { lots, preps: [], expand });
    expect(plan.input.picks.map((p) => [p.lot.lotId, p.choice.kind])).toEqual([
      ["L2", "all"],
      ["L1", "text"],
    ]);
    expect(plan.input.freeItems).toEqual([{ name: "Passata", quantityText: "400 ml" }]);
    expect(plan.missing).toEqual(["Passata"]);
    expect(buildMealEvents(plan.input, { now: "2026-11-16T12:00:00.000Z", deviceId: "d" }).ok).toBe(true);
  });

  it("per un alimento presente in dispensa non ha voci libere", () => {
    const entry: PlannedEntry = { date: "2026-11-16", meal: "dinner", item: { kind: "food", name: "pasta", quantity: { value: 80, unit: "g" } } };
    const plan = planEat(entry, { lots, preps: [], expand });
    expect(plan.input.freeItems).toEqual([]);
    expect(plan.input.kind).toBe("dinner");
  });

  it("una ricetta sconosciuta si dichiara", () => {
    const entry: PlannedEntry = { date: "2026-11-16", meal: "dinner", item: { kind: "recipe", recipeId: "zz", servings: 1 } };
    expect(planEat(entry, { lots, preps: [], expand }).unresolved).toBe(true);
  });
});
