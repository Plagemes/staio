import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { recommendShoppingDay } from "./when";
import { day, ledger, milkLedger, seededRandom, shuffled } from "./test-helpers";

describe("giorno consigliato per la spesa", () => {
  it("dal primo esaurimento previsto, con un giorno di anticipo, mai prima di oggi", () => {
    const l = milkLedger();
    // Un secondo prodotto che finisce più tardi: contano i consumi, il primo esaurimento è il latte.
    const rice = l.buy(0, "Riso", 4000, "g");
    for (let d = 0; d < 28; d++) l.use(d, rice, 100, "g");
    l.buy(20, "Riso", 3000, "g");
    const r = recommendShoppingDay({ today: day(28), pantry: l.pantry() });
    expect(r.firstRunout).toMatchObject({ key: "latte", unit: "ml", date: day(28) });
    expect(r.date).toBe(day(28));
    expect(r.basis).toBe("runout");
  });

  it("con più scorta il giorno si sposta in avanti", () => {
    const l = milkLedger();
    l.buy(28, "Latte", 1000, "ml");
    const r = recommendShoppingDay({ today: day(28), pantry: l.pantry() });
    // 1080 ml a ~135 ml/giorno: finiscono dopo 7 giorni; si va il giorno prima.
    expect(r.firstRunout?.date).toBe(day(35));
    expect(r.date).toBe(day(34));
  });

  it("dal piano: il primo giorno in cui i fabbisogni cumulati superano la scorta", () => {
    const l = ledger();
    l.buy(0, "Riso", 1000, "g");
    const r = recommendShoppingDay({
      today: day(28),
      pantry: l.pantry(),
      planNeeds: [
        { product: "Riso", quantity: { value: 600, unit: "g" }, date: day(30) },
        { product: "riso", quantity: { value: 0.6, unit: "kg" }, date: day(33) },
        { product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(40) },
      ],
    });
    expect(r.firstPlanShortfall).toMatchObject({ key: "riso", date: day(33) });
    expect(r.basis).toBe("plan");
    expect(r.date).toBe(day(32));
    // Il riso non ha storico: l'esaurimento non è previsto.
    expect(r.firstRunout).toBeNull();
    expect(r.insufficientHistoryCount).toBe(1);
  });

  it("sceglie il più vicino tra esaurimento e piano", () => {
    const l = milkLedger();
    l.buy(28, "Latte", 1000, "ml");
    const r = recommendShoppingDay({
      today: day(28),
      pantry: l.pantry(),
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(30) }],
    });
    expect(r.basis).toBe("plan");
    expect(r.date).toBe(day(29));
    const same = recommendShoppingDay({
      today: day(28),
      pantry: l.pantry(),
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(35) }],
    });
    expect(same.basis).toBe("both");
  });

  it("anticipa al giorno di spesa abituale", () => {
    const l = ledger();
    l.buy(0, "Riso", 1000, "g");
    const input = {
      today: day(28), // giovedì 29 gennaio 2026
      pantry: l.pantry(),
      planNeeds: [{ product: "Riso", quantity: { value: 2000, unit: "g" as const }, date: day(33) }],
    };
    // Il piano scatta il 2 febbraio (lunedì), spesa il 1 febbraio (domenica).
    const sunday = recommendShoppingDay(input, { shoppingWeekdays: [0] });
    expect(sunday.date).toBe(day(31));
    expect(sunday.weekdayAdjusted).toBe(true);
    // Nessun martedì tra oggi e la data: resta la data calcolata.
    const tuesday = recommendShoppingDay(input, { shoppingWeekdays: [2] });
    expect(tuesday.date).toBe(day(32));
    expect(tuesday.weekdayAdjusted).toBe(false);
  });

  it("senza esaurimenti né piano non indica un giorno", () => {
    const r = recommendShoppingDay({ today: day(28), pantry: ledger().pantry() });
    expect(r).toMatchObject({ date: null, basis: "none", firstRunout: null, firstPlanShortfall: null });
    expect(() => recommendShoppingDay({ today: "oggi", pantry: ledger().pantry() })).toThrow();
  });

  it("ignora i prodotti fermi da tempo", () => {
    const l = ledger();
    const lot = l.buy(0, "Panettone", 500, "g");
    for (let d = 0; d < 5; d++) l.use(d, lot, 100, "g");
    expect(recommendShoppingDay({ today: day(40), pantry: l.pantry() }).date).toBeNull();
  });

  it("non dipende dall'ordine degli eventi", () => {
    const l = milkLedger();
    const input = {
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" as const }, date: day(31) }],
    };
    const reference = recommendShoppingDay({ today: day(28), pantry: l.pantry(), ...input });
    for (let seed = 1; seed <= 5; seed++) {
      const pantry = derivePantry(shuffled(l.events, seededRandom(seed)));
      expect(recommendShoppingDay({ today: day(28), pantry, ...input })).toEqual(reference);
    }
  });
});
