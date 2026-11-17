import { describe, expect, it } from "vitest";
import { deriveDishHistory, summarizeCookings, validateRecipeEvent, type Recipe, type RecipeHistory } from "@/core/recipes";
import { countsText, dishRatingEvent, historyText, type DishVote } from "./dishRating";
import { NO_FILTERS, buildRows, sortRows } from "./list";

const ctx = (n: number) => ({ now: `2026-03-0${n}T12:00:00.000Z`, deviceId: "dev-a", idGenerator: () => `id-${n}` });

type Item = DishVote & { recipeId: string };

function history(items: Item[]): Map<string, RecipeHistory> {
  const events = items.flatMap((vote, i) => {
    const r = dishRatingEvent(`m${i}`, vote.recipeId, vote, ctx(i + 1));
    return r.ok ? [r.event] : [];
  });
  const meals = items.map((_, i) => ({ id: `ml${i}`, type: "meal", mealId: `m${i}` }));
  return summarizeCookings(deriveDishHistory([...meals, ...events]).cookings);
}

describe("evento dishRating", () => {
  it("è valido con e senza voto, e non porta campi vuoti", () => {
    const a = dishRatingEvent("m1", "r1", {}, ctx(1));
    const b = dishRatingEvent("m1", "r1", { rating: "great", again: true }, ctx(2));
    if (!a.ok || !b.ok) throw new Error("atteso ok");
    expect(validateRecipeEvent(a.event)).toEqual([]);
    expect("rating" in a.event).toBe(false);
    expect(b.event).toMatchObject({ rating: "great", again: true, mealId: "m1", recipeId: "r1" });
  });
});

describe("storico a parole", () => {
  it("cucinata 4 volte, l'ultima ottima", () => {
    const h = history([
      { recipeId: "r", rating: "poor" },
      { recipeId: "r", rating: "good" },
      { recipeId: "r", rating: "good" },
      { recipeId: "r", rating: "great" },
    ]).get("r");
    expect(historyText(h)).toBe("Cucinata 4 volte, l'ultima ottima");
    expect(countsText(h as RecipeHistory)).toBe("1 ottima, 2 buone, 1 non buona");
  });
  it("una volta, senza voto, con «lo rifarei»", () => {
    expect(historyText(history([{ recipeId: "r" }]).get("r"))).toBe("Cucinata una volta");
    expect(historyText(history([{ recipeId: "r", rating: "great", again: true }]).get("r"))).toBe("Cucinata una volta, è venuta ottima: la rifaresti");
    expect(historyText(undefined)).toBeUndefined();
  });
});

describe("«Le tue preferite»", () => {
  const recipe = (recipeId: string, title: string): Recipe => ({
    recipeId,
    title,
    servings: 2,
    ingredients: [{ name: "Riso" }],
    steps: [],
    equipment: [],
    tags: [],
    certainty: "measured",
    updatedAt: "2026-03-01T00:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    eventId: `e-${recipeId}`,
  });
  const recipes = [recipe("a", "Arrosto"), recipe("b", "Brodo"), recipe("c", "Crema"), recipe("d", "Dolce")];
  const pantry = { stock: [], expiring: [] };

  it("prima le meglio votate, poi le mai votate per nome; stesso risultato a ogni ordine", () => {
    const h = history([
      { recipeId: "b", rating: "good" },
      { recipeId: "c", rating: "great" },
      { recipeId: "d" },
    ]);
    const order = (rs: Recipe[]) => sortRows(buildRows(rs, pantry, h), "favorites").map((r) => r.recipe.recipeId);
    expect(order(recipes)).toEqual(["c", "b", "a", "d"]);
    expect(order([...recipes].reverse())).toEqual(["c", "b", "a", "d"]);
    expect(buildRows(recipes, pantry, h)[2]?.history?.times).toBe(1);
    expect(NO_FILTERS.query).toBe("");
  });
});
