import { describe, expect, it } from "vitest";
import { fruttaRecipes } from "./frutta";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("fruttaRecipes", () => {
  it("ha id unici, con prefisso fr-, diversi da quelli di seed", () => {
    const ids = fruttaRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seed = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("fr-")).toBe(true);
      expect(seed.has(id)).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of fruttaRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of fruttaRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const { min, max } = modelBounds(model);
      for (const v of [...min, ...max]) expect(Number.isFinite(v), r.id).toBe(true);
    }
  });
});
