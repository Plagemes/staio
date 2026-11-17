import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { lotsOf } from "../prep/test-helpers";
import { makeLinkOf, pantryFoods } from "./allergenLinks";

describe("alimenti di dispensa collegati", () => {
  it("porta nome del prodotto ed etichetta dal codice a barre del lotto", () => {
    const { lots } = lotsOf([{ id: "a", name: "Burro", value: 250 }]);
    const withBarcode = lots.map((l) => ({ ...l, barcode: "80000000" }));
    const product = { barcode: "80000000", name: "Burro Alpe", allergens: ["milk"], fetchedAt: "x", source: "openfoodfacts" } as Product;
    const foods = pantryFoods(withBarcode, new Map([["80000000", product]]));
    expect(foods).toEqual([{ name: "Burro", productName: "Burro Alpe", barcode: "80000000", allergens: ["milk"] }]);
    expect(makeLinkOf(foods)({ name: "burro" })).toEqual({ names: ["Burro", "Burro Alpe"], productRefs: ["80000000"], allergens: ["milk"] });
  });

  it("non collega ciò che non somiglia", () => {
    expect(makeLinkOf([{ name: "Riso", allergens: [] }])({ name: "Mele" })).toBeUndefined();
  });
});
