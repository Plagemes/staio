import { describe, expect, it } from "vitest";
import { buildModel, modelBounds } from "../generate";
import { validateRecipe } from "../recipe";
import { SEED_RECIPES } from "./seed";
import { erbeRecipes } from "./erbe";

describe("erbe", () => {
  it("ha il numero atteso di ricette", () => {
    expect(erbeRecipes.length).toBeGreaterThanOrEqual(12);
  });

  it("ha id unici, col prefisso, diversi da quelli di seed", () => {
    const ids = erbeRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seedIds = new Set(SEED_RECIPES.map((r) => r.id));
    for (const id of ids) {
      expect(id.startsWith("er-"), id).toBe(true);
      expect(seedIds.has(id), id).toBe(false);
    }
  });

  it("sono tutte valide", () => {
    for (const r of erbeRecipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of erbeRecipes) {
      const model = buildModel(r);
      expect(model.parts.length, r.id).toBeGreaterThan(0);
      const b = modelBounds(model);
      for (const v of [...b.min, ...b.max, ...model.size]) expect(Number.isFinite(v), r.id).toBe(true);
      expect(model.size.every((s) => s > 0), r.id).toBe(true);
    }
  });
});
