import { describe, expect, it } from "vitest";
import { deriveRecipes } from "@/core/recipes";
import { recipeOf } from "../prep/test-helpers";
import { splitList } from "./common";
import {
  addLeftoverAsIngredient,
  addLeftoverAsStep,
  buildRecipeFields,
  emptyForm,
  formFromDraft,
  formFromRecipe,
  readIngredientQuantity,
  readMinutes,
  readServings,
  type RecipeForm,
} from "./form";
import { fieldsOfRecipe, rateRecipe, recipeEventFromFields, retireRecipe } from "./model";

function filled(over: Partial<RecipeForm> = {}): RecipeForm {
  const f = emptyForm();
  return {
    ...f,
    title: "  Pasta   al pomodoro ",
    servingsText: "4",
    ingredients: [
      { ...f.ingredients[0], name: "Spaghetti", quantityText: "320 g" },
      { ...f.ingredients[1], name: "Pomodori", quantityText: "2", note: "maturi" },
      { ...f.ingredients[2], name: "Sale", quantityText: "" },
    ],
    steps: [{ ...f.steps[0], text: "Cuoci la pasta.", minutesText: "10" }],
    prepText: "5",
    totalText: "1 h 30",
    equipmentText: "pentola, Pentola, forno",
    tagsText: "primo; veloce",
    sourceUrl: "https://esempio.it/pasta",
    sourceAuthor: " Maria ",
    ...over,
  };
}

describe("letture dei campi", () => {
  it("quantità: vuoto è «quanto basta», un numero solo vale pezzi, il resto va riconosciuto", () => {
    expect(readIngredientQuantity("")).toEqual({ ok: true, value: undefined });
    expect(readIngredientQuantity("2")).toEqual({ ok: true, value: { value: 2, unit: "pz" } });
    expect(readIngredientQuantity("1,5 kg")).toEqual({ ok: true, value: { value: 1.5, unit: "kg" } });
    expect(readIngredientQuantity("2 cucchiai")).toEqual({ ok: true, value: { value: 2, unit: "cucchiaio" } });
    expect(readIngredientQuantity("tanto").ok).toBe(false);
    expect(readIngredientQuantity("0 g").ok).toBe(false);
    expect(readIngredientQuantity("200 g farina").ok).toBe(false);
  });

  it("minuti", () => {
    expect(readMinutes("")).toEqual({ ok: true, value: undefined });
    expect(readMinutes("20")).toEqual({ ok: true, value: 20 });
    expect(readMinutes("1 h 30")).toEqual({ ok: true, value: 90 });
    expect(readMinutes("tra poco").ok).toBe(false);
    expect(readMinutes("0").ok).toBe(false);
  });

  it("porzioni", () => {
    expect(readServings("4")).toEqual({ ok: true, value: 4 });
    expect(readServings("2,5")).toEqual({ ok: true, value: 2.5 });
    expect(readServings("").ok).toBe(false);
    expect(readServings("-1").ok).toBe(false);
    expect(readServings("5000").ok).toBe(false);
  });

  it("elenchi: senza doppioni né voci vuote", () => {
    expect(splitList("forno, Forno ; ,padella\nmixer")).toEqual(["forno", "padella", "mixer"]);
  });
});

describe("buildRecipeFields", () => {
  it("compone i campi di un evento ripuliti", () => {
    const r = buildRecipeFields(filled());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.title).toBe("Pasta al pomodoro");
    expect(r.fields.servings).toBe(4);
    expect(r.fields.ingredients).toEqual([
      { name: "Spaghetti", quantity: { value: 320, unit: "g" } },
      { name: "Pomodori", quantity: { value: 2, unit: "pz" }, note: "maturi" },
      { name: "Sale" },
    ]);
    expect(r.fields.steps).toEqual([{ text: "Cuoci la pasta.", durationMinutes: 10 }]);
    expect(r.fields.times).toEqual({ prepMinutes: 5, totalMinutes: 90 });
    expect(r.fields.equipment).toEqual(["pentola", "forno"]);
    expect(r.fields.tags).toEqual(["primo", "veloce"]);
    expect(r.fields.origin).toEqual({ url: "https://esempio.it/pasta", author: "Maria" });
  });

  it("l'alimento scelto dalla tabella diventa foodId; senza scelta non c'è", () => {
    const form = filled();
    form.ingredients[0] = { ...form.ingredients[0], foodId: "pasta-semola-secca" };
    const r = buildRecipeFields(form);
    expect(r.ok && r.fields.ingredients[0]?.foodId).toBe("pasta-semola-secca");
    expect(r.ok && r.fields.ingredients[1]?.foodId).toBeUndefined();
  });

  it("segnala gli errori accanto al campo giusto e non salva niente", () => {
    const form = filled({ title: " ", servingsText: "", totalText: "boh", sourceUrl: "ftp://x" });
    form.ingredients[0] = { ...form.ingredients[0], quantityText: "molto" };
    form.ingredients[1] = { ...form.ingredients[1], name: "", quantityText: "3" };
    form.steps[0] = { ...form.steps[0], minutesText: "x" };
    const r = buildRecipeFields(form);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.title).toBeDefined();
    expect(r.errors.servings).toBeDefined();
    expect(r.errors.times.total).toBeDefined();
    expect(r.errors.sourceUrl).toBeDefined();
    expect(Object.keys(r.errors.ingredients)).toHaveLength(2);
    expect(Object.keys(r.errors.steps)).toHaveLength(1);
  });

  it("chiede almeno un ingrediente e un passo", () => {
    const noIng = buildRecipeFields({ ...filled(), ingredients: [] });
    expect(!noIng.ok && noIng.errors.general).toBe("Aggiungi almeno un ingrediente.");
    const noStep = buildRecipeFields({ ...filled(), steps: [] });
    expect(!noStep.ok && noStep.errors.general).toBe("Aggiungi almeno un passo.");
  });

  it("le righe del tutto vuote si saltano", () => {
    const r = buildRecipeFields(filled());
    expect(r.ok && r.fields.ingredients).toHaveLength(3);
  });
});

describe("da ricetta a modulo e ritorno", () => {
  it("una modifica senza cambiamenti restituisce la stessa ricetta, anche con quantità frazionarie", () => {
    const rec = recipeOf("r", {
      servings: 3,
      ingredients: [{ name: "Zucchero", quantity: { value: 0.3333, unit: "cucchiaio" } }, { name: "Latte", quantity: { value: 250, unit: "ml" }, foodId: "latte-vaccino-intero" }],
      tags: ["dolce"],
    });
    const r = buildRecipeFields(formFromRecipe(rec));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.ingredients).toEqual(rec.ingredients);
    expect(r.fields.servings).toBe(3);
    expect(r.fields.tags).toEqual(["dolce"]);
  });
});

describe("bozza dall'importazione", () => {
  it("le porzioni non dette dalla fonte restano da scrivere", () => {
    const form = formFromDraft({
      title: "Torta",
      ingredients: [{ raw: "200 g farina", name: "farina", quantity: { value: 200, unit: "g" }, recognized: true }],
      steps: [{ text: "Inforna", durationMinutes: 40 }],
      origin: { url: "https://esempio.it/torta", author: "Anna" },
    });
    expect(form.servingsText).toBe("");
    expect(form.sourceUrl).toBe("https://esempio.it/torta");
    expect(form.sourceAuthor).toBe("Anna");
    const r = buildRecipeFields(form);
    expect(!r.ok && r.errors.servings).toBeDefined();
    const ok = buildRecipeFields({ ...form, servingsText: "8" });
    expect(ok.ok && ok.fields.origin).toEqual({ url: "https://esempio.it/torta", author: "Anna" });
  });

  it("le righe non riconosciute si collocano a mano, senza perderle", () => {
    const base = emptyForm();
    const withStep = addLeftoverAsStep(base, "Servire caldo");
    expect(withStep.steps.some((s) => s.text === "Servire caldo")).toBe(true);
    const withIng = addLeftoverAsIngredient(base, "un pizzico di magia");
    expect(withIng.ingredients.some((i) => i.name === "un pizzico di magia")).toBe(true);
    expect(withIng.ingredients).toHaveLength(base.ingredients.length);
  });
});

describe("eventi della ricetta", () => {
  const ctx = { now: "2026-11-16T10:00:00.000Z", deviceId: "dev-a" };

  it("salva una ricetta valida come evento", () => {
    const f = buildRecipeFields(filled());
    if (!f.ok) throw new Error("atteso ok");
    const r = recipeEventFromFields(f.fields, ctx, { certainty: "measured" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("recipe");
    const state = deriveRecipes([r.event]);
    expect(state.recipes).toHaveLength(1);
    expect(state.recipes[0]?.title).toBe("Pasta al pomodoro");
  });

  it("voto e ritiro sono nuove versioni; annullarle riporta la precedente", () => {
    const rec = recipeOf("r", {}, "2026-11-10T10:00:00.000Z");
    const original = {
      id: "e-r",
      type: "recipe" as const,
      at: "2026-11-10T10:00:00.000Z",
      recordedAt: "2026-11-10T10:00:00.000Z",
      deviceId: "dev-a",
      schemaVersion: 1 as const,
      certainty: "label" as const,
      source: "manual" as const,
      recipeId: "r",
      title: rec.title,
      servings: rec.servings,
      ingredients: rec.ingredients,
      steps: rec.steps,
    };
    const rated = rateRecipe(rec, 4, ctx);
    if (!rated.ok) throw new Error("atteso ok");
    expect(rated.event.rating).toBe(4);
    expect(deriveRecipes([original, rated.event]).recipes[0]?.rating).toBe(4);

    const retired = retireRecipe(rec, ctx);
    if (!retired.ok) throw new Error("atteso ok");
    const after = deriveRecipes([original, retired.event]);
    expect(after.recipes).toEqual([]);
    expect(after.archived[0]?.recipeId).toBe("r");

    const undo = {
      id: "v1",
      type: "void" as const,
      at: ctx.now,
      recordedAt: "2026-11-16T10:01:00.000Z",
      deviceId: "dev-a",
      schemaVersion: 1 as const,
      certainty: "measured" as const,
      source: "manual" as const,
      targetEventId: retired.event.id,
    };
    expect(deriveRecipes([original, retired.event, undo]).recipes).toHaveLength(1);
  });

  it("la nuova versione conserva tutti i campi", () => {
    const rec = recipeOf("r", { tags: ["a"], equipment: ["forno"], origin: { url: "https://x.it/a", author: "Z" }, times: { totalMinutes: 20 } });
    const fields = fieldsOfRecipe(rec);
    expect(fields.tags).toEqual(["a"]);
    expect(fields.origin).toEqual({ url: "https://x.it/a", author: "Z" });
    expect(fields.times).toEqual({ totalMinutes: 20 });
  });
});
