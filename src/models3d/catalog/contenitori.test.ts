import { describe, expect, it } from "vitest";
import { contenitoriRecipes } from "./contenitori";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("contenitoriRecipes", () => {
  it("hanno id unici, col prefisso ct- e diversi da quelli di seed", () => {
    const ids = contenitoriRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seedIds = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("ct-"), id).toBe(true);
      expect(seedIds.has(id), id).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of contenitoriRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of contenitoriRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const b = modelBounds(model);
      for (const v of [...b.min, ...b.max]) expect(Number.isFinite(v), r.id).toBe(true);
    }
  });
});
