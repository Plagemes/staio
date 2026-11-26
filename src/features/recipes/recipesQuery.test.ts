import { describe, expect, it } from "vitest";
import { DEFAULT_RECIPES_QUERY, parseRecipesQuery, recipesQueryString, sortFilterSummary } from "./recipesQuery";

describe("parseRecipesQuery", () => {
  it("senza parametri vale lo stato di partenza", () => {
    expect(parseRecipesQuery("")).toEqual(DEFAULT_RECIPES_QUERY);
    expect(parseRecipesQuery("?")).toEqual(DEFAULT_RECIPES_QUERY);
  });

  it("legge ricerca, ordine, etichette e tempo", () => {
    expect(parseRecipesQuery("?q=pasta%20al%20forno&ordina=scade&etichette=veloce,forno&tempo=30")).toEqual({
      q: "pasta al forno",
      sort: "expiring",
      tags: ["veloce", "forno"],
      maxMinutes: 30,
    });
  });

  it("ignora i valori non validi", () => {
    expect(parseRecipesQuery("ordina=a-caso&tempo=7&etichette=,,a,,a")).toEqual({ q: "", sort: "title", tags: ["a"] });
    expect(parseRecipesQuery("tempo=abc")).toEqual(DEFAULT_RECIPES_QUERY);
    expect(parseRecipesQuery("tempo=-30")).toEqual(DEFAULT_RECIPES_QUERY);
  });

  it("accetta anche un URLSearchParams", () => {
    expect(parseRecipesQuery(new URLSearchParams({ ordina: "casa" })).sort).toBe("pantry");
  });
});

describe("recipesQueryString", () => {
  it("non scrive i valori di partenza", () => {
    expect(recipesQueryString(DEFAULT_RECIPES_QUERY)).toBe("");
    expect(recipesQueryString({ q: "   ", sort: "title", tags: [] })).toBe("");
  });

  it("andata e ritorno: indirizzo, stato, indirizzo", () => {
    for (const state of [
      { q: "pasta", sort: "expiring" as const, tags: [], maxMinutes: 30 },
      { q: "è così & basta", sort: "favorites" as const, tags: ["veloce", "per due"] },
      { q: "", sort: "pantry" as const, tags: [], maxMinutes: 60 },
      { q: "x", sort: "title" as const, tags: ["a"] },
    ]) {
      const text = recipesQueryString(state);
      expect(parseRecipesQuery(text)).toEqual(state);
      expect(recipesQueryString(parseRecipesQuery(text))).toBe(text);
    }
  });
});

describe("sortFilterSummary", () => {
  it("dice il nome dell'ordine se niente altro è scelto", () => {
    expect(sortFilterSummary(DEFAULT_RECIPES_QUERY)).toBe("Nome");
  });
  it("aggiunge tempo ed etichette", () => {
    expect(sortFilterSummary({ q: "", sort: "expiring", tags: ["veloce"], maxMinutes: 30 })).toBe("Per usare ciò che scade · fino a 30 minuti · veloce");
  });
});
