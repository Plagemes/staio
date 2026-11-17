import { describe, expect, it } from "vitest";
import { getRecipe, listCategories, listRecipes, registerRecipes, searchRecipes } from "./index";
import { SEED_RECIPES } from "./seed";
import { validateRecipe } from "../recipe";
import { buildModel } from "../generate";

describe("ricette di partenza", () => {
  it("sono 14 con id unici", () => {
    expect(SEED_RECIPES).toHaveLength(14);
    expect(new Set(SEED_RECIPES.map((r) => r.id)).size).toBe(14);
  });

  it("sono tutte valide", () => {
    for (const r of SEED_RECIPES) {
      const res = validateRecipe(r);
      expect(res.ok, `${r.id}: ${res.ok ? "" : res.errors.join("; ")}`).toBe(true);
    }
  });

  it("sono tutte generabili", () => {
    for (const r of SEED_RECIPES) expect(buildModel(r).parts.length).toBeGreaterThan(0);
  });
});

describe("registro", () => {
  it("contiene le ricette di partenza", () => {
    for (const r of SEED_RECIPES) expect(getRecipe(r.id)?.id).toBe(r.id);
    expect(getRecipe("pera")?.name).toBe("Pera");
    expect(getRecipe("inesistente")).toBeUndefined();
  });

  it("contiene il catalogo completo, tutto generabile", () => {
    const all = listRecipes();
    expect(all.length).toBeGreaterThanOrEqual(250);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    for (const r of all) expect(buildModel(r).parts.length, r.id).toBeGreaterThan(0);
  });

  it("rifiuta duplicati e ricette malformate", () => {
    expect(() => registerRecipes([SEED_RECIPES[0]])).toThrow(/già registrata/);
    expect(() => registerRecipes([{ ...SEED_RECIPES[0], id: "Brutto Id" }])).toThrow(/non valida/);
  });

  it("cerca per nome ignorando accenti e maiuscole", () => {
    expect(searchRecipes("PERA").map((r) => r.id)).toContain("pera");
    expect(searchRecipes("grappolo").map((r) => r.id)).toContain("grappolo-uva");
    expect(searchRecipes("uva").map((r) => r.id)).toContain("grappolo-uva");
    expect(searchRecipes("zzz")).toEqual([]);
  });

  it("mette prima i nomi che iniziano con la ricerca", () => {
    const results = searchRecipes("p");
    const ids = results.map((r) => r.id);
    const startsWithP = results.map((r) => r.name.toLowerCase().startsWith("p"));
    expect(startsWithP[0]).toBe(true);
    expect(startsWithP.lastIndexOf(true)).toBeLessThan(startsWithP.indexOf(false));
    expect(ids.indexOf("spicchio-parmigiano")).toBeGreaterThan(ids.indexOf("pera"));
    expect(searchRecipes("yog").map((r) => r.id)).toContain("vasetto-yogurt");
  });

  it("filtra per categoria", () => {
    const frutta = searchRecipes("", "frutta");
    expect(frutta.length).toBeGreaterThanOrEqual(4);
    expect(frutta.every((r) => r.category === "frutta")).toBe(true);
    expect(searchRecipes("pasta", "frutta")).toEqual([]);
  });

  it("elenca le categorie usate", () => {
    expect(listCategories()).toContain("formaggi");
    expect(listCategories()).not.toContain("surgelati");
  });
});
