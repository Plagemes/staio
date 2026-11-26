import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { voidOf } from "../ledger/test-helpers";
import { compositionFromFood, type FoodComposition } from "../nutrition";
import { at, day, ledger } from "../shopping/test-helpers";
import { buildPriceHistories } from "./history";
import { costPerNutrient } from "./nutrientCost";
import { monthlyBudgetProgress, spendRanges, summarizeSpend } from "./spend";

const TODAY = day(40);
const range = (id: "7" | "30" | "month") => spendRanges(TODAY).find((r) => r.id === id)!;

describe("spesa del periodo", () => {
  it("senza acquisti: zero e nessun minimo", () => {
    const s = summarizeSpend(ledger().pantry(), range("30"));
    expect(s).toMatchObject({ totalCents: 0, purchaseCount: 0, isMinimum: false, byCategory: [] });
  });

  it("somma per categoria e dichiara gli acquisti senza prezzo", () => {
    const l = ledger();
    l.buy(38, "Latte", 1000, "ml", { price: 150, category: "latticini" });
    l.buy(37, "Yogurt", 500, "g", { price: 250, category: "latticini" });
    l.buy(36, "Pane", 500, "g", { price: 300, category: "pane" });
    l.buy(35, "Sale", 1000, "g", { category: "dispensa" });
    l.buy(10, "Pasta", 500, "g", { price: 99, category: "pasta" });
    const s = summarizeSpend(l.pantry(), range("7"));
    expect(s.totalCents).toBe(700);
    expect(s.pricedCount).toBe(3);
    expect(s.unpricedCount).toBe(1);
    expect(s.isMinimum).toBe(true);
    expect(s.byCategory[0]).toMatchObject({ category: "latticini", cents: 400 });
    expect(summarizeSpend(l.pantry(), range("30")).totalCents).toBe(700);
  });

  it("un acquisto annullato non è spesa", () => {
    const l = ledger();
    l.buy(38, "Latte", 1000, "ml", { price: 150 });
    l.buy(37, "Pane", 500, "g", { price: 300 });
    l.events.push(voidOf("v1", at(39), "e00001"));
    const s = summarizeSpend(derivePantry(l.events), range("7"));
    expect(s.totalCents).toBe(300);
    expect(s.purchaseCount).toBe(1);
  });

  it("gli acquisti sono le parti del totale, nello stesso ciclo", () => {
    const l = ledger();
    l.buy(38, "Latte", 1000, "ml", { price: 150, category: "latticini", store: "Conad" });
    l.buy(37, "Pane", 500, "g", { price: 300, category: "pane" });
    l.buy(36, "Sale", 1000, "g", { category: "dispensa" });
    l.buy(10, "Pasta", 500, "g", { price: 99 });
    const s = summarizeSpend(l.pantry(), range("7"));
    expect(s.purchases).toHaveLength(s.purchaseCount);
    expect(s.purchases.filter((p) => p.cents !== undefined)).toHaveLength(s.pricedCount);
    expect(s.purchases.filter((p) => p.cents === undefined)).toHaveLength(s.unpricedCount);
    expect(s.purchases.reduce((sum, p) => sum + (p.cents ?? 0), 0)).toBe(s.totalCents);
    expect(s.purchases.find((p) => p.name === "Latte")).toMatchObject({
      lotId: "L0001",
      eventId: "e00001",
      date: day(38),
      store: "Conad",
      category: "latticini",
      cents: 150,
      certainty: "measured",
    });
    const sale = s.purchases.find((p) => p.name === "Sale")!;
    expect(sale.cents).toBeUndefined();
    expect(sale.certainty).toBeUndefined();
    expect(s.purchases.find((p) => p.name === "Pasta")).toBeUndefined(); // fuori periodo
  });

  it("un acquisto annullato non è tra le parti", () => {
    const l = ledger();
    l.buy(38, "Latte", 1000, "ml", { price: 150 });
    l.buy(37, "Pane", 500, "g", { price: 300 });
    l.events.push(voidOf("v1", at(39), "e00001"));
    const s = summarizeSpend(derivePantry(l.events), range("7"));
    expect(s.purchases.map((p) => p.name)).toEqual(["Pane"]);
  });

  it("il mese in corso parte dal primo del mese", () => {
    expect(range("month").from).toBe(`${TODAY.slice(0, 7)}-01`);
  });
});

describe("tetto mensile", () => {
  it("avanzamento dentro e oltre il tetto", () => {
    const l = ledger();
    l.buy(40, "Pane", 500, "g", { price: 600 });
    const month = summarizeSpend(l.pantry(), range("month"));
    const p = monthlyBudgetProgress(month, 1000);
    expect(p).toMatchObject({ spentCents: 600, remainingCents: 400, overCents: 0, share: 0.6 });
    expect(monthlyBudgetProgress(month, 500)).toMatchObject({ remainingCents: 0, overCents: 100 });
  });
});

describe("storico dei prezzi", () => {
  it("nessun prezzo: nessuno storico", () => {
    const l = ledger();
    l.buy(1, "Latte", 1000, "ml");
    expect(buildPriceHistories(l.pantry())).toEqual({ products: [], notComparable: 0, singlePurchase: 0 });
  });

  it("un solo acquisto non fa storico", () => {
    const l = ledger();
    l.buy(1, "Latte", 1000, "ml", { price: 175 });
    const r = buildPriceHistories(l.pantry());
    expect(r.products).toEqual([]);
    expect(r.singlePurchase).toBe(1);
  });

  it("ultimo, di solito, minimo, massimo e variazione", () => {
    const l = ledger();
    l.buy(1, "Latte", 1000, "ml", { price: 170 });
    l.buy(8, "Latte", 1000, "ml", { price: 180 });
    l.buy(15, "Latte", 1000, "ml", { price: 189 });
    const [p] = buildPriceHistories(l.pantry()).products;
    expect(p.last.cents).toBe(189);
    expect(p.per).toBe("l");
    expect(p.usual.cents).toBe(175);
    expect(p.lowest.cents).toBe(170);
    expect(p.highest.cents).toBe(189);
    expect(p.changePct).toBe(8);
    expect(p.trend).toBe("up");
    expect(p.points).toHaveLength(3);
  });

  it("pezzi contro grammi non si confrontano e si contano", () => {
    const l = ledger();
    l.buy(1, "Mele", 1000, "g", { price: 200 });
    l.buy(5, "Mele", 1000, "g", { price: 220 });
    l.buy(8, "Mele", 4, "pz", { price: 150 });
    l.buy(9, "Mele", 4, "pz", { price: 160 });
    const r = buildPriceHistories(l.pantry());
    expect(r.products).toEqual([]);
    expect(r.notComparable).toBe(1);
  });

  it("un acquisto annullato non entra nello storico", () => {
    const l = ledger();
    l.buy(1, "Latte", 1000, "ml", { price: 170 });
    l.buy(8, "Latte", 1000, "ml", { price: 999 });
    l.events.push(voidOf("v1", at(9), "e00002"));
    expect(buildPriceHistories(derivePantry(l.events)).products).toEqual([]);
  });
});

const food = (id: string, per100: FoodComposition["per100"], extra: Partial<FoodComposition> = {}): FoodComposition => ({
  id,
  name: id,
  group: "prova",
  basis: "g",
  per100,
  source: { db: "prova", id, description: id },
  ...extra,
});
const FOODS: Record<string, FoodComposition> = {
  pollo: food("pollo", { energyKcal: 100, proteinG: 20 }),
  pasta: food("pasta", { energyKcal: 350, proteinG: 12, fiberG: 3 }),
  uova: food("uova", { energyKcal: 140, proteinG: 12 }),
  mele: food("mele", { energyKcal: 50 }, { unitWeightG: 150 }),
};
const compose = (lot: { productRef: string }) => {
  const f = FOODS[lot.productRef.toLowerCase()];
  return f ? compositionFromFood(f) : undefined;
};

describe("costo per nutriente", () => {
  it("nessun prezzo: tutto fuori e contato", () => {
    const l = ledger();
    l.buy(1, "Pollo", 1000, "g");
    const r = costPerNutrient(l.pantry().lots, compose, { today: TODAY });
    expect(r.rankings.protein).toEqual([]);
    expect(r.excluded.noPrice).toBe(1);
  });

  it("classifica per euro ogni 100 g di proteine", () => {
    const l = ledger();
    l.buy(30, "Pollo", 1000, "g", { price: 900 }); // 200 g proteine: 450 per 100 g
    l.buy(30, "Pasta", 1000, "g", { price: 150 }); // 120 g: 125 per 100 g
    const r = costPerNutrient(l.pantry().lots, compose, { today: TODAY });
    expect(r.rankings.protein.map((x) => [x.name, x.cents])).toEqual([
      ["Pasta", 125],
      ["Pollo", 450],
    ]);
    expect(r.rankings.protein[0].estimated).toBe(true);
    expect(r.rankings.fiber.map((x) => x.name)).toEqual(["Pasta"]);
    expect(r.noNutrientData.fiber).toBe(1);
    expect(r.rankings.energy[0].name).toBe("Pasta");
  });

  it("conta l'ultimo acquisto con prezzo di ogni prodotto", () => {
    const l = ledger();
    l.buy(10, "Pollo", 1000, "g", { price: 900 });
    l.buy(20, "Pollo", 1000, "g", { price: 600 });
    const r = costPerNutrient(l.pantry().lots, compose, { today: TODAY });
    expect(r.rankings.protein).toHaveLength(1);
    expect(r.rankings.protein[0].cents).toBe(300);
  });

  it("pezzi con peso noto contano, senza peso restano fuori", () => {
    const l = ledger();
    l.buy(30, "Mele", 4, "pz", { price: 200 });
    l.buy(30, "Uova", 6, "pz", { price: 300 });
    const r = costPerNutrient(l.pantry().lots, compose, { today: TODAY });
    expect(r.rankings.energy.map((x) => x.name)).toEqual(["Mele"]);
    expect(r.excluded.notComparable).toBe(1);
  });

  it("un acquisto annullato non conta; composizione assente e prezzi vecchi si dichiarano", () => {
    const l = ledger();
    l.buy(30, "Pollo", 1000, "g", { price: 900 });
    l.events.push(voidOf("v1", at(31), "e00001"));
    l.buy(30, "Sconosciuto", 500, "g", { price: 100 });
    l.buy(-200, "Pasta", 500, "g", { price: 100 });
    const r = costPerNutrient(derivePantry(l.events).lots, compose, { today: TODAY });
    expect(r.rankings.protein).toEqual([]);
    expect(r.excluded).toMatchObject({ noComposition: 1, tooOld: 1 });
  });

  it("valori nutrizionali assenti: il prodotto non entra nella classifica", () => {
    const l = ledger();
    l.buy(30, "Mele", 1000, "g", { price: 200 });
    const r = costPerNutrient(l.pantry().lots, compose, { today: TODAY });
    expect(r.rankings.protein).toEqual([]);
    expect(r.noNutrientData.protein).toBe(1);
  });
});
