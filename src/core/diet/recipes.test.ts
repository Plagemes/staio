import { describe, expect, it } from "vitest";
import { FOODS } from "../nutrition/data/foods";
import { createClassifier } from "./classify";
import { MIN_SHARE_OF_PORTION, recipeDietFacts, servingsOfQuantity } from "./recipes";
import { PORTION_KEYS, type PortionKey, type PortionStandard, type PortionTable } from "./types";

const AMOUNTS: Partial<Record<PortionKey, [number, "g" | "ml"]>> = {
  vegetables: [200, "g"],
  legumes: [150, "g"],
  legumesDry: [50, "g"],
  grains: [80, "g"],
  oil: [10, "ml"],
  cheeseAged: [50, "g"],
  eggs: [50, "g"],
  fish: [150, "g"],
};

/** Tabella finta: i valori veri sono di `data/guidelines.ts`. */
const FAKE_PORTIONS: PortionTable = Object.fromEntries(
  PORTION_KEYS.map((key): [PortionKey, PortionStandard] => {
    const [amount, unit] = AMOUNTS[key] ?? [100, "g"];
    return [key, { key, amount, unit, basis: "raw", source: "app", where: "test" }];
  }),
) as PortionTable;

const classifier = createClassifier({
  foods: new Map(FOODS.map((f) => [f.id, f])),
  products: new Map(),
  lotOfConsume: () => undefined,
  lots: new Map(),
  preps: new Map(),
  overrides: {},
});

describe("porzioni di una quantità", () => {
  it("massa e volume nella loro unità; tra i due 1 g = 1 ml come stima; un pezzo è una porzione", () => {
    expect(servingsOfQuantity({ value: 160, unit: "g" }, { portionKey: "grains" }, FAKE_PORTIONS)).toEqual({ servings: 2, certainty: "label" });
    expect(servingsOfQuantity({ value: 2, unit: "cucchiaio" }, { portionKey: "oil" }, FAKE_PORTIONS)).toEqual({ servings: 3, certainty: "label" });
    expect(servingsOfQuantity({ value: 1, unit: "hg" }, { portionKey: "oil" }, FAKE_PORTIONS)).toEqual({ servings: 10, certainty: "estimated" });
    expect(servingsOfQuantity({ value: 2, unit: "pz" }, { portionKey: "eggs" }, FAKE_PORTIONS)).toEqual({ servings: 2, certainty: "estimated" });
    expect(servingsOfQuantity({ value: 1, unit: "pizzico" }, { portionKey: "grains" }, FAKE_PORTIONS)).toBeUndefined();
    expect(servingsOfQuantity({ value: 10, unit: "g" }, {}, FAKE_PORTIONS)).toBeUndefined();
  });
});

describe("ricette", () => {
  it("conta i gruppi sopra la soglia per porzione; q.b. e piccole quantità non portano il gruppo", () => {
    expect(MIN_SHARE_OF_PORTION).toBe(0.5);
    const facts = recipeDietFacts(
      {
        recipeId: "r1",
        servings: 4,
        ingredients: [
          { name: "Pasta", quantity: { value: 320, unit: "g" } },
          { name: "Lenticchie secche", quantity: { value: 200, unit: "g" } },
          { name: "Olio extravergine", quantity: { value: 2, unit: "cucchiaio" } },
          { name: "Parmigiano", quantity: { value: 40, unit: "g" } },
          { name: "Sale" },
          { name: "Prezzemolo", foodId: "" },
          { name: "Ingrediente ignoto", quantity: { value: 500, unit: "g" } },
        ],
      },
      classifier,
      FAKE_PORTIONS,
    );
    expect(facts.recipeId).toBe("r1");
    expect(facts.groups).toEqual(["legumes", "refinedGrains", "oilsFats"]);
    expect(facts.servingsByGroup).toEqual({ legumes: 1, refinedGrains: 1, oilsFats: 0.75 });
    expect(facts.certainty).toBe("estimated");
  });

  it("l'id della tabella decide il gruppo; servings non valido vale 1", () => {
    const facts = recipeDietFacts(
      { recipeId: "r2", servings: 0, ingredients: [{ name: "Fagioli", foodId: "ceci-secchi", quantity: { value: 50, unit: "g" } }] },
      classifier,
      FAKE_PORTIONS,
    );
    expect(facts.groups).toEqual(["legumes"]);
    expect(facts.servingsByGroup.legumes).toBe(1);
    expect(facts.certainty).toBe("label");
  });

  it("nessun gruppo: certezza stimata e liste vuote", () => {
    const facts = recipeDietFacts({ recipeId: "r3", servings: 2, ingredients: [] }, classifier, FAKE_PORTIONS);
    expect(facts).toEqual({ recipeId: "r3", groups: [], servingsByGroup: {}, certainty: "estimated" });
  });
});
