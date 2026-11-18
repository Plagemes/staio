import { describe, expect, it } from "vitest";
import { inputsChanged, shouldRedoStart } from "./startProposal";

describe("inputsChanged", () => {
  it("guarda l'identità: gli stessi oggetti non sono un cambiamento, un oggetto nuovo sì", () => {
    const entries = [{ lotId: "a" }];
    const overrides = {};
    expect(inputsChanged([entries, overrides, undefined], [entries, overrides, undefined])).toBe(false);
    expect(inputsChanged([entries, overrides, undefined], [[...entries], overrides, undefined])).toBe(true);
    // la tabella degli alimenti che arriva dopo il montaggio
    expect(inputsChanged([entries, overrides, undefined], [entries, overrides, []])).toBe(true);
    expect(inputsChanged([entries], [entries, overrides])).toBe(true);
  });
});

describe("shouldRedoStart", () => {
  it("con dati nuovi, appena aperto e non toccato: si rifà", () => {
    expect(shouldRedoStart({ changed: true, touched: false, settled: false })).toBe(true);
  });

  it("ciò che l'utente ha già toccato non si riscrive", () => {
    expect(shouldRedoStart({ changed: true, touched: true, settled: false })).toBe(false);
  });

  it("passato il tempo la proposta resta quella, anche se la dispensa cambia", () => {
    expect(shouldRedoStart({ changed: true, touched: false, settled: true })).toBe(false);
  });

  it("senza dati nuovi non si rifà niente", () => {
    expect(shouldRedoStart({ changed: false, touched: false, settled: false })).toBe(false);
  });
});
