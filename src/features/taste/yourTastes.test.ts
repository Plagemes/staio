import { describe, expect, it } from "vitest";
import { createFoodMatcher } from "@/core/nutrition";
import { FOODS } from "@/core/nutrition/data/foods";
import { createTasteIndex } from "@/core/taste";
import { SAMPLE_TASTE_DATA } from "@/core/taste/test-sample";
import type { DishRating } from "@/core/recipes";
import {
  buildTasteProfile,
  dishesFromCookings,
  fewDataText,
  rankPairingsByTaste,
  tasteChangesOrder,
  tasteProfileView,
  type FoodIdOf,
} from "./logic";

const index = createTasteIndex(SAMPLE_TASTE_DATA);
const matcher = createFoodMatcher(FOODS);
const foodIdOf: FoodIdOf = (name) => {
  const m = matcher.match(name);
  return m && m.confidence >= 0.95 ? m.food.id : undefined;
};
const foodNameOf = () => undefined;

const recipe = (recipeId: string, ...names: string[]) => ({ recipeId, ingredients: names.map((name) => ({ name })) });
const cooking = (recipeId: string, rating?: DishRating) => ({ recipeId, ...(rating ? { rating } : {}) });

// pomodoro sempre in piatti buoni, basilico in piatti buoni e cattivi
const recipes = [
  recipe("a", "Pomodoro", "Cipolle"),
  recipe("b", "Pomodoro", "Basilico"),
  recipe("c", "Pomodoro", "Mozzarella"),
  recipe("d", "Basilico", "Cipolle"),
  recipe("e", "Basilico", "Mozzarella"),
  recipe("f", "Basilico", "Pesca"),
  recipe("g", "Cipolle", "Mozzarella"),
  recipe("h", "Cipolle", "Mozzarella"),
  recipe("i", "Cipolle", "Mozzarella"),
];
const cookings = [
  cooking("a", "great"),
  cooking("b", "good"),
  cooking("c", "good"),
  cooking("d", "poor"),
  cooking("e", "poor"),
  cooking("f", "good"),
  cooking("g", "good"),
  cooking("h", "good"),
  cooking("i", "good"),
  cooking("a"),
];

describe("I tuoi gusti", () => {
  it("poche cotture votate: la frase «pochi dati» e niente elenco", () => {
    const { voted, cooked } = dishesFromCookings(cookings.slice(0, 3), recipes, index, foodIdOf, foodNameOf);
    const view = tasteProfileView(buildTasteProfile(voted, cooked), index, { allergens: [], excludedFoods: [] });
    expect(view).toEqual({ status: "few", text: fewDataText(3, 5) });
    expect(fewDataText(0, 5)).toContain("Nessun piatto votato");
    expect(fewDataText(0, 5)).toContain("Pochi dati");
  });

  it("conta bene e male per ingrediente, anche quando compare nei due versi", () => {
    const { voted, cooked } = dishesFromCookings(cookings, recipes, index, foodIdOf, foodNameOf);
    expect(voted).toHaveLength(9);
    expect(cooked).toHaveLength(10);
    const view = tasteProfileView(buildTasteProfile(voted, cooked), index, { allergens: [], excludedFoods: [] });
    if (view.status !== "ok") throw new Error("atteso ok");
    expect(view.liked.map((i) => [i.label, i.counts])).toEqual([["Pomodoro", "bene in 3 piatti"]]);
    expect(view.mixed.map((i) => [i.label, i.counts])).toEqual([["Basilico", "bene in 2 piatti, male in 2"]]);
    expect(view.basis).toContain("9 piatti votati");
  });

  it("un voto corretto dopo cambia i conteggi", () => {
    const corrected = cookings.map((c) => (c.recipeId === "d" ? cooking("d", "great") : c));
    const { voted, cooked } = dishesFromCookings(corrected, recipes, index, foodIdOf, foodNameOf);
    const view = tasteProfileView(buildTasteProfile(voted, cooked), index, { allergens: [], excludedFoods: [] });
    if (view.status !== "ok") throw new Error("atteso ok");
    expect(view.mixed).toEqual([]);
    expect(view.liked.map((i) => [i.label, i.counts])).toContainEqual(["Basilico", "bene in 3 piatti, male in 1"]);
  });

  it("gli esclusi non compaiono, e il numero dei nascosti si dice", () => {
    const { voted, cooked } = dishesFromCookings(cookings, recipes, index, foodIdOf, foodNameOf);
    const view = tasteProfileView(buildTasteProfile(voted, cooked), index, { allergens: [], excludedFoods: ["pomodoro"] });
    if (view.status !== "ok") throw new Error("atteso ok");
    expect(view.liked).toEqual([]);
    expect(view.hiddenCount).toBeGreaterThan(0);
  });

  it("un allergene riconoscibile solo dall'etichetta del prodotto collegato toglie la voce, come nel ricettario", () => {
    const { voted, cooked } = dishesFromCookings(cookings, recipes, index, foodIdOf, foodNameOf);
    const linkOf = (i: { name: string }) => (i.name === "Pomodoro" ? { allergens: ["latte"] } : undefined);
    const view = tasteProfileView(buildTasteProfile(voted, cooked), index, { allergens: ["latte"], excludedFoods: [], linkOf });
    if (view.status !== "ok") throw new Error("atteso ok");
    expect(view.liked.map((i) => i.label)).not.toContain("Pomodoro");
    expect(view.hiddenCount).toBeGreaterThan(0);
  });

  it("riordina gli abbinamenti senza toglierne: sale ciò che ti piace", () => {
    const { voted, cooked } = dishesFromCookings(cookings, recipes, index, foodIdOf, foodNameOf);
    const profile = buildTasteProfile(voted, cooked);
    const pomodoro = index.byKey.get("pomodoro");
    const basilico = index.byKey.get("basilico");
    if (!pomodoro || !basilico) throw new Error("dati di prova");
    const items = [{ food: basilico }, { food: pomodoro }];
    const ranked = rankPairingsByTaste(items, profile);
    expect(ranked.map((i) => i.food.key)).toEqual(["pomodoro", "basilico"]);
    expect(tasteChangesOrder(items, profile)).toBe(true);
    expect(tasteChangesOrder([...items].reverse(), profile)).toBe(false);
    expect(rankPairingsByTaste(items, buildTasteProfile([], []))).toEqual(items);
  });
});
