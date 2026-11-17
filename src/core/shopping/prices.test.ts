import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import {
  buildPriceBook,
  estimateCost,
  findSeries,
  findUsablePrice,
  seriesByStore,
  unitPriceOf,
} from "./prices";
import { day, ledger, seededRandom, shuffled } from "./test-helpers";

describe("unitPriceOf", () => {
  it("espone prezzo al kg, al litro e al pezzo in centesimi interi", () => {
    expect(unitPriceOf(0.24, "g")).toEqual({ cents: 240, per: "kg" });
    expect(unitPriceOf(0.0015, "ml")).toEqual({ cents: 2, per: "l" });
    expect(unitPriceOf(30, "pz")).toEqual({ cents: 30, per: "pz" });
  });
});

describe("storico prezzi", () => {
  it("ricava ultimo prezzo al kg per prodotto e negozio", () => {
    const l = ledger();
    l.buy(0, "Pasta Penne", 500, "g", { price: 100, store: "Conad" });
    l.buy(5, "pasta  penne", 500, "g", { price: 120, store: "Lidl" });
    const book = buildPriceBook(l.pantry());
    const all = findSeries(book, { key: "pasta penne", unit: "g" });
    expect(all?.observations).toBe(2);
    expect(all?.last.store).toBe("Lidl");
    expect(all?.lastUnitPrice).toEqual({ cents: 240, per: "kg" });
    const conad = findSeries(book, { key: "pasta penne", unit: "g", store: "conad" });
    expect(conad?.lastUnitPrice).toEqual({ cents: 200, per: "kg" });
    expect(book.stores).toEqual(["Conad", "Lidl"]);
    expect(seriesByStore(book, { key: "pasta penne", unit: "g" }).map((s) => s.store)).toEqual([
      "Conad",
      "Lidl",
    ]);
  });

  it("con poche osservazioni lo dice e non inventa medie né andamento", () => {
    const l = ledger();
    l.buy(0, "Riso", 1000, "g", { price: 200, store: "Conad" });
    l.buy(3, "Riso", 1000, "g", { price: 220, store: "Conad" });
    const s = findSeries(buildPriceBook(l.pantry()), { key: "riso", unit: "g" });
    expect(s?.observations).toBe(2);
    expect(s?.sufficient).toBe(false);
    expect(s?.averageUnitPrice).toBeNull();
    expect(s?.lowestUnitPrice).toBeNull();
    expect(s?.trend).toBe("insufficient");
    expect(s?.changePct).toBeNull();
    expect(s?.lastUnitPrice.cents).toBe(220);
  });

  it("con osservazioni sufficienti calcola media ponderata, minimo e andamento", () => {
    const l = ledger();
    l.buy(0, "Olio", 1000, "ml", { price: 500 });
    l.buy(10, "Olio", 1000, "ml", { price: 500 });
    l.buy(20, "Olio", 1000, "ml", { price: 650 });
    const s = findSeries(buildPriceBook(l.pantry()), { key: "olio", unit: "ml" });
    expect(s?.sufficient).toBe(true);
    expect(s?.averageUnitPrice).toEqual({ cents: 550, per: "l" });
    expect(s?.lowestUnitPrice?.cents).toBe(500);
    expect(s?.highestUnitPrice?.cents).toBe(650);
    expect(s?.trend).toBe("up");
    expect(s?.changePct).toBe(30);
  });

  it("riconosce un prezzo stabile e uno in calo", () => {
    const stable = ledger();
    stable.buy(0, "Latte", 1000, "ml", { price: 150 });
    stable.buy(7, "Latte", 1000, "ml", { price: 150 });
    stable.buy(14, "Latte", 1000, "ml", { price: 151 });
    expect(findSeries(buildPriceBook(stable.pantry()), { key: "latte", unit: "ml" })?.trend).toBe(
      "stable",
    );
    const down = ledger();
    down.buy(0, "Latte", 1000, "ml", { price: 150 });
    down.buy(7, "Latte", 1000, "ml", { price: 150 });
    down.buy(14, "Latte", 1000, "ml", { price: 100 });
    expect(findSeries(buildPriceBook(down.pantry()), { key: "latte", unit: "ml" })?.trend).toBe(
      "down",
    );
  });

  it("tiene separate le unità diverse dello stesso prodotto", () => {
    const l = ledger();
    l.buy(0, "Pomodori", 500, "g", { price: 150 });
    l.buy(1, "Pomodori", 6, "pz", { price: 240 });
    const book = buildPriceBook(l.pantry());
    expect(findSeries(book, { key: "pomodori", unit: "g" })?.lastUnitPrice).toEqual({
      cents: 300,
      per: "kg",
    });
    expect(findSeries(book, { key: "pomodori", unit: "pz" })?.lastUnitPrice).toEqual({
      cents: 40,
      per: "pz",
    });
  });

  it("tiene serie per codice a barre, con precedenza sul nome", () => {
    const l = ledger();
    l.buy(0, "Latte", 1000, "ml", { price: 200, barcode: "8001234567890" });
    l.buy(3, "Latte", 1000, "ml", { price: 100 });
    const book = buildPriceBook(l.pantry());
    expect(findSeries(book, { key: "latte", unit: "ml" })?.lastUnitPrice.cents).toBe(100);
    expect(
      findSeries(book, { key: "latte", barcode: "8001234567890", unit: "ml" })?.lastUnitPrice.cents,
    ).toBe(200);
    // Lo stesso codice a barre con un nome diverso finisce nella stessa serie.
    const l2 = ledger();
    l2.buy(0, "Latte intero", 1000, "ml", { price: 180, barcode: "8001234567890" });
    l2.buy(2, "Latte UHT", 1000, "ml", { price: 160, barcode: "8001234567890" });
    const s = findSeries(buildPriceBook(l2.pantry()), {
      key: "altro",
      barcode: "8001234567890",
      unit: "ml",
    });
    expect(s?.observations).toBe(2);
  });

  it("ignora i lotti senza prezzo e li conta", () => {
    const l = ledger();
    l.buy(0, "Caffè", 250, "g");
    const book = buildPriceBook(l.pantry());
    expect(book.series).toHaveLength(0);
    expect(book.lotsWithoutPrice).toBe(1);
    expect(estimateCost(book, { key: "caffe", unit: "g" }, 250)).toBeNull();
  });

  it("stima il costo con l'ultimo prezzo osservato, non con una media", () => {
    const l = ledger();
    l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
    l.buy(4, "Pasta", 500, "g", { price: 150, store: "Conad" });
    const est = estimateCost(buildPriceBook(l.pantry()), { key: "pasta", unit: "g" }, 1000);
    expect(est?.cents).toBe(300);
    expect(est?.basis).toBe("last");
    expect(est?.observations).toBe(2);
  });

  it("ogni prezzo porta la sua data e la sua età; oltre le soglie è vecchio o non usato", () => {
    const l = ledger();
    l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
    const book = buildPriceBook(l.pantry());
    const q = { key: "pasta", unit: "g" as const };
    expect(estimateCost(book, q, 500)).toMatchObject({ date: day(0), ageDays: null, stale: false });
    expect(estimateCost(book, q, 500, { today: day(30) })).toMatchObject({
      date: day(0),
      ageDays: 30,
      stale: false,
    });
    expect(estimateCost(book, q, 500, { today: day(61) })).toMatchObject({ ageDays: 61, stale: true });
    expect(estimateCost(book, q, 500, { today: day(180) })?.stale).toBe(true);
    expect(estimateCost(book, q, 500, { today: day(181) })).toBeNull();
    expect(findUsablePrice(book, q, { today: day(181), maxAgeDays: 400 })?.ageDays).toBe(181);
    expect(findUsablePrice(book, q, { today: day(10), staleAfterDays: 5 })?.stale).toBe(true);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const l = ledger();
    l.buy(0, "Pasta", 500, "g", { price: 100, store: "Conad" });
    l.buy(4, "Pasta", 500, "g", { price: 150, store: "Lidl", barcode: "8001234567890" });
    l.buy(9, "Pasta", 500, "g", { price: 130, store: "Conad" });
    const reference = buildPriceBook(l.pantry());
    for (let seed = 1; seed <= 5; seed++) {
      const book = buildPriceBook(derivePantry(shuffled(l.events, seededRandom(seed))));
      expect(book).toEqual(reference);
    }
  });
});
