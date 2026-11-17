import { describe, expect, it } from "vitest";
import { monthlyBudgetProgress, spendRanges, type ProductPriceHistory, type SpendSummary } from "@/core/prices";
import { budgetText, categoryLabel, changeText, priceNote, spendText } from "./priceText";

const hist = (over: Partial<ProductPriceHistory> = {}): ProductPriceHistory => ({
  id: "latte|ml",
  key: "latte",
  name: "Latte",
  unit: "ml",
  per: "l",
  observations: 3,
  last: { date: "2026-02-01", cents: 189, store: null },
  usual: { cents: 175, per: "l" },
  lowest: { cents: 170, per: "l" },
  highest: { cents: 189, per: "l" },
  changePct: 8,
  trend: "up",
  points: [],
  ...over,
});

const summary = (over: Partial<SpendSummary> = {}): SpendSummary => ({
  range: spendRanges("2026-02-10")[2],
  totalCents: 3850,
  pricedCount: 28,
  unpricedCount: 12,
  purchaseCount: 40,
  isMinimum: true,
  byCategory: [],
  ...over,
});

describe("frasi sui prezzi", () => {
  it("riga della voce", () => {
    expect(priceNote(hist())).toBe("L'ultima volta 1,89 €/l, di solito 1,75 €/l.");
    expect(priceNote(hist({ per: "pz", last: { date: "x", cents: 30, store: null }, usual: { cents: 25, per: "pz" } }))).toContain("0,30 €/pezzo");
  });
  it("variazione", () => {
    expect(changeText(hist())).toBe("+8% sul solito");
    expect(changeText(hist({ trend: "down", changePct: -4.5 }))).toBe("-4,5% sul solito");
    expect(changeText(hist({ trend: "stable", changePct: 1 }))).toBe("stabile");
  });
  it("spesa: quota senza prezzo dichiarata", () => {
    expect(spendText(summary())).toBe("12 voci su 40 senza prezzo: il totale è almeno 38,50 €.");
    expect(spendText(summary({ purchaseCount: 0, pricedCount: 0, unpricedCount: 0, totalCents: 0, isMinimum: false }))).toContain("Nessun acquisto");
    expect(spendText(summary({ pricedCount: 0, unpricedCount: 3, purchaseCount: 3, totalCents: 0 }))).toContain("non so dire");
  });
  it("tetto mensile", () => {
    expect(budgetText(monthlyBudgetProgress(summary({ totalCents: 6000 }), 5000))).toContain("oltre il tetto");
    expect(budgetText(monthlyBudgetProgress(summary({ isMinimum: false }), 10000))).toContain("restano 61,50");
  });
  it("categoria", () => {
    expect(categoryLabel(null)).toBe("Senza categoria");
    expect(categoryLabel("latticini")).toBe("Latticini");
  });
});
