import { describe, expect, it } from "vitest";
import { applyBudget, type BudgetLine } from "./budget";
import { buildPriceBook } from "./prices";
import { day, ledger } from "./test-helpers";

function book() {
  const l = ledger();
  l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Lidl" });
  l.buy(0, "Pasta", 500, "g", { price: 120, store: "Lidl" });
  l.buy(0, "Burro", 250, "g", { price: 200, store: "Conad" });
  l.buy(0, "Caffè", 250, "g");
  return buildPriceBook(l.pantry());
}

const lines = (): BudgetLine[] => [
  {
    id: "latte|ml",
    key: "latte",
    name: "latte",
    unit: "ml",
    quantity: 2000,
    essentialQuantity: 1000,
    priority: 0.9,
    reasons: [{ kind: "running_out" }],
  },
  { id: "pasta|g", key: "pasta", name: "pasta", unit: "g", quantity: 1000, priority: 0.3, reasons: [{ kind: "plan" }] },
  { id: "burro|g", key: "burro", name: "burro", unit: "g", quantity: 250, priority: 0.5 },
  { id: "caffe|g", key: "caffe", name: "caffe", unit: "g", quantity: 250, priority: 0.1 },
];

// latte 200 + pasta 240 + burro 200 = 640; il caffè non ha prezzo.

describe("tetto di spesa", () => {
  it("sotto il tetto non cambia nulla", () => {
    const r = applyBudget(lines(), book(), 1000);
    expect(r.totalBeforeCents).toBe(640);
    expect(r.totalAfterCents).toBe(640);
    expect(r.adjustments).toEqual([]);
    expect(r.items).toHaveLength(4);
    expect(r.unpricedItemIds).toEqual(["caffe|g"]);
  });

  it("riduce solo di quanto serve, fino al minimo essenziale", () => {
    const r = applyBudget(lines(), book(), 600);
    expect(r.totalAfterCents).toBe(600);
    expect(r.adjustments).toEqual([
      {
        itemId: "latte|ml",
        action: "reduce",
        fromQuantity: 2000,
        toQuantity: 1600,
        savedCents: 40,
        priority: 0.9,
        reasonKinds: ["running_out"],
      },
    ]);
    expect(r.items.find((i) => i.id === "latte|ml")?.quantity).toBe(1600);
  });

  it("poi toglie le voci intere partendo dalle più deboli e le elenca", () => {
    const r = applyBudget(lines(), book(), 500);
    // Latte ridotto al minimo (100), poi si toglie la pasta, la più debole (240).
    expect(r.adjustments.map((a) => [a.itemId, a.action, a.toQuantity])).toEqual([
      ["pasta|g", "remove", 0],
      ["latte|ml", "reduce", 1000],
    ]);
    expect(r.totalAfterCents).toBe(100 + 200);
    expect(r.items.map((i) => i.id)).toEqual(["latte|ml", "burro|g", "caffe|g"]);
    expect(r.adjustments[0].reasonKinds).toEqual(["plan"]);
    expect(r.adjustments[0].savedCents).toBe(240);
  });

  it("le voci senza prezzo non pesano e non vengono tolte per risparmiare", () => {
    const r = applyBudget(lines(), book(), 0);
    expect(r.totalAfterCents).toBe(0);
    expect(r.items.map((i) => i.id)).toEqual(["caffe|g"]);
    expect(r.adjustments).toHaveLength(3);
    expect(r.adjustments.every((a) => a.action === "remove")).toBe(true);
  });

  it("a parità di priorità toglie prima la voce che costa di più", () => {
    const l = lines().map((x) => ({ ...x, priority: 0.5, essentialQuantity: undefined }));
    const r = applyBudget(l, book(), 450);
    expect(r.adjustments.map((a) => a.itemId)).toEqual(["pasta|g"]);
  });

  it("con un negozio indicato usa i prezzi di quel negozio", () => {
    const r = applyBudget(lines(), book(), 10_000, { store: "Conad" });
    expect(r.totalBeforeCents).toBe(200);
    expect(r.unpricedItemIds).toEqual(["latte|ml", "pasta|g", "caffe|g"]);
  });

  it("segnala i prezzi vecchi e non usa quelli troppo vecchi", () => {
    const l = ledger();
    l.buy(0, "Latte", 1000, "ml", { price: 100 });
    l.buy(90, "Pasta", 500, "g", { price: 120 });
    const b = buildPriceBook(l.pantry());
    const ls = lines().slice(0, 2);
    const mid = applyBudget(ls, b, 10_000, { today: day(100) });
    expect(mid.staleItemIds).toEqual(["latte|ml"]);
    expect(mid.totalBeforeCents).toBe(200 + 240);
    const old = applyBudget(ls, b, 10_000, { today: day(200) });
    expect(old.unpricedItemIds).toEqual(["latte|ml"]);
    expect(old.tooOldItemIds).toEqual(["latte|ml"]);
    expect(old.totalBeforeCents).toBe(240);
  });

  it("rifiuta un tetto non valido", () => {
    expect(() => applyBudget(lines(), book(), -1)).toThrow();
    expect(() => applyBudget(lines(), book(), Number.NaN)).toThrow();
  });

  it("non dipende dall'ordine delle voci", () => {
    const a = applyBudget(lines(), book(), 500);
    const b = applyBudget([...lines()].reverse(), book(), 500);
    expect(b.adjustments).toEqual(a.adjustments);
    expect(b.totalAfterCents).toBe(a.totalAfterCents);
  });
});
