import { describe, expect, it } from "vitest";
import { recipeOf } from "../prep/test-helpers";
import { blockedStillNote, confirmButtonText, coverageText, recipeSafety } from "./safety";

describe("il pulsante di conferma dice che cosa copre", () => {
  it("elenca gli allergeni dichiarati, senza doppioni, in italiano", () => {
    expect(coverageText(["latte"])).toBe("latte");
    expect(coverageText(["latte", "uova"])).toBe("latte e uova");
    expect(coverageText(["Lattosio", "uova", "glutine"])).toBe("latte, uova e glutine");
  });

  it("con più nomi dello stesso allergene non si ripete", () => {
    expect(coverageText(["latte", "lattosio"])).toBe("latte");
  });

  it("il testo del pulsante nomina l'ingrediente e gli allergeni", () => {
    expect(confirmButtonText("Prosciutto cotto", ["latte", "uova"])).toBe("Ho letto l'etichetta di «Prosciutto cotto»: va bene per latte e uova");
  });
});

describe("ricetta che contiene già qualcosa", () => {
  const r = recipeOf("mista", {
    title: "Mista",
    ingredients: [
      { name: "Besciamella", quantity: { value: 100, unit: "g" } },
      { name: "Prosciutto cotto", quantity: { value: 50, unit: "g" } },
    ],
    steps: [{ text: "Inforna." }],
  });

  it("le conferme degli altri ingredienti non la sbloccano: il pannello ha una nota che lo dice", () => {
    const s = recipeSafety(r, { allergens: ["latte", "lupini"], excludedFoods: [] });
    expect(s.verdict).toBe("contains");
    expect(s.doubts.map((d) => d.name)).toContain("Prosciutto cotto");
    expect(blockedStillNote()).toContain("resta bloccata");
    expect(blockedStillNote()).toContain("contiene qualcosa che hai dichiarato");
  });
});

describe("testo con alfabeti mescolati", () => {
  const name = `l\u0430tte`; // «а» cirillica
  const r = recipeOf("mix", {
    title: "Mix",
    ingredients: [{ name, quantity: { value: 100, unit: "g" } }],
    steps: [{ text: "Scalda." }],
  });

  it("non è confermabile e il testo dice di riscriverlo", () => {
    const s = recipeSafety(r, { allergens: ["glutine"], excludedFoods: [] });
    expect(s.verdict).toBe("uncertain");
    expect(s.doubts).toEqual([]);
    expect(s.uncertain.join(" ")).toContain("riscrivere");
  });
});
