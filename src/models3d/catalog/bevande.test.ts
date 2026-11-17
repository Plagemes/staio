import { describe, expect, it } from "vitest";
import { bevandeRecipes } from "./bevande";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("bevandeRecipes", () => {
  it("hanno id unici, col prefisso bv- e diversi da quelli di seed", () => {
    const ids = bevandeRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seedIds = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("bv-"), id).toBe(true);
      expect(seedIds.has(id), id).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of bevandeRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of bevandeRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const b = modelBounds(model);
      for (const v of [...b.min, ...b.max]) expect(Number.isFinite(v), r.id).toBe(true);
    }
  });
});
