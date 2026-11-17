import { describe, expect, it } from "vitest";
import { cookedTogether, type RecipeFood } from "./cooked-together";

const f = (key: string): RecipeFood => ({ key, name: key.toUpperCase() });
const r = (...keys: string[]) => keys.map(f);
const keys = (x: { pairs: { food: RecipeFood }[] }) => x.pairs.map((p) => p.food.key);

describe("abbinamenti dalle ricette", () => {
  it("nessuna ricetta: niente coppie", () => {
    expect(cookedTogether([], "a")).toEqual({ recipeCount: 0, withFood: 0, pairs: [], seenOnce: 0, staples: [] });
  });

  it("una ricetta: l'alimento compare, ma con una sola ricetta nessuna coppia vale", () => {
    const res = cookedTogether([r("a", "b", "c")], "a");
    expect(res.recipeCount).toBe(1);
    expect(res.withFood).toBe(1);
    expect(res.pairs).toEqual([]);
    expect(res.seenOnce).toBe(2);
  });

  it("alimento che non è in nessuna ricetta", () => {
    const res = cookedTogether([r("b", "c"), r("b", "c")], "a");
    expect(res.withFood).toBe(0);
    expect(res.pairs).toEqual([]);
    expect(res.seenOnce).toBe(0);
  });

  it("una coppia vale da 2 ricette in comune; con una è solo contata a parte", () => {
    const res = cookedTogether([r("a", "b", "c"), r("a", "b", "d"), r("b", "c")], "a");
    expect(res.pairs).toEqual([{ food: f("b"), together: 2 }]);
    expect(res.seenOnce).toBe(2);
    expect(res.withFood).toBe(2);
  });

  it("un ingrediente ripetuto nella stessa ricetta conta una volta", () => {
    const once = cookedTogether([r("a", "b", "b", "b"), r("a", "a", "c")], "a");
    expect(once.pairs).toEqual([]);
    expect(once.withFood).toBe(2);
    const twice = cookedTogether([r("a", "b", "b"), r("b", "a")], "a");
    expect(twice.pairs).toEqual([{ food: f("b"), together: 2 }]);
  });

  it("gli ingredienti non riconosciuti (chiave vuota) sono ignorati; le ricette senza riconosciuti non contano", () => {
    const unknown: RecipeFood = { key: "", name: "sconosciuto" };
    const res = cookedTogether([[f("a"), unknown, f("b")], [unknown], [f("a"), f("b")]], "a");
    expect(res.recipeCount).toBe(2);
    expect(res.pairs).toEqual([{ food: f("b"), together: 2 }]);
  });

  it("ordine: per ricette in comune, poi alfabetico, indipendente dall'ordine di ingresso", () => {
    const recipes = [r("a", "z", "m", "b"), r("a", "z", "m", "b"), r("a", "z"), r("a", "c", "b"), r("a", "c")];
    const res = cookedTogether(recipes, "a");
    expect(keys(res)).toEqual(["b", "z", "c", "m"]);
    expect(res.pairs.map((p) => p.together)).toEqual([3, 3, 2, 2]);
    const reversed = cookedTogether([...recipes].reverse().map((x) => [...x].reverse()), "a");
    expect(reversed).toEqual(res);
  });

  it("l'ordine alfabetico è italiano, senza badare alle maiuscole", () => {
    const x1: RecipeFood = { key: "x1", name: "zucchine" };
    const x2: RecipeFood = { key: "x2", name: "Aglio" };
    const res = cookedTogether([[f("a"), x1, x2], [f("a"), x1, x2]], "a");
    expect(res.pairs.map((p) => p.food.name)).toEqual(["Aglio", "zucchine"]);
  });

  describe("ingredienti di base", () => {
    const salt = "sale";

    it("con meno di 6 ricette non si toglie nulla", () => {
      const recipes = [r("a", salt), r("a", salt), r("a", salt), r("a", salt), r("a", salt)];
      const res = cookedTogether(recipes, "a");
      expect(keys(res)).toEqual([salt]);
      expect(res.staples).toEqual([]);
    });

    it("con almeno 6 ricette si tolgono quelli in più di metà, e si dichiara quali", () => {
      // sale: 4 su 6 (più di metà)
      const recipes = [r("a", salt, "b"), r("a", salt, "b"), r("a", salt, "b"), r(salt, "c"), r("c"), r("c", "d")];
      const res = cookedTogether(recipes, "a");
      expect(keys(res)).toEqual(["b"]);
      expect(res.staples).toEqual([f(salt)]);
    });

    it("esattamente metà non è più di metà", () => {
      const recipes = [r("a", "b"), r("a", "b"), r("a", "b"), r("c"), r("c"), r("c")];
      const res = cookedTogether(recipes, "a");
      expect(keys(res)).toEqual(["b"]);
      expect(res.staples).toEqual([]);
    });

    it("l'alimento scelto non è mai tolto, anche se è di base", () => {
      const recipes = [r(salt, "b"), r(salt, "b"), r(salt, "b"), r(salt, "c"), r(salt), r(salt, "d")];
      const res = cookedTogether(recipes, salt);
      expect(res.withFood).toBe(6);
      expect(keys(res)).toEqual(["b"]);
      expect(res.staples).toEqual([]);
    });
  });
});
