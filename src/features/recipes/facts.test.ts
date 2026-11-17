import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import type { FoodComposition } from "@/core/nutrition";
import { buildPriceBook } from "@/core/shopping";
import { lotsOf, recipeOf } from "../prep/test-helpers";
import { computeFacts, costText, coverageText, makeLookup, nutrientLines, priceLookupFrom } from "./facts";
import { proposalFromShortfalls } from "./shopping";

const source = { name: "prova", url: "https://esempio.it" } as unknown as FoodComposition["source"];
const FOODS: FoodComposition[] = [
  {
    id: "pasta-secca",
    name: "Pasta secca",
    aliases: ["spaghetti"],
    group: "cereali",
    basis: "g",
    per100: { energyKcal: 350, proteinG: 12, carbsG: 72, fatG: 1.5 },
    state: "dried",
    source,
  },
  {
    id: "olio-oliva",
    name: "Olio di oliva",
    aliases: ["olio"],
    group: "grassi",
    basis: "g",
    per100: { energyKcal: 880, fatG: 100 },
    densityGPerMl: 0.91,
    source,
  },
];

const recipe = recipeOf("r", {
  servings: 2,
  certainty: "measured",
  ingredients: [
    { name: "Spaghetti", quantity: { value: 200, unit: "g" } },
    { name: "Olio", quantity: { value: 20, unit: "ml" } },
    { name: "Zucchine", quantity: { value: 300, unit: "g" } },
    { name: "Sale" },
  ],
});

describe("nutrienti per porzione", () => {
  const facts = computeFacts(recipe, { lookup: makeLookup(FOODS) });
  const n = facts.nutrition;

  it("somma ciò che si sa e divide per le porzioni", () => {
    // 200 g di pasta (700 kcal) + 20 ml di olio (18,2 g: 160,16 kcal) = 860,16 kcal, su 2 porzioni
    expect(n?.perServing.energyKcal?.value).toBeCloseTo(430.08, 1);
    expect(n?.certainty).toBe("estimated");
  });

  it("dichiara la quota di dato mancante, senza trattarla come zero", () => {
    expect(n?.perServing.energyKcal?.partial).toBe(true);
    expect(n?.perServing.energyKcal?.missingShare).toBeGreaterThan(0);
    const text = coverageText(n!.coverage);
    expect(text).toContain("Mancano i dati di 2 ingredienti su 4");
    expect(text).toContain("zucchine (alimento non riconosciuto)");
    expect(text).toContain("sale (senza quantità)");
    const lines = nutrientLines(n!);
    expect(lines[0]?.prefix).toBe("almeno ");
    expect(lines[0]?.missing).toContain("manca");
  });

  it("l'alimento scelto dall'utente vince sul nome", () => {
    const chosen = recipeOf("c", { servings: 1, ingredients: [{ name: "Zucchine", quantity: { value: 100, unit: "g" }, foodId: "olio-oliva" }] });
    const f = computeFacts(chosen, { lookup: makeLookup(FOODS) });
    expect(f.nutrition?.perServing.energyKcal?.value).toBe(880);
    const gone = recipeOf("g", { servings: 1, ingredients: [{ name: "Olio", quantity: { value: 100, unit: "g" }, foodId: "non-esiste" }] });
    expect(computeFacts(gone, { lookup: makeLookup(FOODS) }).nutrition?.perServing.energyKcal).toBeUndefined();
  });

  it("senza tabella non calcola niente", () => {
    expect(computeFacts(recipe, {}).nutrition).toBeUndefined();
  });
});

describe("costo per porzione", () => {
  const { events } = lotsOf([
    { id: "sp", name: "Spaghetti", value: 500, priceCents: 150 },
    { id: "ol", name: "Olio", value: 1000, unit: "ml", priceCents: 900 },
  ]);
  const book = buildPriceBook(derivePantry(events));

  it("dall'ultimo prezzo osservato, con il minimo dichiarato se mancano prezzi", () => {
    const f = computeFacts(recipe, { book });
    // 200 g a 0,30 €/100 g = 60 c; 20 ml a 0,90 €/100 ml = 18 c; totale 78 c, su 2 porzioni
    expect(f.cost?.totalCents).toBe(78);
    expect(f.cost?.perServingCents).toBe(39);
    expect(f.cost?.partial).toBe(true);
    expect(costText(f.cost!)).toEqual({ prefix: "almeno ", text: expect.stringContaining("0,39") });
    expect(coverageText(f.cost!.coverage, "prezzi")).toContain("prezzi");
  });

  it("un ingrediente senza acquisti non ha prezzo", () => {
    const f = priceLookupFrom(book)({ name: "Zucchine", quantity: { value: 100, unit: "g" } }, 0);
    expect(f).toBeNull();
  });
});

describe("lista della spesa", () => {
  it("ogni voce mancante entra in lista; senza quantità («q.b.») entra senza quantità, non viene saltata", () => {
    const p = proposalFromShortfalls([
      { name: "Farina", quantity: { value: 0.5, unit: "kg" } },
      { name: "Sale" },
    ]);
    expect(p.entries).toEqual([{ product: "Farina", quantity: { value: 0.5, unit: "kg" } }, { product: "Sale" }]);
    expect(p.withoutQuantity).toEqual([]);
  });
});
