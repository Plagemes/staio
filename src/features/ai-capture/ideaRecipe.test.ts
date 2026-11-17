import { describe, expect, it } from "vitest";
import type { PantryRef } from "@/core/ai/mealPhraseShared";
import { checkIdeas } from "@/core/ai/recipeIdeasCheck";
import { parseRecipeIdeas } from "@/core/ai/recipeIdeasParse";
import { deriveRecipes, validateRecipeEvent } from "@/core/recipes";
import { GENERATED_TAG, UNCERTAIN_NOT_CONFIRMED, fieldsFromIdea, recipeEventFromIdea } from "./ideaRecipe";

const PANTRY: PantryRef[] = [{ id: "A1", name: "Zucchine", remaining: { value: 500, unit: "g" }, daysLeft: 1 }];
const source = { provider: "Anthropic (Claude)", model: "claude-sonnet-5-5" };
const ctx = { now: "2026-11-17T10:00:00.000Z", deviceId: "d" };

const reading = parseRecipeIdeas(
  JSON.stringify({
    recipes: [
      {
        title: "Zucchine in padella",
        servings: 2,
        prepMinutes: 5,
        cookMinutes: 10,
        ingredients: [{ name: "Zucchine", quantity: 300, unit: "g", id: "A1" }, { name: "Olio", quantity: 1, unit: "cucchiaio" }, { name: "Sale" }],
        steps: [{ text: "Taglia e salta in padella.", minutes: 10 }],
        equipment: ["padella"],
        notes: "Si conservano 2 giorni in frigo.",
      },
    ],
  }),
  PANTRY,
);
const [checked] = checkIdeas(reading.ideas, { allergens: [], excludedFoods: [] }, PANTRY).accepted;

describe("salvataggio di un'idea nel ricettario", () => {
  it("marcata come generata, con la fonte dichiarata e certezza stimata", () => {
    const result = recipeEventFromIdea(checked, source, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.event.tags).toEqual([GENERATED_TAG]);
    expect(result.event.origin?.author).toMatch(/generata da Anthropic.*claude-sonnet-5-5.*da rivedere/);
    expect(result.event.certainty).toBe("estimated");
    expect(validateRecipeEvent(result.event)).toEqual([]);
  });

  it("ingredienti, passi, tempi e attrezzatura passano; le note del modello diventano un passo dichiarato", () => {
    const fields = fieldsFromIdea(checked, source);
    expect(fields.ingredients.map((i) => i.name)).toEqual(["Zucchine", "Olio", "Sale"]);
    expect(fields.ingredients[0].quantity).toEqual({ value: 300, unit: "g" });
    expect(fields.times).toEqual({ prepMinutes: 5, cookMinutes: 10 });
    expect(fields.equipment).toEqual(["padella"]);
    expect(fields.steps).toHaveLength(2);
    expect(fields.steps[1].text).toMatch(/da verificare.*2 giorni/);
  });

  it("il ricettario la rilegge come ricetta con l'etichetta «generata»", () => {
    const result = recipeEventFromIdea(checked, source, ctx);
    if (!result.ok) throw new Error(result.error);
    const state = deriveRecipes([result.event]);
    expect(state.recipes).toHaveLength(1);
    expect(state.recipes[0].tags).toContain(GENERATED_TAG);
    expect(state.recipes[0].origin?.author).toContain("idea generata");
  });
});

describe("ingredienti incerti per gli allergeni dichiarati", () => {
  const pantry: PantryRef[] = [
    ...PANTRY,
    { id: "A2", name: "Crema di arachidi", remaining: { value: 200, unit: "g" } },
    { id: "A3", name: "Dado vegetale", remaining: { value: 10, unit: "pz" } },
  ];
  const withDado = parseRecipeIdeas(
    JSON.stringify({
      recipes: [
        {
          title: "Zucchine al brodo",
          servings: 2,
          ingredients: [{ name: "Zucchine", quantity: 300, unit: "g", id: "A1" }, { name: "Dado", quantity: 1, unit: "pz", id: "A3" }],
          steps: [{ text: "Cuoci le zucchine nel brodo.", minutes: 15 }],
        },
        {
          title: "Zucchine con crema",
          servings: 2,
          ingredients: [{ name: "Zucchine", quantity: 300, unit: "g", id: "A1" }, { name: "Crema", quantity: 30, unit: "g", id: "A2" }],
          steps: [{ text: "Condisci.", minutes: 2 }],
        },
      ],
    }),
    pantry,
  );

  it("con l'allergia alle arachidi la «crema» collegata alla crema di arachidi è scartata; il dado resta, ma incerto", () => {
    const out = checkIdeas(withDado.ideas, { allergens: ["arachidi"], excludedFoods: [] }, pantry);
    expect(out.rejected.map((r) => r.idea.title)).toEqual(["Zucchine con crema"]);
    expect(out.rejected[0]?.reasons.join(" ")).toMatch(/arachidi.*Crema di arachidi/);
    expect(out.accepted.map((a) => a.idea.title)).toEqual(["Zucchine al brodo"]);
    expect(out.accepted[0]?.uncertain.join(" ")).toMatch(/Dado.*arachidi/);
  });

  it("una ricetta incerta non si salva senza la conferma esplicita; con la conferma sì", () => {
    const [uncertain] = checkIdeas(withDado.ideas, { allergens: ["sedano"], excludedFoods: [] }, pantry).accepted;
    if (!uncertain) throw new Error("manca la ricetta");
    expect(uncertain.uncertain.length).toBeGreaterThan(0);
    const refused = recipeEventFromIdea(uncertain, source, ctx);
    expect(refused).toEqual({ ok: false, error: UNCERTAIN_NOT_CONFIRMED });
    expect(recipeEventFromIdea(uncertain, source, ctx, { confirmedUncertain: false }).ok).toBe(false);
    expect(recipeEventFromIdea(uncertain, source, ctx, { confirmedUncertain: true }).ok).toBe(true);
  });

  it("senza allergeni dichiarati non c'è nulla di incerto", () => {
    const out = checkIdeas(withDado.ideas, { allergens: [], excludedFoods: [] }, pantry);
    expect(out.accepted.every((a) => a.uncertain.length === 0)).toBe(true);
    expect(recipeEventFromIdea(out.accepted[0] as (typeof out.accepted)[number], source, ctx).ok).toBe(true);
  });

  it("gli allergeni in etichetta del prodotto di dispensa contano", () => {
    const labelled = pantry.map((p) => (p.id === "A3" ? { ...p, productName: "Granulare classico", allergens: ["en:celery"] } : p));
    const out = checkIdeas(withDado.ideas, { allergens: ["sedano"], excludedFoods: [] }, labelled);
    expect(out.rejected.map((r) => r.idea.title)).toContain("Zucchine al brodo");
    expect(out.rejected.find((r) => r.idea.title === "Zucchine al brodo")?.reasons.join(" ")).toMatch(/etichetta/);
  });
});

describe("idee con ingredienti confermati dall'utente", () => {
  it("un'idea con soli ingredienti confermati si salva senza la spunta generale: il dubbio non c'è più", () => {
    const withConfirmed = { ...checked, uncertain: [], uncertainIngredients: [], confirmed: [{ name: "Prosciutto cotto", allergens: ["latte"], confirmedAt: "2026-11-05T09:00:00.000Z" }] };
    expect(recipeEventFromIdea(withConfirmed, source, ctx).ok).toBe(true);
  });

  it("un'idea con ancora un ingrediente incerto non si salva senza la spunta", () => {
    const open = { ...checked, uncertain: ["«Crema» è un ingrediente generico o composto"] };
    const r = recipeEventFromIdea(open, source, ctx);
    expect(r.ok).toBe(false);
  });
});
