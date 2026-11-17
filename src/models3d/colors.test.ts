import { describe, expect, it } from "vitest";
import { FOOD_COLORS } from "./catalog/foodColors";
import { getRecipe, listRecipes } from "./catalog";
import { CATEGORY_COLORS, colorOfPart, FRESH_CATEGORIES, isHexColor, mixHex, NEUTRAL_GRAY, resolveRecipeColors, withCategoryColor } from "./colors";
import { recipeForUnknown } from "./fallback";
import { buildModel } from "./generate";
import { CATEGORIES, validateRecipe, type Recipe } from "./recipe";

const SLOTS = ["main", "rind", "stem", "leaf", "cap", "label", "seed", "fin", "eye"] as const;

describe("colori del catalogo", () => {
  const all = listRecipes();

  it("ogni voce del catalogo risolve a colori validi", () => {
    for (const recipe of all) {
      const { colors } = resolveRecipeColors(recipe);
      for (const slot of SLOTS) expect(isHexColor(colors[slot]), `${recipe.id}.${slot} = ${colors[slot]}`).toBe(true);
    }
  });

  it("ogni voce ha un colore specifico, e nessun fresco resta sul predefinito o sul grigio", () => {
    for (const recipe of all) expect(resolveRecipeColors(recipe).source, recipe.id).not.toBe("default");
    const fresh = all.filter((r) => FRESH_CATEGORIES.includes(r.category));
    expect(fresh.length).toBeGreaterThan(150);
    for (const recipe of fresh) {
      const { colors, source } = resolveRecipeColors(recipe);
      expect(source, recipe.id).not.toBe("default");
      expect(colors.main.toLowerCase(), recipe.id).not.toBe(NEUTRAL_GRAY);
    }
  });

  it("la tabella dei colori non contiene id che il catalogo non ha", () => {
    const ids = new Set(all.map((r) => r.id));
    for (const id of Object.keys(FOOD_COLORS)) expect(ids.has(id), id).toBe(true);
  });

  it("ogni categoria ha colori validi, e le fresche non sono grigie", () => {
    for (const category of CATEGORIES) {
      const c = CATEGORY_COLORS[category];
      for (const v of [c.main, c.label, c.stem, c.leaf]) expect(isHexColor(v), `${category}: ${v}`).toBe(true);
    }
    for (const category of FRESH_CATEGORIES) expect(CATEGORY_COLORS[category].main).not.toBe(NEUTRAL_GRAY);
  });

  it("ogni parte di ogni modello generato ha un colore valido", () => {
    for (const recipe of all) {
      for (const part of buildModel(recipe).parts) expect(isHexColor(part.color), `${recipe.id}/${part.name}: ${part.color}`).toBe(true);
    }
  }, 30_000);

  it("i composti colorano i figli: scatola di cartone e uova diverse, vaso e foglie diversi", () => {
    const model = buildModel(getRecipe("lt-uova-confezione-6")!);
    expect(new Set(model.parts.map((p) => p.color))).toEqual(new Set(["#d6c3a2", "#f1dcc0"]));
    const vase = buildModel(getRecipe("er-basilico-vaso")!);
    expect(vase.parts.some((p) => p.color === "#c9663a")).toBe(true);
    expect(vase.parts.some((p) => p.color === "#3f9f4a")).toBe(true);
  });
});

describe("risoluzione di un colore", () => {
  const base: Recipe = { id: "prova", name: "Prova", category: "frutta", archetype: "lathe", heightCm: 8, params: { profile: [[0, 0], [0.5, 0.5], [0, 1]] } };

  it("senza colore specifico vale il predefinito della categoria", () => {
    const r = resolveRecipeColors(base);
    expect(r.source).toBe("default");
    expect(r.colors.main).toBe(CATEGORY_COLORS.frutta.main);
  });

  it("il campo color della ricetta vince sulla tabella", () => {
    const apple = getRecipe("fr-mela-rossa")!;
    const r = resolveRecipeColors({ ...apple, color: { main: "#112233" } });
    expect(r.source).toBe("recipe");
    expect(r.colors.main).toBe("#112233");
    // le parti non indicate restano quelle della tabella
    expect(r.colors.stem).toBe(FOOD_COLORS["fr-mela-rossa"].stem);
  });

  it("una confezione senza colore prende il materiale e l'etichetta della categoria", () => {
    const box: Recipe = { id: "p", name: "P", category: "bevande", archetype: "box", heightCm: 10, params: { size: [1, 2, 1] }, details: { label: { from: 0.2, to: 0.6 } } };
    const { colors } = resolveRecipeColors(box);
    expect(colors.main).toBe("#c9a777");
    expect(colors.label).toBe(CATEGORY_COLORS.bevande.label);
  });

  it("i valori non validi non entrano nei colori risolti", () => {
    const bad = { ...base, color: { main: "rosso" } } as unknown as Recipe;
    const r = resolveRecipeColors(bad);
    expect(r.source).toBe("default");
    expect(isHexColor(r.colors.main)).toBe(true);
  });

  it("fetta: polpa, buccia e semi hanno colori diversi", () => {
    const model = buildModel(getRecipe("fr-anguria-fetta")!);
    const byName = Object.fromEntries(model.parts.map((p) => [p.name, p.color]));
    expect(byName.flesh).toBe("#ee3f4f");
    expect(byName.rind).toBe("#2e8b4a");
    expect(byName.seeds).toBe("#241915");
  });

  it("pesce: occhi scuri e pinne a parte", () => {
    const parts = buildModel(getRecipe("cp-pesce-intero-orata")!).parts;
    expect(parts.find((p) => p.name === "eyes")?.color).toBe("#15171a");
    expect(parts.find((p) => p.name === "fins")?.color).toBe("#8f9ea8");
  });

  it("colorOfPart distingue i nomi dei figli di un composto", () => {
    const colors = resolveRecipeColors(getRecipe("fr-anguria-fetta")!).colors;
    expect(colorOfPart(colors, { role: "body", name: "2:seeds" })).toBe(colors.seed);
  });

  it("mixHex mescola canale per canale", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.7)).toBe("#102030");
  });
});

describe("validazione del campo color", () => {
  const ok = { id: "x", name: "X", category: "frutta", archetype: "bag", heightCm: 5, params: { size: [1, 1, 1] } };

  it("accetta un colore principale con secondari", () => {
    expect(validateRecipe({ ...ok, color: { main: "#aabbcc", label: "#112233" } }).ok).toBe(true);
  });

  it("rifiuta colori malformati, campi sconosciuti e colore principale mancante", () => {
    for (const color of [{ main: "red" }, { main: "#abc" }, { main: "#aabbcc", leaf: 3 }, { main: "#aabbcc", flesh: "#aabbcc" }, { label: "#aabbcc" }, "#aabbcc"]) {
      expect(validateRecipe({ ...ok, color }).ok, JSON.stringify(color)).toBe(false);
    }
  });

  it("la validazione arriva anche ai figli di un composto", () => {
    const composite = { id: "c", name: "C", category: "altro", archetype: "composite", heightCm: 5, params: { parts: [{ recipe: { archetype: "bag", params: { size: [1, 1, 1] }, color: { main: "nope" } } }] } };
    expect(validateRecipe(composite).ok).toBe(false);
  });
});

describe("prodotti senza ricetta", () => {
  it("una confezione generica prende l'etichetta nel colore della categoria", () => {
    const r = recipeForUnknown({ name: "Zzyx", packaging: "bottiglia", category: "bevande" });
    expect(r.source).toBe("packaging");
    expect(resolveRecipeColors(r.recipe).colors.label).toBe(CATEGORY_COLORS.bevande.label);
    const other = recipeForUnknown({ name: "Zzyx", packaging: "bottiglia", category: "condimenti" });
    expect(resolveRecipeColors(other.recipe).colors.label).toBe(CATEGORY_COLORS.condimenti.label);
  });

  it("una forma di alimento prende il colore della categoria", () => {
    const r = recipeForUnknown({ name: "Qwrtz", category: "frutta" });
    expect(r.source).toBe("category");
    expect(resolveRecipeColors(r.recipe).colors.main).toBe(CATEGORY_COLORS.frutta.main);
    const veg = recipeForUnknown({ name: "Qwrtz", category: "verdura" });
    expect(resolveRecipeColors(veg.recipe).colors.main).toBe(CATEGORY_COLORS.verdura.main);
  });

  it("la ricetta resta valida, con lo stesso id e la stessa forma", () => {
    for (const category of CATEGORIES) {
      const r = recipeForUnknown({ name: "Qwrtz", category });
      expect(validateRecipe(r.recipe).ok, category).toBe(true);
      expect(r.recipe.id).toBe(r.baseId);
      expect(buildModel(r.recipe).parts.length).toBeGreaterThan(0);
    }
  });

  it("se il nome somiglia a una ricetta del catalogo, restano i suoi colori", () => {
    const r = recipeForUnknown({ name: "Mele Golden 1 kg", category: "frutta" });
    expect(r.source).toBe("catalog");
    expect(r.recipe.color).toBeUndefined();
    expect(resolveRecipeColors(r.recipe).colors.main).toBe(FOOD_COLORS["fr-mela-golden"].main);
  });

  it("senza categoria non si inventa un colore", () => {
    const r = recipeForUnknown({ name: "Zzyx" });
    expect(r.recipe.color).toBeUndefined();
  });

  it("withCategoryColor non tocca i composti", () => {
    const eggs = getRecipe("lt-uova-confezione-6")!;
    expect(withCategoryColor(eggs, "uova")).toBe(eggs);
  });
});
