import { describe, expect, it } from "vitest";
import { forecastConsumption } from "./consumption";
import {
  belowMinimum,
  emptyStockConfig,
  removeMinimum,
  setMinimum,
  suggestMinimum,
  suggestMinimums,
} from "./stock";
import { day, ledger, milkLedger } from "./test-helpers";

describe("scorte minime", () => {
  it("imposta e rimuove senza modificare la configurazione di partenza", () => {
    const empty = emptyStockConfig();
    const c1 = setMinimum(empty, "Latte ", "ml", 500);
    const c2 = setMinimum(c1, "latte", "ml", 800);
    expect(empty.minimums).toHaveLength(0);
    expect(c1.minimums[0].minimum).toBe(500);
    expect(c2.minimums).toHaveLength(1);
    expect(c2.minimums[0]).toMatchObject({ key: "latte", unit: "ml", minimum: 800 });
    expect(removeMinimum(c2, "LATTE", "ml").minimums).toHaveLength(0);
    expect(() => setMinimum(empty, "  ", "g", 10)).toThrow();
    expect(() => setMinimum(empty, "riso", "g", 0)).toThrow();
  });

  it("suggerisce una scorta minima dai consumi, sempre da confermare", () => {
    const [f] = forecastConsumption(milkLedger().pantry(), day(28));
    const s = suggestMinimum(f);
    expect(s).not.toBeNull();
    // ~135 ml/giorno per 3 giorni di riserva, arrotondati per eccesso a 50 ml.
    expect(s?.suggested).toBe(450);
    expect(s?.needsConfirmation).toBe(true);
    expect(s?.certainty).toBe("estimated");
    expect(s?.suggestedRange.low).toBeLessThanOrEqual(s?.suggested ?? 0);
    expect(s?.suggestedRange.high).toBeGreaterThanOrEqual(s?.suggested ?? 0);
    expect(s?.basis.reserveDays).toBe(3);
  });

  it("non suggerisce nulla con storico insufficiente", () => {
    const l = ledger();
    const lot = l.buy(0, "Tonno", 400, "g");
    l.use(2, lot, 80, "g");
    const [f] = forecastConsumption(l.pantry(), day(10));
    expect(suggestMinimum(f)).toBeNull();
  });

  it("non ripropone i prodotti con una scorta minima già impostata", () => {
    const forecasts = forecastConsumption(milkLedger().pantry(), day(28));
    expect(suggestMinimums(forecasts, emptyStockConfig())).toHaveLength(1);
    const cfg = setMinimum(emptyStockConfig(), "latte", "ml", 500);
    expect(suggestMinimums(forecasts, cfg)).toHaveLength(0);
  });

  it("segnala i prodotti sotto la scorta minima, anche quelli assenti dalla dispensa", () => {
    const l = ledger();
    l.buy(0, "Riso", 300, "g");
    l.buy(0, "Latte", 2000, "ml");
    let cfg = setMinimum(emptyStockConfig(), "Riso", "g", 500);
    cfg = setMinimum(cfg, "Latte", "ml", 1000);
    cfg = setMinimum(cfg, "Sale", "g", 200);
    const below = belowMinimum(cfg, l.pantry(), day(5));
    expect(below.map((b) => [b.key, b.stock, b.missing])).toEqual([
      ["riso", 300, 200],
      ["sale", 0, 200],
    ]);
  });

  it("non conta come scorta ciò che è scaduto da consumare entro", () => {
    const l = ledger();
    l.buy(0, "Pollo", 500, "g", { expiryDay: 3 });
    const cfg = setMinimum(emptyStockConfig(), "Pollo", "g", 300);
    expect(belowMinimum(cfg, l.pantry(), day(2))).toHaveLength(0);
    // best_before scaduto resta utilizzabile, use_by no: qui la scadenza è best_before.
    expect(belowMinimum(cfg, l.pantry(), day(10))).toHaveLength(0);
  });
});
