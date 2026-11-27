import { describe, expect, it } from "vitest";
import { SHELF_LIFE, type FoodCategory } from "../../expiry";
import { DIET_GROUPS } from "../types";
import {
  LOT_CATEGORY_GROUP,
  LOT_CATEGORY_PORTION,
  OFF_CATEGORY_RULES,
  firstIngredientIsWholeGrain,
} from "./categories";
import { CATEGORY_PROCESSING } from "./processing";

const CATEGORIES = Object.keys(SHELF_LIFE) as FoodCategory[];

function offRule(categories: string[]) {
  for (const [pattern, group, portionKey] of OFF_CATEGORY_RULES) {
    if (categories.some((c) => pattern.test(c))) return { group, portionKey };
  }
  return undefined;
}

describe("categorie del lotto", () => {
  it("coprono tutte le 35 categorie di core/expiry, e solo quelle", () => {
    expect(CATEGORIES).toHaveLength(35);
    expect(Object.keys(LOT_CATEGORY_GROUP).sort()).toEqual([...CATEGORIES].sort());
    for (const c of CATEGORIES) expect([...DIET_GROUPS, "unknown"], c).toContain(LOT_CATEGORY_GROUP[c]);
  });

  it("porzioni e lavorazione solo su categorie note con un gruppo", () => {
    for (const c of Object.keys(LOT_CATEGORY_PORTION)) {
      expect(CATEGORIES, c).toContain(c);
      expect(LOT_CATEGORY_GROUP[c as FoodCategory], c).not.toBe("unknown");
    }
    for (const c of Object.keys(CATEGORY_PROCESSING)) expect(CATEGORIES, c).toContain(c);
    expect(CATEGORY_PROCESSING.ready_meals).toBeUndefined();
    expect(CATEGORY_PROCESSING.cold_cuts_sliced).toBe(3);
  });

  it("esempi", () => {
    expect(LOT_CATEGORY_GROUP.poultry).toBe("whiteMeat");
    expect(LOT_CATEGORY_GROUP.cheese_aged).toBe("cheese");
    expect(LOT_CATEGORY_PORTION.cheese_aged).toBe("cheeseAged");
    expect(LOT_CATEGORY_PORTION.leafy_vegetables).toBe("leafySalad");
    expect(LOT_CATEGORY_PORTION.legumes_dry).toBe("legumesDry");
    expect(LOT_CATEGORY_GROUP.snacks_dry).toBe("unknown");
    expect(LOT_CATEGORY_GROUP.ready_meals).toBe("mixedDish");
  });
});

describe("categorie di Open Food Facts", () => {
  it("i casi particolari vincono sui generali", () => {
    expect(offRule(["fishes", "canned-fishes"])).toEqual({ group: "fish", portionKey: "fishPreserved" });
    expect(offRule(["fishes"])).toEqual({ group: "fish", portionKey: "fish" });
    expect(offRule(["dairies", "desserts", "dairy-desserts", "yogurts"])?.group).toBe("sweets");
    expect(offRule(["spreads", "peanut-butters"])?.group).toBe("nutsSeeds");
    expect(offRule(["sauces", "tomato-sauces", "tomatoes"])?.group).toBe("condiments");
    expect(offRule(["beverages", "plant-based-beverages", "soy-milks"])?.group).toBe("otherDrinks");
    expect(offRule(["beverages", "juices-and-nectars", "fruit-juices"])?.group).toBe("sugaryDrinks");
    expect(offRule(["meats", "prepared-meats", "hams"])?.group).toBe("processedMeat");
    expect(offRule(["meats", "poultries", "chickens"])?.group).toBe("whiteMeat");
    expect(offRule(["cereals-and-their-products", "breakfast-cereals"])?.portionKey).toBe("breakfastCereals");
    expect(offRule(["cereals-and-their-products", "pastas", "dried-pastas"])).toEqual({ group: "refinedGrains", portionKey: "grains" });
    expect(offRule(["legumes", "canned-legumes"])?.portionKey).toBe("legumes");
    expect(offRule(["legumes", "dried-legumes"])?.portionKey).toBe("legumesDry");
    expect(offRule(["fats", "olive-oils", "extra-virgin-olive-oils"])?.portionKey).toBe("oil");
    expect(offRule(["something-else"])).toBeUndefined();
  });

  it("integrale solo se lo è il primo ingrediente (CREA p. 53)", () => {
    expect(firstIngredientIsWholeGrain("Farina integrale di grano tenero, acqua, sale")).toBe(true);
    expect(firstIngredientIsWholeGrain("Ingredienti: semola integrale di grano duro")).toBe(true);
    expect(firstIngredientIsWholeGrain("Farina di grano tenero tipo 0, farina integrale (20%), sale")).toBe(false);
    expect(firstIngredientIsWholeGrain("Farina di frumento con crusca integrale, lievito")).toBe(false);
    expect(firstIngredientIsWholeGrain("Farina di grano tenero tipo 0, crusca")).toBe(false);
  });
});
