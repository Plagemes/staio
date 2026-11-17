import { describe, expect, it } from "vitest";
import { assessProduct, type ProductFacts } from "./index";

const one = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) =>
  assessProduct({ safetyFields: true, ...product }, criteria).outcomes[0];
const TEXT = (ingredientsText: string): ProductFacts => ({ ingredientsText, ingredientsLang: "it" });

describe("«noci» e le miscele di frutta secca", () => {
  it("«noci miste», «mix di noci», «mix di frutta secca» e «noci» rendono incerte le altre voci di frutta a guscio", () => {
    for (const list of ["Zucchero, noci miste, miele", "Zucchero, noci, miele", "Zucchero, mix di noci, miele", "Zucchero, mix di frutta secca, miele"]) {
      expect(one(TEXT(list), { allergens: ["nocciole"] }), list).toMatchObject({ verdict: "uncertain", reason: "group_text" });
    }
  });

  it("con «noci» o «frutta a guscio» dichiarate resta contains", () => {
    expect(one(TEXT("Zucchero, noci, miele"), { allergens: ["noci"] })?.verdict).toBe("contains");
    expect(one(TEXT("Zucchero, noci miste, miele"), { allergens: ["frutta a guscio"] })?.verdict).toBe("contains");
  });
});

describe("frasi sulle tracce lette solo in parte", () => {
  it("«May contain milk and coconut» con cocco dichiarato o escluso: incerto, non «non risulta»", () => {
    const product = TEXT("Riso, sale. May contain milk and coconut.");
    expect(one(product, { allergens: ["cocco"] })).toMatchObject({ verdict: "uncertain", reason: "traces_unreadable" });
    expect(one(product, { excludedFoods: ["cocco"] })).toMatchObject({ verdict: "uncertain", reason: "traces_unreadable" });
    expect(one(product, { allergens: ["latte"] })).toMatchObject({ verdict: "traces" });
  });

  it("una parte non capita lascia il dubbio anche se il resto si legge", () => {
    expect(one(TEXT("Riso. Può contenere tracce di soia e quinoa."), { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "traces_unreadable" });
  });

  it("le parole di contorno non bastano a rendere illeggibile una frase letta bene", () => {
    expect(one(TEXT("Riso. Prodotto in uno stabilimento che utilizza anche arachidi."), { allergens: ["latte"] })).toMatchObject({ verdict: "not_found" });
    expect(one(TEXT("Riso. Nello stabilimento si lavorano anche arachidi."), { allergens: ["latte"] })).toMatchObject({ verdict: "not_found" });
    expect(one(TEXT("Riso. May contain nuts and peanuts."), { allergens: ["latte"] })).toMatchObject({ verdict: "not_found" });
    expect(one(TEXT("Riso. Può contenere tracce di soia."), { allergens: ["latte"] })).toMatchObject({ verdict: "not_found" });
  });
});

describe("«formaggi» e «formaggio»", () => {
  it("«Pasta, formaggi» con parmigiano dichiarato: incerto", () => {
    expect(one(TEXT("Pasta, formaggi"), { allergens: ["parmigiano"] })).toMatchObject({ verdict: "uncertain", reason: "group_text" });
    expect(one(TEXT("Pasta, formaggio, sale"), { excludedFoods: ["parmigiano"] })).toMatchObject({ verdict: "uncertain" });
  });

  it("con latte dichiarato resta contains", () => {
    expect(one(TEXT("Pasta, formaggi"), { allergens: ["latte"] })?.verdict).toBe("contains");
  });
});
