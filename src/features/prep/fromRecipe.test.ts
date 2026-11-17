import { describe, expect, it } from "vitest";
import { picksFromProposal, proposeFromRecipe, unmatchedText } from "./fromRecipe";
import { lotsOf, recipeOf } from "./test-helpers";

const recipe = recipeOf("r1", {
  servings: 4,
  ingredients: [
    { name: "Spaghetti", quantity: { value: 320, unit: "g" } },
    { name: "Passata di pomodoro", quantity: { value: 400, unit: "ml" } },
    { name: "Basilico", quantity: { value: 10, unit: "g" } },
    { name: "Sale", note: "q.b." },
  ],
});

describe("proposeFromRecipe", () => {
  it("propone i lotti che corrispondono, con le quantità per le porzioni scelte", () => {
    const { lots } = lotsOf([
      { id: "L1", name: "Spaghetti", value: 500 },
      { id: "L2", name: "Passata di pomodoro", value: 700, unit: "ml" },
    ]);
    const p = proposeFromRecipe(recipe, lots, { servings: 2 });
    expect(p.picks).toEqual([
      { lotId: "L1", ingredientIndex: 0, ingredientName: "Spaghetti", quantity: { value: 160, unit: "g" } },
      { lotId: "L2", ingredientIndex: 1, ingredientName: "Passata di pomodoro", quantity: { value: 200, unit: "ml" } },
    ]);
    expect(p.unmatched.map((u) => [u.name, u.reason])).toEqual([
      ["Basilico", "no_stock"],
      ["Sale", "no_quantity"],
    ]);
  });

  it("usa prima il lotto che viene per primo nell'ordine dato e passa al successivo quando finisce", () => {
    const { lots } = lotsOf([
      { id: "A", name: "Spaghetti", value: 100 },
      { id: "B", name: "Spaghetti", value: 500 },
    ]);
    const p = proposeFromRecipe(recipe, lots);
    const spaghetti = p.picks.filter((x) => x.ingredientIndex === 0);
    expect(spaghetti.map((x) => [x.lotId, x.quantity.value])).toEqual([
      ["A", 100],
      ["B", 220],
    ]);
  });

  it("dichiara ciò che non basta e non supera mai ciò che resta", () => {
    const { lots } = lotsOf([{ id: "A", name: "Spaghetti", value: 200 }]);
    const p = proposeFromRecipe(recipe, lots);
    expect(p.picks[0]?.quantity.value).toBe(200);
    const short = p.unmatched.find((u) => u.name === "Spaghetti");
    expect(short?.reason).toBe("short");
    expect(short?.shortfall?.value).toBe(120);
  });

  it("non propone due volte lo stesso lotto oltre ciò che resta", () => {
    const twice = recipeOf("r2", {
      servings: 1,
      ingredients: [
        { name: "Olio", quantity: { value: 30, unit: "ml" } },
        { name: "Olio extravergine", quantity: { value: 30, unit: "ml" } },
      ],
    });
    const { lots } = lotsOf([{ id: "O", name: "Olio extravergine", value: 40, unit: "ml" }]);
    const p = proposeFromRecipe(twice, lots);
    const total = p.picks.reduce((s, x) => s + x.quantity.value, 0);
    expect(total).toBeLessThanOrEqual(40);
  });

  it("segnala l'unità che non si converte senza inventare un peso", () => {
    const eggs = recipeOf("r3", { servings: 2, ingredients: [{ name: "Uova", quantity: { value: 2, unit: "pz" } }] });
    const { lots } = lotsOf([{ id: "U", name: "Uova", value: 300 }]);
    const p = proposeFromRecipe(eggs, lots);
    expect(p.picks).toEqual([]);
    expect(p.unmatched[0]?.reason).toBe("unit");
  });

  it("con il peso del pezzo converte i pezzi in grammi", () => {
    const eggs = recipeOf("r3", { servings: 2, ingredients: [{ name: "Uova", quantity: { value: 2, unit: "pz" } }] });
    const { lots } = lotsOf([{ id: "U", name: "Uova", value: 300 }]);
    const p = proposeFromRecipe(eggs, lots, { contextFor: () => ({ unitWeight: 60 }) });
    expect(p.picks[0]?.quantity).toEqual({ value: 120, unit: "g" });
  });

  it("ignora i lotti finiti", () => {
    const { lots } = lotsOf([{ id: "A", name: "Spaghetti", value: 0.0001 }]);
    const finished = lots.map((l) => ({ ...l, status: "finished" as const, remaining: 0 }));
    expect(proposeFromRecipe(recipe, finished).picks).toEqual([]);
  });
});

describe("picksFromProposal e unmatchedText", () => {
  it("somma le quantità dello stesso lotto in una riga di testo", () => {
    const text = picksFromProposal({
      picks: [
        { lotId: "L", ingredientIndex: 0, ingredientName: "a", quantity: { value: 100, unit: "g" } },
        { lotId: "L", ingredientIndex: 1, ingredientName: "b", quantity: { value: 50, unit: "g" } },
      ],
      unmatched: [],
    });
    expect(text).toEqual([{ lotId: "L", quantityText: "150 g" }]);
  });

  it("spiega ogni motivo", () => {
    expect(unmatchedText({ index: 0, name: "Basilico", reason: "no_stock" })).toBe("basilico: non è in dispensa");
    expect(unmatchedText({ index: 0, name: "Farina", reason: "short", shortfall: { value: 120, unit: "g" } })).toContain("mancano 120 g");
    expect(unmatchedText({ index: 0, name: "Sale", reason: "no_quantity" })).toContain("senza quantità");
  });
});
