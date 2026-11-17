import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { findForecast, forecastConsumption, isIdle } from "./consumption";
import { day, ledger, milkLedger, seededRandom, shuffled } from "./test-helpers";

const TODAY = day(28);

describe("ritmo di consumo", () => {
  it("stima ritmo, intervallo, giorni di scorta e data di esaurimento", () => {
    const f = findForecast(forecastConsumption(milkLedger().pantry(), TODAY), "latte", "ml");
    expect(f?.sufficient).toBe(true);
    if (!f?.sufficient) return;
    expect(f.certainty).toBe("estimated");
    expect(f.observations).toBe(28);
    expect(f.spanDays).toBe(29);
    expect(f.stock).toBe(80);
    // 28 giorni da 140 ml su 29 giorni.
    expect(f.consumed.perDay).toBeCloseTo(3920 / 29, 6);
    expect(f.wastedPerDay).toBe(0);
    expect(f.consumed.low).toBeLessThanOrEqual(f.consumed.perDay);
    expect(f.consumed.high).toBeGreaterThanOrEqual(f.consumed.perDay);
    expect(f.daysLeft).toBeCloseTo(80 / (3920 / 29), 1);
    expect(f.runoutDate).toBe(TODAY);
    expect(f.daysLeftRange.min).toBeLessThanOrEqual(f.daysLeft);
    expect(f.daysLeftRange.max === null || f.daysLeftRange.max >= f.daysLeft).toBe(true);
    expect(f.lastOutflowDate).toBe(day(27));
  });

  it("dichiara storico insufficiente con poche osservazioni", () => {
    const l = ledger();
    const lot = l.buy(0, "Tonno", 400, "g");
    l.use(2, lot, 80, "g");
    l.use(9, lot, 80, "g");
    const f = forecastConsumption(l.pantry(), day(20))[0];
    expect(f.sufficient).toBe(false);
    if (f.sufficient) return;
    expect(f.reasons).toEqual(["few_observations"]);
    expect(f.observations).toBe(2);
    expect("daysLeft" in f).toBe(false);
  });

  it("dichiara storico insufficiente se il prodotto è troppo recente", () => {
    const l = ledger();
    const lot = l.buy(10, "Yogurt", 500, "g");
    for (let d = 10; d < 15; d++) l.use(d, lot, 50, "g");
    const f = forecastConsumption(l.pantry(), day(14))[0];
    expect(f.sufficient).toBe(false);
    if (f.sufficient) return;
    expect(f.reasons).toEqual(["short_history"]);
    expect(f.spanDays).toBe(5);
  });

  it("parte dal primo lotto: i giorni prima di avere il prodotto non contano", () => {
    const l = ledger();
    const lot = l.buy(20, "Burro", 1000, "g");
    for (let d = 20; d < 30; d++) l.use(d, lot, 20, "g");
    const f = forecastConsumption(l.pantry(), day(29))[0];
    expect(f.sufficient).toBe(true);
    if (!f.sufficient) return;
    expect(f.windowStart).toBe(day(20));
    expect(f.consumed.perDay).toBe(20);
    expect(f.consumed.low).toBe(20);
    expect(f.consumed.high).toBe(20);
  });

  it("conta gli scarti come uscite ma non i regali", () => {
    const l = ledger();
    const a = l.buy(0, "Insalata", 1000, "g");
    for (let d = 0; d < 8; d++) l.use(d, a, 50, "g");
    l.toss(8, a, 200, "g", "expired");
    l.give(9, a, 100, "g");
    const f = forecastConsumption(l.pantry(), day(10))[0];
    expect(f.sufficient).toBe(true);
    if (!f.sufficient) return;
    expect(f.observations).toBe(9);
    expect(f.consumed.perDay).toBeCloseTo(400 / 11, 6);
    expect(f.wastedPerDay).toBeCloseTo(200 / 11, 6);
    expect(f.outflow.perDay).toBeCloseTo(600 / 11, 6);
    expect(f.stock).toBe(300);
  });

  it("tiene separati i flussi in unità diverse dello stesso prodotto", () => {
    const l = ledger();
    const g = l.buy(0, "Pomodori", 2000, "g");
    const pz = l.buy(0, "Pomodori", 20, "pz");
    for (let d = 0; d < 10; d++) {
      l.use(d, g, 100, "g");
      l.use(d, pz, 1, "pz");
    }
    const all = forecastConsumption(l.pantry(), day(10));
    expect(all.map((f) => `${f.key}|${f.unit}`)).toEqual(["pomodori|g", "pomodori|pz"]);
    const fg = findForecast(all, "pomodori", "g");
    const fpz = findForecast(all, "pomodori", "pz");
    expect(fg?.sufficient && fg.consumed.perDay).toBeCloseTo(1000 / 11, 6);
    expect(fpz?.sufficient && fpz.consumed.perDay).toBeCloseTo(10 / 11, 6);
  });

  it("ignora le uscite fuori dalla finestra", () => {
    const l = ledger();
    const lot = l.buy(0, "Pane", 5000, "g");
    for (let d = 0; d < 5; d++) l.use(d, lot, 100, "g");
    for (let d = 70; d < 80; d++) l.use(d, lot, 100, "g");
    const f = forecastConsumption(l.pantry(), day(80), { windowDays: 30 })[0];
    expect(f.sufficient).toBe(true);
    if (!f.sufficient) return;
    expect(f.observations).toBe(10);
    expect(f.windowStart).toBe(day(51));
  });

  it("prodotto fermo: scorta finita e nessuna uscita recente", () => {
    const l = ledger();
    const lot = l.buy(0, "Panettone", 500, "g");
    for (let d = 0; d < 5; d++) l.use(d, lot, 100, "g");
    const f = forecastConsumption(l.pantry(), day(40))[0];
    expect(f.sufficient).toBe(true);
    if (!f.sufficient) return;
    expect(f.stock).toBe(0);
    expect(f.runoutDate).toBe(day(40));
    expect(isIdle(f, day(40), 21)).toBe(true);
    expect(isIdle(f, day(10), 21)).toBe(false);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const l = milkLedger();
    const reference = forecastConsumption(l.pantry(), TODAY);
    for (let seed = 1; seed <= 5; seed++) {
      const state = derivePantry(shuffled(l.events, seededRandom(seed)));
      expect(forecastConsumption(state, TODAY)).toEqual(reference);
    }
  });
});
