import { describe, expect, it } from "vitest";
import { monthlyBudgetProgress, spendRanges, summarizeSpend, type SpendSummary } from "@/core/prices";
import { emptyRejections, emptyStockConfig } from "@/core/shopping";
import { day, ledger, milkLedger } from "@/core/shopping/test-helpers";
import { budgetLead, purchaseHref, shoppingCostContent, spendContent } from "./costBreakdown";
import { emptyDecisions } from "./settings";
import { buildShoppingView, type ViewInput } from "./view";

const num = (s: string) => Math.round(Number(s.replace(/[^\d,]/g, "").replace(",", ".")) * 100);

/* ---------- N1 ---------- */

const today = day(28);
const input = (extra: Partial<ViewInput> = {}): ViewInput => ({
  today,
  pantry: milkLedger().pantry(),
  planNeeds: [],
  manual: [
    { id: "m1", product: "Sale", quantity: { value: 1, unit: "pz" }, addedAt: `${today}T08:00:00.000Z` },
    { id: "m2", product: "Pepe", quantity: { value: 1, unit: "pz" }, addedAt: `${today}T08:00:00.000Z` },
  ],
  pairs: [],
  stock: emptyStockConfig(),
  rejections: emptyRejections(),
  decisions: emptyDecisions(),
  budgetCents: null,
  ...extra,
});

describe("N1: il foglio «Costo stimato»", () => {
  const view = buildShoppingView(input());
  const content = shoppingCostContent(view);

  it("le righe a schermo fanno il totale a schermo (e il totale della sezione)", () => {
    expect(content.rows.reduce((s, r) => s + num(r.value), 0)).toBe(num(content.total));
    expect(num(content.total)).toBe(view.cost.totalCents);
    expect(content.rows).toHaveLength(view.cost.pricedCount);
  });

  it("le voci senza prezzo sono tante quante cost.unpricedCount e il totale dice «almeno»", () => {
    expect(content.missing).toHaveLength(view.cost.unpricedCount);
    expect(view.cost.unpricedCount).toBe(2);
    expect(content.totalPrefix).toBe("almeno");
    expect(content.missingLabel).toBe("Senza prezzo (2)");
    expect(content.totalCertainty).toBe("estimated");
  });

  it("la riga dice nome e quantità in lista, e da dove viene il prezzo", () => {
    const milk = content.rows[0];
    expect(milk.label).toMatch(/^Latte · /);
    expect(milk.hint).toMatch(/^1,50 €\/l · il \d+ \w+$/);
    expect(milk.href).toBeUndefined();
    expect(milk.certainty).toBe("estimated");
  });

  it("senza voci senza prezzo non c'è «almeno»; la nota dice che è una stima", () => {
    const only = shoppingCostContent(buildShoppingView(input({ manual: [] })));
    expect(only.totalPrefix).toBeUndefined();
    expect(only.missing).toBeUndefined();
    expect(only.note).toBe("È l'ultimo prezzo che hai pagato, per la quantità in lista: una stima, non un preventivo.");
  });

  it("il negozio compare nell'indicazione quando c'è", () => {
    const l = ledger();
    const lot = l.buy(0, "Latte", 1000, "ml", { price: 150, store: "Conad" });
    l.buy(7, "Latte", 1000, "ml", { price: 150, store: "Conad" });
    for (let d = 0; d < 14; d++) l.use(d, lot, 70, "ml");
    const v = buildShoppingView({ ...input({ manual: [] }), pantry: l.pantry(), today: day(14) });
    const milk = v.items.find((i) => i.name === "Latte");
    if (milk) expect(shoppingCostContent(v).rows[0].hint).toContain("da Conad");
  });
});

/* ---------- N4, N5 ---------- */

const TODAY = day(40);
const range = (id: "7" | "30" | "month") => spendRanges(TODAY).find((r) => r.id === id)!;

function spendLedger() {
  const l = ledger();
  l.buy(38, "Latte intero", 1000, "ml", { price: 189, category: "milk_fresh", store: "Conad" });
  l.buy(37, "Yogurt", 500, "g", { price: 250, category: "milk_fresh" });
  l.buy(36, "Pane", 500, "g", { price: 333, category: "bread" });
  l.buy(35, "Sale", 1000, "g", { category: "pantry" });
  l.buy(20, "Pasta", 500, "g", { price: 99, category: "pasta" });
  l.buy(5, "Riso", 500, "g", { price: 150, category: "pasta" });
  return l;
}

describe("N4: il foglio «Spesa del periodo»", () => {
  it("le righe a schermo fanno il totale a schermo, per ogni scheda", () => {
    const l = spendLedger();
    for (const id of ["7", "30", "month"] as const) {
      const s = summarizeSpend(l.pantry(), range(id));
      const c = spendContent(s, range(id));
      expect(c.rows.reduce((sum, r) => sum + num(r.value), 0)).toBe(num(c.total));
      expect(num(c.total)).toBe(s.totalCents);
      expect(c.rows).toHaveLength(s.pricedCount);
      expect(c.missing?.length ?? 0).toBe(s.unpricedCount);
    }
  });

  it("segue la scheda: 40 giorni fa non c'è nei 30, 20 giorni fa c'è", () => {
    const l = spendLedger();
    const s30 = spendContent(summarizeSpend(l.pantry(), range("30")), range("30"));
    expect(s30.rows.map((r) => r.label.split(" · ")[0])).not.toContain("Riso"); // giorno 5 = 35 giorni fa
    expect(s30.rows.map((r) => r.label.split(" · ")[0])).toContain("Pasta"); // giorno 20 = 20 giorni fa
    expect(s30.title).toBe("Spesa degli ultimi 30 giorni");
    expect(spendContent(summarizeSpend(l.pantry(), range("7")), range("7")).title).toBe("Spesa degli ultimi 7 giorni");
    expect(spendContent(summarizeSpend(l.pantry(), range("month")), range("month")).title).toBe("Spesa di questo mese");
  });

  it("senza prezzo: sta tra i mancanti e il totale dice «almeno»", () => {
    const l = spendLedger();
    const c = spendContent(summarizeSpend(l.pantry(), range("7")), range("7"));
    expect(c.totalPrefix).toBe("almeno");
    expect(c.missingLabel).toBe("Senza prezzo (1)");
    expect(c.missing?.[0].label).toMatch(/^Sale · /);
    const none = spendContent(summarizeSpend(ledger().pantry(), range("7")), range("7"));
    expect(none.totalPrefix).toBeUndefined();
    expect(none.rows).toEqual([]);
  });

  it("la riga: nome, giorno e negozio; la categoria sotto; il prezzo a destra", () => {
    const l = spendLedger();
    const c = spendContent(summarizeSpend(l.pantry(), range("7")), range("7"));
    const milk = c.rows.find((r) => r.label.startsWith("Latte intero"))!;
    expect(milk.label).toMatch(/^Latte intero · \d+ \w+, Conad$/);
    expect(milk.value).toBe("1,89 €");
    expect(milk.hint).toBeTruthy();
    expect(c.rows.find((r) => r.label.startsWith("Pane"))?.label).toMatch(/^Pane · \d+ \w+$/);
  });

  it("le righe stanno per categoria, dalla più spesa", () => {
    const l = spendLedger();
    const s = summarizeSpend(l.pantry(), range("7"));
    const c = spendContent(s, range("7"));
    const hints = c.rows.map((r) => r.hint);
    // ogni categoria sta in un blocco solo, e la più spesa viene prima
    expect(hints.filter((h, i) => i > 0 && h !== hints[i - 1] && hints.indexOf(h) < i)).toEqual([]);
    expect(s.byCategory[0].cents).toBeGreaterThanOrEqual(s.byCategory[1].cents);
  });

  it("i collegamenti ci sono solo entro 60 giorni, e portano all'evento di acquisto", () => {
    const l = spendLedger();
    const c = spendContent(summarizeSpend(l.pantry(), range("30")), range("30"));
    expect(c.rows.every((r) => r.href?.startsWith("/app?voce="))).toBe(true);
    const milk = c.rows.find((r) => r.label.startsWith("Latte intero"))!;
    expect(milk.href).toBe("/app?voce=e00001");
    expect(purchaseHref({ eventId: "e1", date: day(40 - 60) }, TODAY)).toBe("/app?voce=e1");
    expect(purchaseHref({ eventId: "e1", date: day(40 - 61) }, TODAY)).toBeUndefined();
    expect(purchaseHref({ eventId: "e1", date: day(41) }, TODAY)).toBeUndefined();
    expect(purchaseHref({ eventId: "a b", date: TODAY }, TODAY)).toBe("/app?voce=a%20b");
  });

  it("un acquisto vecchio dato a mano non ha il collegamento", () => {
    const s: SpendSummary = {
      range: range("month"),
      totalCents: 100,
      pricedCount: 1,
      unpricedCount: 0,
      purchaseCount: 1,
      isMinimum: false,
      certainty: "measured",
      byCategory: [{ category: null, cents: 100, pricedCount: 1, unpricedCount: 0 }],
      purchases: [{ lotId: "L1", eventId: "e1", name: "Miele", date: day(40 - 90), category: null, cents: 100, certainty: "measured" }],
    };
    const c = spendContent(s, range("month"));
    expect(c.rows[0].href).toBeUndefined();
    expect(c.rows[0].hint).toBe("Senza categoria");
    expect(c.totalCertainty).toBe("measured");
  });

  it("con il tetto del mese il testo di testa dice quanto resta", () => {
    const l = spendLedger();
    const month = summarizeSpend(l.pantry(), range("month"));
    const c = spendContent(month, range("month"), monthlyBudgetProgress(month, 30000));
    expect(c.lead).toMatch(/^Tetto del mese: 300,00 €\. Restano al massimo 292,28 €, 18 giorni\.$/);
    const sums = c.rows.reduce((sum, r) => sum + num(r.value), 0);
    expect(30000 - sums).toBe(monthlyBudgetProgress(month, 30000).remainingCents);
  });

  it("budgetLead: dentro, con prezzi completi, e oltre il tetto", () => {
    const base = { capCents: 30000, spentCents: 23000, remainingCents: 7000, overCents: 0, share: 0.77, isMinimum: false, daysLeft: 12 };
    expect(budgetLead(base)).toBe("Tetto del mese: 300,00 €. Restano 70,00 €, 12 giorni.");
    expect(budgetLead({ ...base, daysLeft: 1 })).toBe("Tetto del mese: 300,00 €. Restano 70,00 €, 1 giorno.");
    expect(budgetLead({ ...base, spentCents: 32000, remainingCents: 0, overCents: 2000 })).toBe("Tetto del mese: 300,00 €. Sei oltre di 20,00 €. Restano 12 giorni.");
  });

  it("senza tetto il testo di testa dice il periodo", () => {
    const l = spendLedger();
    const c = spendContent(summarizeSpend(l.pantry(), range("7")), range("7"));
    expect(c.lead).toMatch(/^Gli acquisti registrati dal \d+ \w+ al \d+ \w+\.$/);
  });
});
