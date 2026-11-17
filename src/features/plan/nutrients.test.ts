import { describe, expect, it } from "vitest";
import { createResolver, type FoodComposition } from "@/core/nutrition";
import type { PlannedEntry } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import { buildResolverWithInfo } from "../nutrition/resolver";
import { makeNutrientsOf } from "./nutrients";

const rice: FoodComposition = {
  id: "riso-secco",
  name: "Riso",
  group: "cereali",
  basis: "g",
  state: "dried",
  per100: { energyKcal: 350, proteinG: 7 },
  source: { name: "t", url: "t" },
} as unknown as FoodComposition;

const prep: PrepRecord = {
  prepId: "p1",
  title: "Risotto",
  eventId: "e",
  cookedAt: "2026-11-15T18:00:00.000Z",
  batchLotId: "LB",
  batchEventId: "b",
  portions: 2,
  remaining: 2,
  eaten: 0,
  discarded: 0,
  gifted: 0,
  status: "active",
  location: "frigo",
  ingredients: [
    { lotId: "L1", productRef: "Riso", quantity: { value: 200, unit: "g" }, consumeEventId: "c" },
    { lotId: "L2", productRef: "Qualcosa di ignoto", quantity: { value: 50, unit: "g" }, consumeEventId: "d" },
  ],
  cost: { partial: false, unknownLotIds: [] },
  batchEventIds: [],
};

const entry = (servings: number): PlannedEntry => ({ date: "2026-11-17", meal: "dinner", item: { kind: "prep", prepId: "p1", servings } });

describe("nutrienti delle voci di piano", () => {
  it("una porzione di preparazione ha i nutrienti dal risolutore con le preparazioni, senza i valori parziali", () => {
    const built = buildResolverWithInfo({ foods: [rice], products: new Map(), barcodes: new Map(), overrides: {}, preps: new Map([["LB", prep]]) });
    const of = makeNutrientsOf({ resolver: built.resolve, prepInfo: built.prepInfo, recipes: [], preps: [prep] });
    const r = of(entry(1));
    // l'ingrediente ignoto rende parziali i valori: restano fuori, non si spacciano per completi
    expect(r.ok).toBe(false);
  });

  it("con tutti gli ingredienti noti calcola i nutrienti per le porzioni pianificate", () => {
    const full: PrepRecord = { ...prep, ingredients: [prep.ingredients[0]] };
    const built = buildResolverWithInfo({ foods: [rice], products: new Map(), barcodes: new Map(), overrides: {}, preps: new Map([["LB", full]]) });
    const of = makeNutrientsOf({ resolver: built.resolve, prepInfo: built.prepInfo, recipes: [], preps: [full] });
    const r = of(entry(2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 200 g di riso in 2 porzioni: 700 kcal in tutto
      expect(r.nutrients.energyKcal).toBeCloseTo(700, 5);
      expect(r.certainty).toBe("estimated");
    }
  });

  it("senza le preparazioni nel risolutore ricade sul calcolo dagli ingredienti", () => {
    const full: PrepRecord = { ...prep, ingredients: [prep.ingredients[0]] };
    const resolver = createResolver({ foods: [rice] });
    const r = makeNutrientsOf({ resolver, recipes: [], preps: [full] })(entry(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nutrients.energyKcal).toBeCloseTo(350, 5);
  });
});
