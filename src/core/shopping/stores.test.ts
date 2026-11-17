import { describe, expect, it } from "vitest";
import type { ShoppingLine } from "./common";
import { buildPriceBook } from "./prices";
import { compareStores } from "./stores";
import { day, ledger } from "./test-helpers";

function book() {
  const l = ledger();
  l.buy(0, "Latte", 1000, "ml", { price: 150, store: "Conad" });
  l.buy(3, "Latte", 1000, "ml", { price: 100, store: "Lidl" });
  l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
  l.buy(3, "Pasta", 500, "g", { price: 120, store: "Lidl" });
  l.buy(0, "Burro", 250, "g", { price: 200, store: "Conad" });
  l.buy(0, "Caffè", 250, "g");
  return buildPriceBook(l.pantry());
}

const line = (key: string, unit: ShoppingLine["unit"], quantity: number): ShoppingLine => ({
  id: `${key}|${unit}`,
  key,
  name: key,
  unit,
  quantity,
});

const LINES = [
  line("latte", "ml", 2000),
  line("pasta", "g", 1000),
  line("burro", "g", 250),
  line("caffe", "g", 250),
];

describe("scelta per negozio", () => {
  it("stima il costo in ciascun negozio solo con i prezzi osservati", () => {
    const r = compareStores(LINES, book());
    expect(r.pricedCount).toBe(3);
    expect(r.unpricedItemIds).toEqual(["caffe|g"]);
    expect(r.unpricedCount).toBe(1);
    const conad = r.singles.find((s) => s.store === "Conad");
    const lidl = r.singles.find((s) => s.store === "Lidl");
    expect(conad?.costCents).toBe(300 + 200 + 200);
    expect(conad?.missingItemIds).toEqual([]);
    expect(lidl?.costCents).toBe(200 + 240);
    expect(lidl?.missingItemIds).toEqual(["burro|g"]);
    expect(r.bestSingle?.store).toBe("Conad");
    expect(r.certainty).toBe("estimated");
  });

  it("propone la divisione su due negozi con il risparmio dichiarato", () => {
    const r = compareStores(LINES, book(), { minSavingsCents: 1, minSavingsShare: 0 });
    expect(r.split).not.toBeNull();
    expect(r.split?.stores).toEqual(["Conad", "Lidl"]);
    expect(r.split?.costCents).toBe(200 + 200 + 200);
    expect(r.split?.baselineStore).toBe("Conad");
    expect(r.split?.baselineCents).toBe(700);
    expect(r.split?.savingsCents).toBe(100);
    expect(r.split?.savingsShare).toBeCloseTo(100 / 700, 3);
    expect(r.split?.assignments).toEqual([
      { itemId: "burro|g", store: "Conad", costCents: 200 },
      { itemId: "latte|ml", store: "Lidl", costCents: 200 },
      { itemId: "pasta|g", store: "Conad", costCents: 200 },
    ]);
    expect(r.split?.uncoveredItemIds).toEqual([]);
  });

  it("non propone la divisione se non fa risparmiare", () => {
    const l = ledger();
    l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Conad" });
    l.buy(0, "Latte", 1000, "ml", { price: 150, store: "Lidl" });
    l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
    l.buy(0, "Pasta", 500, "g", { price: 120, store: "Lidl" });
    const r = compareStores([line("latte", "ml", 1000), line("pasta", "g", 500)], buildPriceBook(l.pantry()));
    expect(r.split).toBeNull();
    expect(r.noSplitReason).toBe("no_saving");
  });

  it("con un solo negozio osservato non divide", () => {
    const l = ledger();
    l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Conad" });
    const r = compareStores([line("latte", "ml", 1000)], buildPriceBook(l.pantry()));
    expect(r.singles).toHaveLength(1);
    expect(r.split).toBeNull();
    expect(r.noSplitReason).toBe("fewer_than_two_stores");
  });

  it("senza alcun prezzo: tutte le voci restano senza prezzo", () => {
    const r = compareStores(LINES, buildPriceBook(ledger().pantry()));
    expect(r.pricedCount).toBe(0);
    expect(r.unpricedCount).toBe(4);
    expect(r.singles).toEqual([]);
    expect(r.bestSingle).toBeNull();
  });

  it("per unità diverse dello stesso prodotto usa il prezzo dell'unità giusta", () => {
    const l = ledger();
    l.buy(0, "Pomodori", 500, "g", { price: 150, store: "Conad" });
    l.buy(0, "Pomodori", 6, "pz", { price: 240, store: "Conad" });
    const r = compareStores(
      [line("pomodori", "g", 1000), line("pomodori", "pz", 6)],
      buildPriceBook(l.pantry()),
    );
    expect(r.singles[0].costCents).toBe(300 + 240);
  });

  it("non dipende dall'ordine delle voci", () => {
    const a = compareStores(LINES, book());
    const b = compareStores([...LINES].reverse(), book());
    expect(b).toEqual(a);
  });

  describe("soglia di risparmio", () => {
    const BIG = [line("latte", "ml", 20000), line("pasta", "g", 10000), line("burro", "g", 250)];
    // Conad 3000 + 2000 + 200 = 5200; diviso: latte da Lidl 2000, pasta e burro da Conad 4200.

    it("per default propone la divisione solo da 2 euro e 5% in su", () => {
      const r = compareStores(BIG, book());
      expect(r.split?.savingsCents).toBe(1000);
      expect(r.split?.savingsShare).toBeCloseTo(1000 / 5200, 3);
      expect(r.belowThresholdSplit).toBeNull();
    });

    it("un risparmio di pochi centesimi non giustifica due negozi", () => {
      const r = compareStores(LINES, book());
      expect(r.split).toBeNull();
      expect(r.noSplitReason).toBe("below_threshold");
      expect(r.belowThresholdSplit?.savingsCents).toBe(100);
      expect(r.bestSingle?.store).toBe("Conad");
    });

    it("la soglia in valore è configurabile", () => {
      const r = compareStores(BIG, book(), { minSavingsCents: 1500, minSavingsShare: 0 });
      expect(r.split).toBeNull();
      expect(r.noSplitReason).toBe("below_threshold");
      expect(r.belowThresholdSplit?.savingsCents).toBe(1000);
      const ok = compareStores(BIG, book(), { minSavingsCents: 1000, minSavingsShare: 0 });
      expect(ok.split).not.toBeNull();
    });

    it("la soglia in quota è configurabile, anche con un risparmio alto in valore", () => {
      const r = compareStores(BIG, book(), { minSavingsCents: 0, minSavingsShare: 0.25 });
      expect(r.split).toBeNull();
      expect(r.noSplitReason).toBe("below_threshold");
      const ok = compareStores(BIG, book(), { minSavingsCents: 0, minSavingsShare: 0.19 });
      expect(ok.split).not.toBeNull();
    });

    it("la quota si misura sul costo di confronto, non sul risparmio assoluto", () => {
      const l = ledger();
      l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Lidl" });
      l.buy(0, "Latte", 1000, "ml", { price: 150, store: "Conad" });
      l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
      l.buy(0, "Pasta", 500, "g", { price: 120, store: "Lidl" });
      l.buy(0, "Parmigiano", 1000, "g", { price: 1500, store: "Conad" });
      l.buy(0, "Parmigiano", 1000, "g", { price: 1500, store: "Lidl" });
      const lines = [
        line("latte", "ml", 20000),
        line("pasta", "g", 10000),
        line("parmigiano", "g", 100000),
      ];
      const r = compareStores(lines, buildPriceBook(l.pantry()));
      // Risparmio di 400 centesimi sul miglior negozio unico (154400): sotto il 5%.
      expect(r.belowThresholdSplit?.savingsCents).toBe(400);
      expect(r.split).toBeNull();
    });
  });

  describe("età dei prezzi", () => {
    function aged() {
      const l = ledger();
      l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Lidl" });
      l.buy(90, "Pasta", 500, "g", { price: 120, store: "Lidl" });
      l.buy(0, "Burro", 250, "g", { price: 200, store: "Lidl" });
      return buildPriceBook(l.pantry());
    }
    const items = [line("latte", "ml", 1000), line("pasta", "g", 500), line("burro", "g", 250)];

    it("senza la data di oggi non valuta l'età", () => {
      const r = compareStores(items, aged());
      expect(r.staleCount).toBe(0);
      expect(r.pricedCount).toBe(3);
    });

    it("marca come vecchi i prezzi oltre la soglia e dichiara quante voci ne dipendono", () => {
      const r = compareStores(items, aged(), { today: day(100) });
      expect(r.pricedCount).toBe(3);
      expect(r.staleItemIds).toEqual(["burro|g", "latte|ml"]);
      expect(r.staleCount).toBe(2);
      expect(r.singles[0].staleItemIds).toEqual(["burro|g", "latte|ml"]);
      expect(r.tooOldItemIds).toEqual([]);
    });

    it("la soglia dei prezzi vecchi è configurabile", () => {
      expect(compareStores(items, aged(), { today: day(100), staleAfterDays: 120 }).staleCount).toBe(0);
      expect(compareStores(items, aged(), { today: day(100), staleAfterDays: 5 }).staleCount).toBe(3);
    });

    it("non usa i prezzi oltre l'età massima, e li conta a parte", () => {
      const r = compareStores(items, aged(), { today: day(200) });
      expect(r.pricedCount).toBe(1);
      expect(r.unpricedItemIds).toEqual(["burro|g", "latte|ml"]);
      expect(r.tooOldItemIds).toEqual(["burro|g", "latte|ml"]);
      expect(r.singles[0].costCents).toBe(120);
      expect(r.staleCount).toBe(1);
      expect(compareStores(items, aged(), { today: day(200), maxAgeDays: 365 }).pricedCount).toBe(3);
    });

    it("la divisione segnala le voci assegnate con prezzi vecchi", () => {
      const l = ledger();
      l.buy(0, "Latte", 1000, "ml", { price: 100, store: "Lidl" });
      l.buy(0, "Latte", 1000, "ml", { price: 400, store: "Conad" });
      l.buy(90, "Pasta", 500, "g", { price: 100, store: "Conad" });
      l.buy(90, "Pasta", 500, "g", { price: 500, store: "Lidl" });
      const r = compareStores(
        [line("latte", "ml", 1000), line("pasta", "g", 500)],
        buildPriceBook(l.pantry()),
        { today: day(100), minSavingsCents: 1, minSavingsShare: 0 },
      );
      expect(r.split?.staleItemIds).toEqual(["latte|ml"]);
    });
  });
});
