import { describe, expect, it } from "vitest";
import { DIET_SECTIONS, parseDietSection } from "./dietSection";

describe("?sezione=", () => {
  it("le tre righe si riconoscono", () => {
    expect(DIET_SECTIONS).toEqual(["obiettivi", "pasti", "conferme"]);
    for (const s of DIET_SECTIONS) expect(parseDietSection(s)).toBe(s);
  });

  it("tutto il resto non apre niente", () => {
    for (const v of [null, undefined, "", "allergeni", "Conferme", "conferme ", "__proto__", "constructor"]) expect(parseDietSection(v), String(v)).toBeNull();
  });
});
