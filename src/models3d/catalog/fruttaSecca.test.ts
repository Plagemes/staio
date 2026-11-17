import { describe, expect, it } from "vitest";
import { fruttaSeccaRecipes } from "./fruttaSecca";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("fruttaSeccaRecipes", () => {
  it("ha id unici, con prefisso fs-, diversi da quelli di seed", () => {
    const ids = fruttaSeccaRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seed = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("fs-")).toBe(true);
      expect(seed.has(id)).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of fruttaSeccaRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of fruttaSeccaRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const { min, max } = modelBounds(model);
      for (const v of [...min, ...max]) expect(Number.isFinite(v), r.id).toBe(true);
    }
  });
});
