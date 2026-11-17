import { describe, expect, it } from "vitest";
import { hasGoal, isGoals, toggleGoal } from "./goals";

describe("goals", () => {
  it("toggleGoal aggiunge, toglie e sostituisce la direzione dello stesso nutriente", () => {
    const one = toggleGoal([], "sugars", "reduce");
    expect(one).toEqual([{ nutrient: "sugars", direction: "reduce" }]);
    expect(toggleGoal(one, "sugars", "increase")).toEqual([{ nutrient: "sugars", direction: "increase" }]);
    expect(toggleGoal(one, "sugars", "reduce")).toEqual([]);
    expect(hasGoal(one, "sugars", "reduce")).toBe(true);
  });
  it("isGoals rifiuta forme sbagliate", () => {
    expect(isGoals([{ nutrient: "salt", direction: "reduce" }])).toBe(true);
    expect(isGoals([{ nutrient: "iron", direction: "reduce" }])).toBe(false);
    expect(isGoals([{ nutrient: "salt", direction: "up" }])).toBe(false);
    expect(isGoals("x")).toBe(false);
  });
});
