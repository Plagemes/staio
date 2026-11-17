import { describe, expect, it } from "vitest";
import { buildModel } from "@/models3d/generate";
import { validateRecipe } from "@/models3d/recipe";
import { getRecipe } from "@/models3d/catalog";
import { STAIO_RECIPE } from "./staio-recipe";
import { SHOWCASE_IDS } from "./showcase";

describe("ricette della vetrina", () => {
  it("lo staio è valido e generabile", () => {
    const res = validateRecipe(STAIO_RECIPE);
    expect(res.ok, res.ok ? "" : res.errors.join("; ")).toBe(true);
    expect(buildModel(STAIO_RECIPE).parts.length).toBeGreaterThan(0);
  });

  it("le figure scelte per la vetrina esistono nel catalogo", () => {
    for (const id of SHOWCASE_IDS) expect(getRecipe(id), id).toBeDefined();
  });
});
