import { describe, expect, it } from "vitest";
import { listRecipes } from "./catalog";
import { FURNITURE_KINDS, furnitureSpec } from "./fridge/furniture";
import { buildModel } from "./generate";
import { hashModel } from "./geometry-hash";
import golden from "./engraving-golden.json";

/**
 * Le impronte vengono dal generatore com'era prima dello stile a colori. Se una cambia, le geometrie
 * (e quindi le incisioni) sono cambiate: va fatto di proposito e rigenerato il file, non per caso.
 */
describe("incisione invariata", () => {
  const expected = golden as Record<string, string>;

  it("ogni ricetta del catalogo produce la stessa geometria di prima", () => {
    const changed: string[] = [];
    for (const recipe of listRecipes()) {
      const now = `${hashModel(buildModel(recipe))}-${hashModel(buildModel(recipe, "alt-seed"))}`;
      if (expected[recipe.id] !== now) changed.push(recipe.id);
    }
    expect(changed).toEqual([]);
  }, 60_000);

  it("i mobili della scena producono la stessa geometria di prima", () => {
    for (const kind of FURNITURE_KINDS) {
      const model = buildModel(furnitureSpec(kind).recipe, "mobile", { normalize: false });
      expect(hashModel(model), kind).toBe(expected[`furniture:${kind}`]);
    }
  });

  it("l'impronta non dipende dai colori", () => {
    const recipe = listRecipes().find((r) => r.id === "fr-mela-rossa")!;
    const recolored = { ...recipe, color: { main: "#123456", stem: "#654321" } };
    expect(hashModel(buildModel(recolored))).toBe(hashModel(buildModel(recipe)));
  });

  it("il file delle impronte copre tutto il catalogo", () => {
    const ids = new Set(listRecipes().map((r) => r.id));
    for (const id of ids) expect(expected[id], id).toBeTypeOf("string");
    for (const key of Object.keys(expected)) {
      if (!key.startsWith("furniture:")) expect(ids.has(key), key).toBe(true);
    }
  });
});
