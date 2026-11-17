import { describe, expect, it } from "vitest";
import { SHELF_LIFE, type FoodCategory } from "@/core/expiry";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, MODEL_CATEGORY_OF, suggestCategory } from "./labels";

describe("categorie", () => {
  const all = Object.keys(SHELF_LIFE) as FoodCategory[];

  it("ogni categoria del motore ha un'etichetta e sta in un solo gruppo", () => {
    const grouped = FOOD_CATEGORY_GROUPS.flatMap((g) => g.categories);
    expect([...grouped].sort()).toEqual([...all].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const c of all) {
      expect(FOOD_CATEGORY_LABELS[c]).toBeTruthy();
      expect(MODEL_CATEGORY_OF[c]).toBeTruthy();
    }
  });
});

describe("suggestCategory", () => {
  it.each([
    ["Latte intero", "milk_fresh"],
    ["Latte UHT parzialmente scremato", "milk_uht"],
    ["Uova", "eggs"],
    ["Yogurt greco", "yogurt"],
    ["Petto di pollo", "poultry"],
    ["Spaghetti n. 5", "pasta_dry"],
    ["Tortellini", "pasta_fresh"],
    ["Prosciutto cotto", "cold_cuts_sliced"],
    ["Tonno in scatola", "canned_closed"],
    ["Mozzarella", "cheese_fresh"],
    ["Parmigiano 24 mesi", "cheese_aged"],
    ["Spinaci freschi", "leafy_vegetables"],
    ["Mele", "fruit_fresh"],
    ["Pane", "bread_fresh"],
    ["Gelato alla crema", "frozen_foods"],
  ])("%s -> %s", (name, expected) => {
    expect(suggestCategory(name)).toBe(expected);
  });

  it("ignora maiuscole e accenti", () => {
    expect(suggestCategory("RAGÙ")).toBe("leftovers_cooked");
  });

  it("senza parole note usa la categoria del modello, se univoca", () => {
    expect(suggestCategory("Qualcosa di strano", "frutta")).toBe("fruit_fresh");
    expect(suggestCategory("Qualcosa di strano", "latticini")).toBeUndefined();
    expect(suggestCategory("Qualcosa di strano")).toBeUndefined();
    expect(suggestCategory("   ")).toBeUndefined();
  });
});
