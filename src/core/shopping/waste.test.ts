import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { seededRandom, shuffled, day, ledger } from "./test-helpers";
import { wasteByProduct } from "./waste";

/** Insalata da 500 g: 4 lotti, ognuno con 100 g mangiati e 400 g buttati; poi un formato da 250 g finito. */
function saladLedger() {
  const l = ledger();
  for (let k = 0; k < 4; k++) {
    const lot = l.buy(k * 10, "Insalata", 500, "g", { price: 200 });
    l.use(k * 10 + 1, lot, 100, "g");
    l.toss(k * 10 + 5, lot, 400, "g", k % 2 === 0 ? "expired" : "leftover");
  }
  const small = l.buy(36, "Insalata", 250, "g", { price: 120 });
  l.use(37, small, 250, "g");
  return l;
}

describe("spreco", () => {
  it("somma quanto è stato buttato e perché", () => {
    const [w] = wasteByProduct(saladLedger().pantry(), day(40));
    expect(w.key).toBe("insalata");
    expect(w.purchased).toBe(2250);
    expect(w.discarded).toBe(1600);
    expect(w.wasted).toBe(1600);
    expect(w.wasteShare).toBeCloseTo(1600 / 2250, 3);
    expect(w.shareReliable).toBe(true);
    expect(w.byReason).toEqual([
      { reason: "expired", quantity: 800, events: 2 },
      { reason: "leftover", quantity: 800, events: 2 },
    ]);
    // 80% del prezzo di ciascuno dei 4 lotti da 500 g.
    expect(w.costCents).toBe(Math.round(4 * 200 * 0.8));
  });

  it("segnala il formato troppo grande quando la perdita si ripete", () => {
    const [w] = wasteByProduct(saladLedger().pantry(), day(40));
    expect(w.formatSignals).toHaveLength(1);
    expect(w.formatSignals[0]).toMatchObject({
      size: 500,
      closedLots: 4,
      lotsWithLoss: 4,
      typicalUsed: 100,
      suggestedMaxSize: 100,
      certainty: "estimated",
    });
    expect(w.formats.find((f) => f.size === 250)).toMatchObject({ closedLots: 1, lotsWithLoss: 0 });
  });

  it("non segnala il formato con pochi lotti o con perdite occasionali", () => {
    const few = ledger();
    for (let k = 0; k < 2; k++) {
      const lot = few.buy(k * 10, "Insalata", 500, "g");
      few.use(k * 10 + 1, lot, 100, "g");
      few.toss(k * 10 + 5, lot, 400, "g");
    }
    expect(wasteByProduct(few.pantry(), day(30))[0].formatSignals).toHaveLength(0);
    expect(wasteByProduct(few.pantry(), day(30))[0].shareReliable).toBe(false);

    const occasional = ledger();
    for (let k = 0; k < 5; k++) {
      const lot = occasional.buy(k * 10, "Pane", 500, "g");
      occasional.use(k * 10 + 1, lot, k === 0 ? 100 : 500, "g");
      if (k === 0) occasional.toss(k * 10 + 5, lot, 400, "g");
    }
    const w = wasteByProduct(occasional.pantry(), day(60))[0];
    expect(w.formats[0]).toMatchObject({ closedLots: 5, lotsWithLoss: 1 });
    expect(w.formatSignals).toHaveLength(0);
  });

  it("conta come perso ciò che resta in un lotto già scaduto", () => {
    const l = ledger();
    for (let k = 0; k < 3; k++) {
      l.buy(k * 10, "Yogurt", 500, "g", { expiryDay: k * 10 + 7 });
    }
    const w = wasteByProduct(l.pantry(), day(40))[0];
    expect(w.discarded).toBe(0);
    expect(w.expiredUnused).toBe(1500);
    expect(w.wasteShare).toBe(1);
    expect(w.formatSignals).toHaveLength(1);
    expect(w.formatSignals[0].suggestedMaxSize).toBeNull();
  });

  it("separa le unità e non conta i regali come spreco", () => {
    const l = ledger();
    const a = l.buy(0, "Mele", 1000, "g");
    l.buy(0, "Mele", 6, "pz");
    l.give(2, a, 500, "g");
    const all = wasteByProduct(l.pantry(), day(5));
    expect(all.map((w) => w.unit)).toEqual(["g", "pz"]);
    expect(all[0].wasted).toBe(0);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const l = saladLedger();
    const reference = wasteByProduct(l.pantry(), day(40));
    for (let seed = 1; seed <= 5; seed++) {
      const state = derivePantry(shuffled(l.events, seededRandom(seed)));
      expect(wasteByProduct(state, day(40))).toEqual(reference);
    }
  });
});
