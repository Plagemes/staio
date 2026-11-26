import { describe, expect, it } from "vitest";
import { NO_FILTERS, buildRows, pantryView } from "../recipes/list";
import { lotsOf, recipeOf } from "../prep/test-helpers";
import { SAVED_LIMIT, cookHref, declaredCoveredBy, foodFirst, ideaUsesFood, ideasFoodFirst, ideasHref, parseFood, rowsUsing, sameFood, savedForExpiring } from "./ideasFood";

describe("alimento nell'indirizzo", () => {
  it("si legge con prudenza", () => {
    expect(parseFood("  Zucchine ")).toBe("Zucchine");
    expect(parseFood("")).toBeUndefined();
    expect(parseFood(null)).toBeUndefined();
    expect(parseFood("a\u0000b")).toBeUndefined();
    expect(parseFood("x".repeat(200))?.length).toBe(80);
  });

  it("l'indirizzo passa il nome codificato", () => {
    expect(ideasHref("Latte & miele")).toBe("/app/ricette/idee?alimento=Latte%20%26%20miele");
    expect(parseFood(new URL(ideasHref("Pomodori pelati"), "http://x").searchParams.get("alimento"))).toBe("Pomodori pelati");
  });
});

describe("stesso alimento", () => {
  it("singolare, plurale e nomi più lunghi", () => {
    expect(sameFood("Uova", "uovo")).toBe(true);
    expect(sameFood("Pomodori", "Pomodoro")).toBe(true);
    expect(sameFood("Latte intero", "Latte")).toBe(true);
    expect(sameFood("Zucchine", "Patate")).toBe(false);
    expect(sameFood("", "Latte")).toBe(false);
  });
});

describe("ricette salvate con l'alimento", () => {
  const zucchine = recipeOf("z", { title: "Zucchine trifolate", servings: 2, ingredients: [{ name: "Zucchine", quantity: { value: 400, unit: "g" } }, { name: "Olio", quantity: { value: 10, unit: "ml" } }] });
  const frittata = recipeOf("f", { title: "Frittata", servings: 2, ingredients: [{ name: "Uova", quantity: { value: 4, unit: "pz" } }, { name: "Zucchina", quantity: { value: 1, unit: "pz" } }] });
  const dolce = recipeOf("d", { title: "Torta", servings: 4, ingredients: [{ name: "Farina", quantity: { value: 200, unit: "g" } }] });
  const { lots } = lotsOf([{ id: "z", name: "Zucchine", value: 500 }, { id: "o", name: "Olio", value: 500, unit: "ml" }]);
  const rows = buildRows([dolce, frittata, zucchine], pantryView(lots, "2026-11-16T09:00:00.000Z"));

  it("restano solo quelle che lo usano, prima quelle che si fanno con più cose in casa", () => {
    expect(rowsUsing(rows, "Zucchine").map((r) => r.recipe.recipeId)).toEqual(["z", "f"]);
    expect(rowsUsing(rows, "Tartufo")).toEqual([]);
  });
});

describe("verso il modello", () => {
  it("i lotti dell'alimento vanno in testa, gli altri restano nell'ordine", () => {
    const entries = [{ lot: { productRef: "Latte" } }, { lot: { productRef: "Zucchine" } }, { lot: { productRef: "Pane" } }, { lot: { productRef: "Zucchine verdi" } }];
    expect(foodFirst(entries, "Zucchine").map((e) => e.lot.productRef)).toEqual(["Zucchine", "Zucchine verdi", "Latte", "Pane"]);
  });

  it("le idee che usano l'alimento vengono prima", () => {
    const a = { usedFromPantry: [{ name: "Pane" }], idea: { ingredients: [{ name: "Pane" }] } };
    const b = { usedFromPantry: [], idea: { ingredients: [{ name: "Zucchine" }] } };
    const c = { usedFromPantry: [{ name: "Zucchine" }], idea: { ingredients: [] } };
    expect(ideaUsesFood(a as never, "Zucchine")).toBe(false);
    expect(ideasFoodFirst([a, b, c] as never[], "Zucchine")).toEqual([b, c, a]);
  });
});

describe("senza la chiave: le tue ricette per ciò che scade", () => {
  const now = "2026-11-16T09:00:00.000Z";
  const { lots } = lotsOf([
    { id: "y", name: "Yogurt", value: 500, expiry: "2026-11-17" },
    { id: "r", name: "Riso", value: 500 },
  ]);
  const view = pantryView(lots, now);
  const yogurt = recipeOf("y", { title: "Tzatziki", servings: 2, ingredients: [{ name: "Yogurt", quantity: { value: 200, unit: "g" } }] });
  const riso = recipeOf("r", { title: "Riso in bianco", servings: 2, ingredients: [{ name: "Riso", quantity: { value: 160, unit: "g" } }] });
  const torta = recipeOf("t", { title: "Torta", servings: 4, ingredients: [{ name: "Farina", quantity: { value: 200, unit: "g" } }, { name: "Latte", quantity: { value: 200, unit: "ml" } }] });

  it("prima chi usa ciò che scade", () => {
    const { picks } = savedForExpiring([torta, riso, yogurt], view, NO_FILTERS);
    expect(picks[0]?.recipe.recipeId).toBe("y");
  });

  it("gli allergeni e le esclusioni tolgono le ricette, come nel ricettario, e si contano", () => {
    const { picks, outcome } = savedForExpiring([torta, riso, yogurt], view, { ...NO_FILTERS, allergens: ["latte"] });
    expect(picks.map((p) => p.recipe.recipeId)).not.toContain("t");
    expect(outcome.hidden).toBeGreaterThan(0);
    const excluded = savedForExpiring([torta, riso, yogurt], view, { ...NO_FILTERS, excludedFoods: ["riso"] });
    expect(excluded.picks.map((p) => p.recipe.recipeId)).not.toContain("r");
  });

  it("al massimo sei", () => {
    const many = Array.from({ length: 9 }, (_, i) => recipeOf(`m${i}`, { title: `Ricetta ${i}`, servings: 2, ingredients: [{ name: "Riso", quantity: { value: 100, unit: "g" } }] }));
    expect(savedForExpiring(many, view, NO_FILTERS).picks).toHaveLength(SAVED_LIMIT);
  });

  it("nessuna ricetta salvata: nessuna proposta", () => {
    expect(savedForExpiring([], view, NO_FILTERS).picks).toEqual([]);
  });

  it("l'indirizzo di cucina porta l'id e le porzioni", () => {
    expect(cookHref("a b", 3)).toBe("/app/ricette/cucina?id=a%20b&porzioni=3");
  });
});

describe("dichiarazioni cambiate dopo la risposta", () => {
  const used = { allergens: ["latte"], excludedFoods: ["Basilico"] };
  it("uguali o meno: si può salvare", () => {
    expect(declaredCoveredBy({ allergens: ["latte"], excludedFoods: ["basilico"] }, used)).toBe(true);
    expect(declaredCoveredBy({ allergens: [], excludedFoods: [] }, used)).toBe(true);
  });
  it("una voce nuova: no", () => {
    expect(declaredCoveredBy({ allergens: ["latte", "glutine"], excludedFoods: ["basilico"] }, used)).toBe(false);
    expect(declaredCoveredBy({ allergens: ["latte"], excludedFoods: ["basilico", "aglio"] }, used)).toBe(false);
  });
});
