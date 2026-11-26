import { describe, expect, it } from "vitest";
import { HINTS, hintKey, hintVerdict, isHintSeen, type HintState } from "./hints";

const fresh: HintState = { loading: false, failed: false, stored: undefined, latched: false, closed: false, expired: false };

describe("catalogo", () => {
  it("la chiave nelle impostazioni è hint.<id>", () => {
    expect(hintKey("add")).toBe("hint.add");
    expect(hintKey("pantryRow")).toBe("hint.pantryRow");
  });
  it("i testi sono di una riga, senza nome dell'app", () => {
    expect(Object.keys(HINTS).sort()).toEqual(["add", "diaryRow", "pantryRow", "shoppingRow"]);
    for (const text of Object.values(HINTS)) {
      expect(text.length).toBeLessThanOrEqual(80);
      expect(text).not.toContain("\n");
    }
  });
});

describe("hintVerdict", () => {
  it("la prima volta lo mostra e lo segna", () => {
    expect(hintVerdict(fresh)).toBe("first");
  });
  it("già visto in una visita precedente: non c'è più", () => {
    expect(hintVerdict({ ...fresh, stored: "2026-11-26" })).toBe("none");
  });
  it("nella visita in cui è stato segnato resta, anche se ormai risulta visto", () => {
    expect(hintVerdict({ ...fresh, stored: "2026-11-26", latched: true })).toBe("keep");
  });
  it("«Chiudi» lo toglie subito", () => {
    expect(hintVerdict({ ...fresh, stored: "2026-11-26", latched: true, closed: true })).toBe("none");
  });
  it("lasciata la schermata, alla visita dopo non c'è più", () => {
    expect(hintVerdict({ ...fresh, stored: "2026-11-26", latched: true, expired: true })).toBe("none");
  });
  it("finché le impostazioni non sono lette, niente (mai un lampo); se la lettura fallisce, niente", () => {
    expect(hintVerdict({ ...fresh, loading: true })).toBe("none");
    expect(hintVerdict({ ...fresh, failed: true })).toBe("none");
  });
  it("un valore salvato vuoto o di altro tipo non vale «visto»", () => {
    expect(isHintSeen("")).toBe(false);
    expect(isHintSeen(true)).toBe(false);
    expect(isHintSeen(undefined)).toBe(false);
    expect(isHintSeen("2026-11-26")).toBe(true);
    expect(hintVerdict({ ...fresh, stored: "" })).toBe("first");
  });
});
