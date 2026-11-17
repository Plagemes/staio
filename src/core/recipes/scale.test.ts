import { describe, expect, it } from "vitest";
import { roundQuantity, scaleRecipe, scaleToWholePackages } from "./scale";
import type { RecipeIngredient } from "./types";

const ing = (name: string, value?: number, unit?: RecipeIngredient["quantity"] extends infer Q ? (Q extends { unit: infer U } ? U : never) : never): RecipeIngredient =>
  value === undefined || unit === undefined ? { name } : { name, quantity: { value, unit } };

const recipe = {
  servings: 4,
  ingredients: [
    ing("Farina", 250, "g"),
    ing("Latte", 300, "ml"),
    ing("Uova", 3, "pz"),
    ing("Zucchero", 2, "cucchiaio"),
    ing("Sale"),
  ],
};

describe("scaleRecipe", () => {
  it("con le stesse porzioni non cambia nulla", () => {
    const r = scaleRecipe(recipe, 4);
    expect(r.ok && r.value.ingredients.map((i) => i.quantity)).toEqual(
      recipe.ingredients.map((i) => i.quantity),
    );
    expect(r.ok && r.value.factor).toBe(1);
  });

  it("scala e arrotonda per unità", () => {
    const r = scaleRecipe(recipe, 6);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = r.value.ingredients.map((i) => i.quantity);
    expect(q[0]).toEqual({ value: 375, unit: "g" });
    expect(q[1]).toEqual({ value: 450, unit: "ml" });
    expect(q[2]).toEqual({ value: 4.5, unit: "pz" });
    expect(q[3]).toEqual({ value: 3, unit: "cucchiaio" });
    expect(q[4]).toBeUndefined();
    expect(r.value.ingredients[2]?.exactQuantity).toBeUndefined();
  });

  it("conserva il valore esatto quando l'arrotondamento lo cambia", () => {
    const r = scaleRecipe({ servings: 3, ingredients: [ing("Burro", 100, "g")] }, 4);
    expect(r.ok && r.value.ingredients[0]?.quantity).toEqual({ value: 135, unit: "g" });
    expect(r.ok && r.value.ingredients[0]?.exactQuantity).toEqual({ value: 133.333333333, unit: "g" });
  });

  it("non arrotonda a zero e permette di non arrotondare", () => {
    const r = scaleRecipe({ servings: 8, ingredients: [ing("Lievito", 2, "g")] }, 1);
    expect(r.ok && r.value.ingredients[0]?.quantity).toEqual({ value: 0.5, unit: "g" });
    const exact = scaleRecipe({ servings: 8, ingredients: [ing("Lievito", 2, "g")] }, 1, { round: false });
    expect(exact.ok && exact.value.ingredients[0]?.quantity?.value).toBe(0.25);
  });

  it("rifiuta porzioni non valide", () => {
    for (const n of [0, -1, Number.NaN, Infinity, 99999]) {
      const r = scaleRecipe(recipe, n);
      expect(!r.ok && r.error.code).toBe("invalid_servings");
    }
    const r = scaleRecipe({ servings: 0, ingredients: [] }, 2);
    expect(r.ok).toBe(false);
  });

  it("roundQuantity usa passi sensati", () => {
    expect(roundQuantity({ value: 1234, unit: "g" }).value).toBe(1230);
    expect(roundQuantity({ value: 0.73, unit: "kg" }).value).toBe(0.75);
    expect(roundQuantity({ value: 2.3, unit: "cucchiaino" }).value).toBe(2.25);
    expect(roundQuantity({ value: 0.01, unit: "g" }).value).toBe(0.5);
  });
});

describe("scaleToWholePackages", () => {
  const pasta = { servings: 4, ingredients: [ing("Pasta", 320, "g")] };

  it("trova le porzioni che usano confezioni intere con il minimo avanzo", () => {
    // 80 g a porzione: 500 g bastano per 6,25 porzioni; con intervallo 2..8 le porzioni intere migliori sono 6 (480 g).
    const r = scaleToWholePackages(pasta, 0, [{ value: 500, unit: "g" }], { minServings: 2, maxServings: 8 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.servings).toBe(6);
    expect(r.value.packs).toEqual([{ size: { value: 500, unit: "g" }, count: 1 }]);
    expect(r.value.leftover.value).toBe(20);
    expect(r.value.exact).toBe(false);
  });

  it("sceglie l'avanzo zero quando esiste e combina più formati", () => {
    const r = scaleToWholePackages(
      { servings: 4, ingredients: [ing("Riso", 300, "g")] },
      0,
      [
        { value: 1, unit: "kg" },
        { value: 250, unit: "g" },
      ],
      { minServings: 1, maxServings: 12 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.leftover.value).toBe(0);
    expect(r.value.exact).toBe(true);
    // 75 g a porzione: 1 kg + 250 g = 1250 g = 16,67 porzioni oltre il massimo; 1000 g non è multiplo: 10 porzioni = 750 g = 3 x 250 g.
    expect(r.value.servings).toBe(10);
    expect(r.value.packs).toEqual([{ size: { value: 250, unit: "g" }, count: 3 }]);
  });

  it("a pari avanzo preferisce porzioni vicine a quelle della ricetta", () => {
    const r = scaleToWholePackages(
      { servings: 4, ingredients: [ing("Uova", 2, "pz")] },
      0,
      [{ value: 1, unit: "pz" }],
      { minServings: 1, maxServings: 8 },
    );
    expect(r.ok && r.value.servings).toBe(4);
    expect(r.ok && r.value.exact).toBe(true);
  });

  it("converte i formati nell'unità dell'ingrediente", () => {
    const r = scaleToWholePackages(
      { servings: 2, ingredients: [ing("Latte", 500, "ml")] },
      0,
      [{ value: 1, unit: "l" }],
      { minServings: 1, maxServings: 6 },
    );
    expect(r.ok && r.value.servings).toBe(4);
    expect(r.ok && r.value.provided).toEqual({ value: 1000, unit: "ml" });
  });

  it("non scende mai sotto il fabbisogno", () => {
    const r = scaleToWholePackages(pasta, 0, [{ value: 100, unit: "g" }, { value: 250, unit: "g" }]);
    expect(r.ok && r.value.provided.value).toBeGreaterThanOrEqual(r.ok ? r.value.needed.value : 0);
  });

  it("segnala gli errori", () => {
    const code = (r: ReturnType<typeof scaleToWholePackages>) => (!r.ok ? r.error.code : "ok");
    expect(code(scaleToWholePackages(pasta, 0, []))).toBe("no_packages");
    expect(code(scaleToWholePackages(pasta, 3, [{ value: 500, unit: "g" }]))).toBe("invalid_quantity");
    expect(code(scaleToWholePackages({ servings: 2, ingredients: [ing("Sale")] }, 0, [{ value: 1, unit: "kg" }]))).toBe(
      "invalid_quantity",
    );
    expect(code(scaleToWholePackages(pasta, 0, [{ value: 1, unit: "l" }]))).toBe("not_convertible");
    expect(code(scaleToWholePackages(pasta, 0, [{ value: 500, unit: "g" }], { minServings: 5, maxServings: 2 }))).toBe(
      "invalid_range",
    );
    expect(code(scaleToWholePackages({ servings: 0, ingredients: pasta.ingredients }, 0, [{ value: 1, unit: "kg" }]))).toBe(
      "invalid_servings",
    );
  });

  it("usa la densità per formati in un'altra dimensione", () => {
    const r = scaleToWholePackages(
      { servings: 2, ingredients: [ing("Olio", 90, "g")] },
      0,
      [{ value: 1, unit: "l" }],
      { context: { density: 0.9 }, minServings: 1, maxServings: 20 },
    );
    expect(r.ok).toBe(true);
  });
});
