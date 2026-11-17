import { describe, expect, it } from "vitest";
import { buildRows, pantryView } from "../recipes/list";
import { lotsOf, recipeOf } from "../prep/test-helpers";
import { foodFirst, ideaUsesFood, ideasFoodFirst, ideasHref, parseFood, rowsUsing, sameFood } from "./ideasFood";

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
