import { describe, expect, it } from "vitest";
import type { PlannedItem } from "@/core/plan";
import { cookHref, itemCommand } from "./itemCommand";

const T = "2026-11-18";
const recipe: PlannedItem = { kind: "recipe", recipeId: "r1", servings: 2 };
const food: PlannedItem = { kind: "food", name: "Pasta", quantity: { value: 80, unit: "g" } };
const prep: PlannedItem = { kind: "prep", prepId: "p1", servings: 1 };

describe("itemCommand", () => {
  it("ricetta di oggi o dei giorni dopo: Cucina", () => {
    expect(itemCommand(recipe, T, T, true)).toBe("cook");
    expect(itemCommand(recipe, "2026-11-20", T, true)).toBe("cook");
  });

  it("ricetta passata o ritirata: nessun comando in vista", () => {
    expect(itemCommand(recipe, "2026-11-16", T, true)).toBeNull();
    expect(itemCommand(recipe, T, T, false)).toBeNull();
  });

  it("alimento o preparazione di oggi o passati: Registra", () => {
    expect(itemCommand(food, T, T, false)).toBe("eat");
    expect(itemCommand(prep, "2026-11-16", T, false)).toBe("eat");
  });

  it("alimento o preparazione dei giorni dopo: nessun comando in vista", () => {
    expect(itemCommand(food, "2026-11-19", T, false)).toBeNull();
    expect(itemCommand(prep, "2026-11-19", T, false)).toBeNull();
  });

  it("l'indirizzo di Cucina porta ricetta e porzioni", () => {
    expect(cookHref("r1", 2)).toBe("/app/ricette/cucina?id=r1&porzioni=2");
    expect(cookHref("a b", 1.5)).toBe("/app/ricette/cucina?id=a%20b&porzioni=1.5");
  });
});
