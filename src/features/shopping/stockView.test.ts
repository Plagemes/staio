import { describe, expect, it } from "vitest";
import { emptyStockConfig, setMinimum } from "@/core/shopping";
import { day, ledger, milkLedger } from "@/core/shopping/test-helpers";
import { stockRows } from "./stockView";

describe("scorte minime", () => {
  it("suggerisce la scorta dai consumi, da confermare, con l'intervallo", () => {
    const rows = stockRows(milkLedger().pantry(), emptyStockConfig(), day(28));
    const milk = rows.find((r) => r.name === "Latte");
    expect(milk?.suggestion?.needsConfirmation).toBe(true);
    expect(milk?.suggestionText).toMatch(/^Suggerita dai tuoi consumi: .* \(stima: tra .* e .*, 3 giorni di scorta/);
    expect(milk?.minimum).toBeUndefined();
  });

  it("dove lo storico non basta non mostra un numero", () => {
    const l = ledger();
    l.buy(0, "Farina", 1000, "g");
    l.buy(3, "Farina", 1000, "g");
    const rows = stockRows(l.pantry(), emptyStockConfig(), day(5));
    expect(rows[0].suggestion).toBeUndefined();
    expect(rows[0].suggestionText).toBeUndefined();
    expect(rows[0].noSuggestionText).toMatch(/^Non posso suggerirla/);
  });

  it("mostra la scorta impostata e include anche prodotti comprati una volta sola se hanno una scorta", () => {
    const l = ledger();
    l.buy(0, "Sale", 1000, "g");
    expect(stockRows(l.pantry(), emptyStockConfig(), day(5))).toHaveLength(0);
    const rows = stockRows(l.pantry(), setMinimum(emptyStockConfig(), "Sale", "g", 500), day(5));
    expect(rows).toHaveLength(1);
    expect(rows[0].minimumText).toBe("500 g");
  });
});
