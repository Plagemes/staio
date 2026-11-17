import { describe, expect, it } from "vitest";
import { latticiniRecipes as recipes } from "./latticini";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel, modelBounds } from "../generate";

describe("ricette di latticini e uova", () => {
  it("hanno id unici, con prefisso lt- e diversi da quelli del seme", () => {
    const ids = recipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => i.startsWith("lt-"))).toBe(true);
    const seed = new Set(SEED_RECIPES.map((r) => r.id));
    expect(ids.filter((i) => seed.has(i))).toEqual([]);
  });

  it("sono tutte valide", () => {
    for (const r of recipes) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("si generano con geometria non vuota e scatola finita", () => {
    for (const r of recipes) {
      const m = buildModel(r);
      expect(m.parts.length, r.id).toBeGreaterThan(0);
      const b = modelBounds(m);
      expect([...b.min, ...b.max].every(Number.isFinite), r.id).toBe(true);
    }
  });
});
