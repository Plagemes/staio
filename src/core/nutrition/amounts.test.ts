import { describe, expect, it } from "vitest";
import {
  combineCertainty,
  nutrientsOfQuantity,
  sumNutrients,
  type ResolvedComposition,
} from "./amounts";
import { compositionFromFood } from "./resolve";
import { FAKE_FOODS, FAKE_PRODUCT } from "./test-helpers";
import { compositionFromProduct } from "./resolve";

const food = (id: string): ResolvedComposition => {
  const f = FAKE_FOODS.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return compositionFromFood(f);
};

describe("nutrientsOfQuantity", () => {
  it("scala in grammi", () => {
    const r = nutrientsOfQuantity(food("pollo-petto-crudo"), { value: 150, unit: "g" }, "measured");
    expect(r.ok && r.value.nutrients).toEqual({ energyKcal: 150, proteinG: 30, fatG: 3 });
    expect(r.ok && r.value.amount).toBe(150);
  });

  it("scala in millilitri", () => {
    const r = nutrientsOfQuantity(food("latte-intero"), { value: 200, unit: "ml" }, "measured");
    expect(r.ok && r.value.nutrients.energyKcal).toBe(120);
  });

  it("converte pezzi con il peso del pezzo", () => {
    const r = nutrientsOfQuantity(food("uovo"), { value: 2, unit: "pz" }, "estimated");
    expect(r.ok && r.value.nutrients.energyKcal).toBe(168);
    expect(r.ok && r.value.amount).toBe(120);
  });

  it("converte tra massa e volume con la densità", () => {
    const milk = nutrientsOfQuantity(food("latte-intero"), { value: 103, unit: "g" }, "measured");
    expect(milk.ok && milk.value.nutrients.energyKcal).toBeCloseTo(60);
    const oil = nutrientsOfQuantity(food("olio"), { value: 10, unit: "ml" }, "measured");
    expect(oil.ok && oil.value.nutrients.energyKcal).toBe(81);
  });

  it("pezzi di un alimento a volume: servono peso del pezzo e densità", () => {
    const r = nutrientsOfQuantity(food("latte-intero"), { value: 1, unit: "pz" }, "measured");
    expect(r).toMatchObject({ ok: false, reason: "missing_unit_weight" });
    const withWeight = { ...food("latte-intero"), unitWeightG: 100, densityGPerMl: undefined };
    expect(nutrientsOfQuantity(withWeight, { value: 1, unit: "pz" }, "measured")).toMatchObject({
      ok: false,
      reason: "missing_density",
    });
  });

  it("senza i dati di conversione è non calcolabile, con il motivo", () => {
    expect(nutrientsOfQuantity(food("pollo-petto-crudo"), { value: 1, unit: "pz" }, "measured")).toMatchObject({
      ok: false,
      reason: "missing_unit_weight",
    });
    expect(nutrientsOfQuantity(food("pollo-petto-crudo"), { value: 100, unit: "ml" }, "measured")).toMatchObject({
      ok: false,
      reason: "missing_density",
    });
  });

  it("rifiuta quantità non valide e composizioni con dati non validi", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nutrientsOfQuantity(food("mela"), { value, unit: "g" }, "measured")).toMatchObject({
        ok: false,
        reason: "invalid_quantity",
      });
    }
    const bad = { ...food("pollo-petto-crudo"), densityGPerMl: -1 };
    expect(nutrientsOfQuantity(bad, { value: 10, unit: "ml" }, "measured")).toMatchObject({
      ok: false,
      reason: "invalid_composition",
    });
  });

  it("lascia assenti i nutrienti assenti: mai zero", () => {
    const r = nutrientsOfQuantity(food("uovo"), { value: 100, unit: "g" }, "measured");
    expect(r.ok && "carbsG" in r.value.nutrients).toBe(false);
  });

  it("la quantità zero dà zero per i nutrienti noti", () => {
    const r = nutrientsOfQuantity(food("mela"), { value: 0, unit: "g" }, "measured");
    expect(r.ok && r.value.nutrients.energyKcal).toBe(0);
  });
});

describe("certezza", () => {
  it("è la peggiore tra quantità e origine", () => {
    expect(combineCertainty("measured", "table")).toBe("estimated");
    expect(combineCertainty("measured", "label")).toBe("label");
    expect(combineCertainty("label", "label")).toBe("label");
    expect(combineCertainty("estimated", "label")).toBe("estimated");
    expect(combineCertainty("measured", "derived")).toBe("estimated");
  });

  it("vale nel risultato: etichetta pesata = label, tabella pesata = estimated", () => {
    const product = compositionFromProduct(FAKE_PRODUCT);
    if (!product) throw new Error("prodotto");
    const label = nutrientsOfQuantity(product, { value: 100, unit: "g" }, "measured");
    expect(label.ok && label.value.certainty).toBe("label");
    const table = nutrientsOfQuantity(food("mela"), { value: 100, unit: "g" }, "measured");
    expect(table.ok && table.value.certainty).toBe("estimated");
    const guess = nutrientsOfQuantity(product, { value: 100, unit: "g" }, "estimated");
    expect(guess.ok && guess.value.certainty).toBe("estimated");
  });
});

describe("sumNutrients", () => {
  it("somma quando tutti hanno il dato", () => {
    const s = sumNutrients([
      { nutrients: { energyKcal: 100 }, certainty: "measured", weight: 100 },
      { nutrients: { energyKcal: 50 }, certainty: "measured", weight: 50 },
    ]);
    expect(s.totals.energyKcal).toMatchObject({ value: 150, partial: false, missingShare: 0 });
  });

  it("un nutriente assente in un addendo rende parziale il totale, con la quota mancante sul peso", () => {
    const s = sumNutrients([
      { nutrients: { energyKcal: 100, carbsG: 10 }, certainty: "measured", weight: 100 },
      { nutrients: { energyKcal: 50 }, certainty: "measured", weight: 300 },
    ]);
    expect(s.totals.energyKcal?.partial).toBe(false);
    expect(s.totals.carbsG).toMatchObject({
      value: 10,
      partial: true,
      missingCount: 1,
      count: 2,
      shareBy: "weight",
      missingShare: 0.75,
    });
  });

  it("senza pesi per tutti conta gli addendi", () => {
    const s = sumNutrients([
      { nutrients: { carbsG: 4 }, certainty: "measured", weight: 100 },
      { nutrients: {}, certainty: "measured" },
      { nutrients: { carbsG: 6 }, certainty: "measured", weight: 100 },
      { nutrients: {}, certainty: "measured", weight: 100 },
    ]);
    expect(s.totals.carbsG).toMatchObject({ value: 10, shareBy: "count", missingShare: 0.5 });
  });

  it("un nutriente che nessuno ha non compare: è sconosciuto, non zero", () => {
    const s = sumNutrients([{ nutrients: { energyKcal: 1 }, certainty: "measured" }]);
    expect("carbsG" in s.totals).toBe(false);
    expect(sumNutrients([]).totals).toEqual({});
    expect(sumNutrients([{ nutrients: {} }]).certainty).toBeUndefined();
  });

  it("un addendo con ambito non rende parziali gli altri nutrienti", () => {
    const s = sumNutrients([
      { nutrients: { energyKcal: 100, caffeineMg: 0 }, certainty: "estimated", weight: 100 },
      { nutrients: { caffeineMg: 63 }, certainty: "measured", weight: 30, scope: ["caffeineMg"] },
    ]);
    expect(s.totals.energyKcal).toMatchObject({ value: 100, partial: false, count: 1 });
    expect(s.totals.caffeineMg).toMatchObject({ value: 63, partial: false, count: 2 });
  });

  it("la certezza è la peggiore tra gli addendi che contribuiscono", () => {
    const s = sumNutrients([
      { nutrients: { energyKcal: 1, proteinG: 1 }, certainty: "measured" },
      { nutrients: { energyKcal: 1 }, certainty: "estimated" },
      { nutrients: {} },
    ]);
    expect(s.certainty).toBe("estimated");
    expect(s.totals.energyKcal?.certainty).toBe("estimated");
    expect(s.totals.proteinG?.certainty).toBe("measured");
  });

  it("ignora valori non validi come dati assenti", () => {
    const s = sumNutrients([
      { nutrients: { energyKcal: Number.NaN }, certainty: "measured" },
      { nutrients: { energyKcal: 10 }, certainty: "measured" },
    ]);
    expect(s.totals.energyKcal).toMatchObject({ value: 10, partial: true });
  });
});
