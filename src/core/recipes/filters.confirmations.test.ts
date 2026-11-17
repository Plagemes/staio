import { describe, expect, it } from "vitest";
import { confirmIngredient, deriveConfirmations, type ItemSubject } from "../allergens";
import { confirmedIngredients, exclusionReasons, filterRecipes, type Filterable } from "./filters";

const ing = (name: string, extra: object = {}) => ({ name, ...extra });
const recipeOf = (title: string, ingredients: ReturnType<typeof ing>[]): Filterable => ({ title, ingredients });

const ham: ItemSubject = { name: "Prosciutto cotto" };
const confirmOf = (item: ItemSubject, allergens: string[], excludedFoods: string[] = []) => {
  const r = confirmIngredient(item, { allergens, excludedFoods }, { deviceId: "A", now: () => "2026-11-05T09:00:00.000Z", idGenerator: () => `c-${item.name}` });
  if (!r.ok) throw new Error(r.reason);
  return deriveConfirmations([r.event]).byKey;
};

describe("filtri del ricettario con le conferme", () => {
  const toast = recipeOf("Toast", [ing("Riso"), ing("Prosciutto cotto")]);

  it("senza conferma una ricetta con un ingrediente non verificabile è esclusa", () => {
    expect(exclusionReasons(toast, { allergens: ["glutine"] }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
  });

  it("con la conferma passa, e `confirmedIngredients` dice quale ingrediente e quando", () => {
    const confirmations = confirmOf(ham, ["glutine"]);
    expect(exclusionReasons(toast, { allergens: ["glutine"], confirmations })).toEqual([]);
    const hits = confirmedIngredients(toast, { allergens: ["glutine"], confirmations });
    expect(hits).toEqual([expect.objectContaining({ name: "Prosciutto cotto", allergen: "glutine", confirmedAt: "2026-11-05T09:00:00.000Z" })]);
    expect(filterRecipes([toast], { allergens: ["glutine"], confirmations }).kept).toHaveLength(1);
  });

  it("la conferma non nasconde un altro ingrediente incerto né uno che contiene", () => {
    const confirmations = confirmOf(ham, ["glutine"]);
    const withSauce = recipeOf("Toast con salsa", [ing("Prosciutto cotto"), ing("Salsa")]);
    expect(exclusionReasons(withSauce, { allergens: ["glutine"], confirmations }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
    const withFlour = recipeOf("Toast con farina", [ing("Prosciutto cotto"), ing("Farina 00")]);
    expect(exclusionReasons(withFlour, { allergens: ["glutine"], confirmations }).map((r) => r.code)).toEqual(["allergen"]);
  });

  it("nomi simili e allergeni nuovi non sono coperti", () => {
    const confirmations = confirmOf(ham, ["glutine"]);
    const crudo = recipeOf("Con crudo", [ing("Prosciutto crudo")]);
    expect(exclusionReasons(crudo, { allergens: ["glutine"], confirmations }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
    expect(exclusionReasons(toast, { allergens: ["glutine", "uova"], confirmations }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
  });

  it("un ingrediente collegato a un altro prodotto o codice a barre non è coperto", () => {
    const linked: ItemSubject = { name: "Prosciutto cotto", linkedNames: ["Prosciutto Alfa"], productRefs: ["800111"] };
    const confirmations = confirmOf(linked, ["glutine"]);
    const link = (refs: string[], names: string[]) => (i: { name: string }) => (i.name === "Prosciutto cotto" ? { names, productRefs: refs } : undefined);
    expect(exclusionReasons(toast, { allergens: ["glutine"], confirmations, linkOf: link(["800111"], ["Prosciutto Alfa"]) })).toEqual([]);
    expect(exclusionReasons(toast, { allergens: ["glutine"], confirmations, linkOf: link(["800222"], ["Prosciutto Alfa"]) }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
    expect(exclusionReasons(toast, { allergens: ["glutine"], confirmations }).map((r) => r.code)).toEqual(["allergen_uncertain"]);
  });

  it("senza conferme `confirmedIngredients` è vuoto", () => {
    expect(confirmedIngredients(toast, { allergens: ["glutine"] })).toEqual([]);
    expect(confirmedIngredients(toast, { confirmations: confirmOf(ham, ["glutine"]) })).toEqual([]);
  });
});
