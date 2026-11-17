import { describe, expect, it } from "vitest";
import { fornoRecipes } from "./forno";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("fornoRecipes", () => {
  it("hanno id unici, col prefisso fo- e diversi da quelli di seed", () => {
    const ids = fornoRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seedIds = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("fo-"), id).toBe(true);
      expect(seedIds.has(id), id).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of fornoRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of fornoRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const b = modelBounds(model);
      for (const v of [...b.min, ...b.max]) expect(Number.isFinite(v), r.id).toBe(true);
    }
  });
});
