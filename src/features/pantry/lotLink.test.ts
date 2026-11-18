import { describe, expect, it } from "vitest";
import { LOT_WAIT_MS, lotLinkVerdict } from "./lotLink";

describe("lotLinkVerdict", () => {
  it("l'alimento che c'è si apre, subito o dopo l'attesa", () => {
    expect(lotLinkVerdict({ found: true, stateChanged: false, waitedMs: 0 })).toBe("show");
    expect(lotLinkVerdict({ found: true, stateChanged: true, waitedMs: 0 })).toBe("show");
    expect(lotLinkVerdict({ found: true, stateChanged: false, waitedMs: LOT_WAIT_MS * 3 })).toBe("show");
  });

  it("subito dopo un salvataggio la dispensa può essere quella di prima: non si dice niente e si aspetta", () => {
    expect(lotLinkVerdict({ found: false, stateChanged: false, waitedMs: 0 })).toBe("wait");
    expect(lotLinkVerdict({ found: false, stateChanged: false, waitedMs: LOT_WAIT_MS - 1 })).toBe("wait");
  });

  it("manca ancora nello stato dopo, o passata l'attesa: non c'è più", () => {
    expect(lotLinkVerdict({ found: false, stateChanged: true, waitedMs: 0 })).toBe("gone");
    expect(lotLinkVerdict({ found: false, stateChanged: false, waitedMs: LOT_WAIT_MS })).toBe("gone");
  });

  it("la sequenza di «Vedi» dopo un salvataggio: prima lo stato vecchio, poi quello con l'alimento", () => {
    const states = [
      { found: false, stateChanged: false, waitedMs: 0 },
      { found: true, stateChanged: true, waitedMs: 40 },
    ];
    expect(states.map(lotLinkVerdict)).toEqual(["wait", "show"]);
  });
});
