import { describe, expect, it } from "vitest";
import { NOW, lotsOf, recipeOf } from "../prep/test-helpers";
import { makeLinkOf, pantryFoods } from "./allergenLinks";
import { NO_FILTERS, applyFilters, buildRows, hiddenText, pantryView } from "./list";
import { clearText, recipeSafety } from "./safety";

const lasagne = recipeOf("las", {
  title: "Lasagne",
  ingredients: [{ name: "Sfoglie", quantity: { value: 200, unit: "g" } }, { name: "Besciamella", quantity: { value: 300, unit: "g" } }],
  steps: [{ text: "Inforna." }],
});
const insalata = recipeOf("ins", {
  title: "Insalata",
  ingredients: [{ name: "Lattuga", quantity: { value: 200, unit: "g" } }, { name: "Crema", quantity: { value: 50, unit: "g" } }],
  steps: [{ text: "Condisci." }],
});
const pane = recipeOf("pan", {
  title: "Mele al forno",
  ingredients: [{ name: "Mele", quantity: { value: 400, unit: "g" } }],
  steps: [{ text: "Inforna." }],
});

describe("recipeSafety", () => {
  it("dice che cosa contiene, con l'ingrediente", () => {
    const s = recipeSafety(lasagne, { allergens: ["latte"], excludedFoods: [] });
    expect(s.verdict).toBe("contains");
    expect(s.contains.join(" ")).toContain("«Besciamella»");
  });

  it("un ingrediente generico è non verificabile, mai compatibile", () => {
    const s = recipeSafety(insalata, { allergens: ["glutine"], excludedFoods: [] });
    expect(s.verdict).toBe("uncertain");
    expect(s.uncertain.join(" ")).toContain("«Crema»");
  });

  it("senza corrispondenze non scrive «sicura»", () => {
    const s = recipeSafety(pane, { allergens: ["latte"], excludedFoods: ["olive"] });
    expect(s.verdict).toBe("clear");
    const text = clearText({ allergens: ["latte"], excludedFoods: ["olive"] });
    expect(text).toContain("Nessuna corrispondenza trovata");
    expect(text).toContain("Non vuol dire che sia sicura");
  });

  it("legge il nome dell'alimento di dispensa collegato", () => {
    const { lots } = lotsOf([{ id: "c", name: "Crema di arachidi", value: 200 }]);
    const linkOf = makeLinkOf(pantryFoods(lots, new Map()));
    const s = recipeSafety(insalata, { allergens: ["arachidi"], excludedFoods: [], linkOf });
    expect(s.verdict).toBe("contains");
    expect(s.contains.join(" ")).toContain("in dispensa hai «Crema di arachidi»");
  });

  it("legge gli allergeni in etichetta del prodotto collegato", () => {
    const linkOf = makeLinkOf([{ name: "Lattuga", productName: "Insalata mista", allergens: ["en:milk"] }]);
    const s = recipeSafety(insalata, { allergens: ["latte"], excludedFoods: [], linkOf });
    expect(s.verdict).toBe("contains");
    expect(s.contains.join(" ")).toContain("etichetta");
  });
});

describe("applyFilters e le ricette nascoste", () => {
  const view = pantryView([], NOW);
  const rows = buildRows([lasagne, insalata, pane], view);
  const outcome = applyFilters(rows, { ...NO_FILTERS, allergens: ["glutine", "latte"] });

  it("separa le ricette con un allergene da quelle non verificabili", () => {
    expect(outcome.rows.map((r) => r.recipe.recipeId)).toEqual(["pan"]);
    expect(outcome.hiddenContains.map((h) => h.row.recipe.recipeId)).toEqual(["las"]);
    expect(outcome.hiddenUncertain.map((h) => h.row.recipe.recipeId)).toEqual(["ins"]);
    expect(outcome.hidden).toBe(2);
  });

  it("racconta il perché", () => {
    expect(hiddenText(outcome)).toBe("2 nascoste: 1 con un allergene o un alimento escluso, 1 non verificabile");
  });
});

describe("ingredientFlags", () => {
  it("segna l'ingrediente responsabile, con testi che reggono anche per ingredienti sconosciuti", async () => {
    const { ingredientFlags } = await import("./safety");
    const f = ingredientFlags(lasagne, { allergens: ["latte"], excludedFoods: [] });
    expect(f.get(1)?.verdict).toBe("contains");
    const g = ingredientFlags(insalata, { allergens: ["glutine"], excludedFoods: [] });
    expect(g.get(1)).toEqual({ verdict: "uncertain", text: "ingrediente generico o composto: controlla l'etichetta" });
    expect(recipeSafety(insalata, { allergens: ["glutine"], excludedFoods: [] }).uncertain[0]).toBe(
      "«Crema» è un ingrediente generico o composto: potrebbe contenere glutine. Controlla l'etichetta.",
    );
  });
});

describe("più ingredienti incerti", () => {
  it("una riga per motivo, non una per ingrediente", () => {
    const r = recipeOf("multi", {
      title: "Piatto",
      ingredients: ["Crema", "Salsa", "Ripieno", "Farcia", "Condimento", "Zorbix"].map((name) => ({ name, quantity: { value: 10, unit: "g" as const } })),
      steps: [{ text: "Mescola." }],
    });
    const s = recipeSafety(r, { allergens: ["glutine", "latte"], excludedFoods: [] });
    expect(s.verdict).toBe("uncertain");
    expect(s.uncertain.length).toBeLessThanOrEqual(3);
    expect(s.uncertain.join(" ")).toContain("e altri");
  });
});
