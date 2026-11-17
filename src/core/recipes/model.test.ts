import { describe, expect, it } from "vitest";
import { deriveRecipes } from "./derive";
import { RECIPE_EVENT_TYPES } from "./types";
import { isRecipeEvent, validateRecipeEvent } from "./validate";
import { recipeEvent, voidEvent } from "./test-helpers";

const T1 = "2026-03-01T10:00:00.000Z";
const T2 = "2026-03-02T10:00:00.000Z";
const T3 = "2026-03-03T10:00:00.000Z";
const codes = (e: unknown) => validateRecipeEvent(e).map((x) => `${x.path}:${x.code}`);

describe("validateRecipeEvent", () => {
  it("accetta una ricetta valida e un void", () => {
    expect(validateRecipeEvent(recipeEvent("e1", T1))).toEqual([]);
    expect(validateRecipeEvent(voidEvent("v1", T1, "e1"))).toEqual([]);
  });

  it("espone i tipi e il riconoscimento", () => {
    expect(RECIPE_EVENT_TYPES).toEqual(["recipe", "dishRating"]);
    expect(isRecipeEvent(recipeEvent("e1", T1))).toBe(true);
    expect(isRecipeEvent({ type: "meal" })).toBe(false);
    expect(isRecipeEvent(null)).toBe(false);
  });

  it("controlla la busta comune", () => {
    expect(codes({ ...recipeEvent("e1", T1), recordedAt: "ieri" })).toContain("recordedAt:invalid_instant");
    expect(codes({ ...recipeEvent("e1", T1), deviceId: undefined })).toContain("deviceId:required");
    expect(codes(null)).toEqual([":not_an_object"]);
  });

  it("controlla i campi propri", () => {
    expect(codes(recipeEvent("e1", T1, { title: "  " }))).toContain("title:invalid_type");
    expect(codes(recipeEvent("e1", T1, { servings: 0 }))).toContain("servings:not_positive");
    expect(codes(recipeEvent("e1", T1, { servings: 5000 }))).toContain("servings:invalid_value");
    expect(codes(recipeEvent("e1", T1, { recipeId: undefined }))).toContain("recipeId:required");
    expect(
      codes(recipeEvent("e1", T1, { ingredients: [{ name: "x", quantity: { value: -1, unit: "g" } }] })),
    ).toContain("ingredients.0.quantity.value:not_positive");
    expect(
      codes(
        recipeEvent("e1", T1, {
          ingredients: [{ name: "x", quantity: { value: 1, unit: "furlong" as never } }],
        }),
      ),
    ).toContain("ingredients.0.quantity.unit:invalid_value");
    expect(
      codes(recipeEvent("e1", T1, { ingredients: [{ name: "x", foodId: "Pasta Secca" }] })),
    ).toContain("ingredients.0.foodId:invalid_value");
    expect(codes(recipeEvent("e1", T1, { steps: [{ text: "ok", durationMinutes: -3 }] }))).toContain(
      "steps.0.durationMinutes:negative",
    );
    expect(codes(recipeEvent("e1", T1, { rating: 6 }))).toContain("rating:invalid_value");
    expect(codes(recipeEvent("e1", T1, { origin: { url: "ftp://x" } }))).toContain("origin.url:invalid_value");
    expect(codes(recipeEvent("e1", T1, { times: { cookMinutes: Number.NaN } }))).toContain(
      "times.cookMinutes:invalid_type",
    );
    expect(codes({ ...recipeEvent("e1", T1), type: "ricetta" })).toContain("type:invalid_value");
  });

  it("ammette quantità assente, foodId vuoto, voto e fonte", () => {
    const e = recipeEvent("e1", T1, {
      ingredients: [{ name: "Sale", foodId: "" }],
      rating: 4.5,
      origin: { url: "https://esempio.it/ricetta", author: "Nonna" },
      times: { prepMinutes: 10, cookMinutes: 20, totalMinutes: 30 },
      equipment: ["forno"],
      tags: ["primo"],
    });
    expect(validateRecipeEvent(e)).toEqual([]);
  });

  it("non lancia mai", () => {
    const hostile = {
      get type(): string {
        throw new Error("x");
      },
    };
    for (const v of [undefined, 3, "x", [], { type: "recipe" }, hostile]) {
      expect(() => validateRecipeEvent(v)).not.toThrow();
    }
  });
});

describe("deriveRecipes", () => {
  it("l'ultimo evento per recordedAt sostituisce il precedente", () => {
    const s = deriveRecipes([
      recipeEvent("e1", T1, { title: "Vecchia" }),
      recipeEvent("e2", T2, { title: "Nuova" }),
    ]);
    expect(s.recipes.map((r) => r.title)).toEqual(["Nuova"]);
    expect(s.recipes[0]?.createdAt).toBe(T1);
    expect(s.recipes[0]?.updatedAt).toBe(T2);
  });

  it("a pari recordedAt vince l'id maggiore", () => {
    const s = deriveRecipes([
      recipeEvent("a", T1, { title: "A" }),
      recipeEvent("b", T1, { title: "B" }),
    ]);
    expect(s.recipes[0]?.title).toBe("B");
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = [
      recipeEvent("e1", T1, { title: "Uno" }),
      recipeEvent("e2", T2, { title: "Due", recipeId: "r2" }),
      recipeEvent("e3", T3, { title: "Uno bis" }),
      voidEvent("v1", T3, "e2"),
      { type: "meal", id: "m1" },
    ];
    const base = deriveRecipes(events);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...events].sort(() => Math.random() - 0.5);
      expect(deriveRecipes(shuffled)).toEqual(base);
    }
    expect(base.recipes.map((r) => r.title)).toEqual(["Uno bis"]);
  });

  it("archived ritira la ricetta e una versione successiva la riporta", () => {
    const s = deriveRecipes([recipeEvent("e1", T1), recipeEvent("e2", T2, { archived: true })]);
    expect(s.recipes).toEqual([]);
    expect(s.archived.map((r) => r.recipeId)).toEqual(["r1"]);
    const back = deriveRecipes([
      recipeEvent("e1", T1),
      recipeEvent("e2", T2, { archived: true }),
      recipeEvent("e3", T3),
    ]);
    expect(back.recipes).toHaveLength(1);
  });

  it("un void annulla un evento; un void annullato lo ripristina", () => {
    const e1 = recipeEvent("e1", T1, { title: "Prima" });
    const e2 = recipeEvent("e2", T2, { title: "Seconda" });
    expect(deriveRecipes([e1, e2, voidEvent("v1", T3, "e2")]).recipes[0]?.title).toBe("Prima");
    const s = deriveRecipes([e1, e2, voidEvent("v1", T3, "e2"), voidEvent("v2", T3, "v1")]);
    expect(s.recipes[0]?.title).toBe("Seconda");
    expect(s.voidedEventIds).toEqual(["v1"]);
  });

  it("annullare l'unica versione fa sparire la ricetta; un ciclo di void è segnalato", () => {
    expect(deriveRecipes([recipeEvent("e1", T1), voidEvent("v1", T2, "e1")]).recipes).toEqual([]);
    const s = deriveRecipes([
      recipeEvent("e1", T1),
      voidEvent("v1", T2, "v2"),
      voidEvent("v2", T2, "v1"),
    ]);
    expect(s.anomalies.map((a) => a.code)).toContain("void_cycle");
    expect(s.recipes).toHaveLength(1);
  });

  it("scarta gli eventi non validi e segnala i conflitti di id", () => {
    const bad = { ...recipeEvent("bad", T1), servings: -1 };
    const a = recipeEvent("dup", T1, { title: "A" });
    const b = recipeEvent("dup", T1, { title: "B", recipeId: "r9" });
    const s = deriveRecipes([bad, a, b]);
    expect(s.anomalies.map((x) => x.code).sort()).toEqual(["id_conflict", "invalid_event"]);
    expect(s.recipes).toHaveLength(1);
    expect(deriveRecipes([b, a, bad])).toEqual(s);
  });

  it("ordina per titolo e restituisce copie indipendenti", () => {
    const e = recipeEvent("e1", T1, { title: "zuppa", recipeId: "z" });
    const s = deriveRecipes([e, recipeEvent("e2", T1, { title: "Arrosto", recipeId: "a" })]);
    expect(s.recipes.map((r) => r.recipeId)).toEqual(["a", "z"]);
    s.recipes[1]?.ingredients.push({ name: "x" });
    expect(e.ingredients).toHaveLength(3);
  });

  it("non lancia con input strani", () => {
    expect(() => deriveRecipes([null, 3, "x", undefined, { type: "recipe" }] as unknown[])).not.toThrow();
    expect(deriveRecipes(undefined as unknown as unknown[]).recipes).toEqual([]);
  });
});
