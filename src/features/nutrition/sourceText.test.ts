import { describe, expect, it } from "vitest";
import { labelSourceText } from "./sourceText";

describe("fonte dei valori d'etichetta", () => {
  it("cita il codice solo se è un vero codice a barre", () => {
    expect(labelSourceText("8076800195057")).toContain("codice a barre 8076800195057");
  });
  it("non mostra un codice locale come codice a barre", () => {
    const text = labelSourceText("2990000012345", { localFromName: true });
    expect(text).toBe("Valori inseriti da te.");
    expect(text).not.toContain("2990000012345");
  });
  it("un 299 senza scheda locale vale come codice interno del negozio", () => {
    expect(labelSourceText("2990000099999")).toContain("può non corrispondere");
  });
  it("per un codice interno del negozio avverte che può non corrispondere", () => {
    expect(labelSourceText("2012345000000")).toContain("può non corrispondere");
  });
});
