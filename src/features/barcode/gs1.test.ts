import { describe, expect, it } from "vitest";
import { gtinToRetailCode, parseGs1, parseGs1Date } from "./gs1";

// GTIN-14 con cifra di controllo valida: 0 + EAN-13 8076800195057
const GTIN = "08076800195057";
const GS = "\u001d";

describe("data GS1 AAMMGG", () => {
  it("legge le date e il giorno 00 come fine mese", () => {
    expect(parseGs1Date("261120")).toBe("2026-11-20");
    expect(parseGs1Date("260200")).toBe("2026-02-28");
    expect(parseGs1Date("280200")).toBe("2028-02-29");
    expect(parseGs1Date("261200")).toBe("2026-12-31");
  });

  it("scarta le date impossibili o malformate", () => {
    expect(parseGs1Date("261301")).toBeNull();
    expect(parseGs1Date("260230")).toBeNull();
    expect(parseGs1Date("26112")).toBeNull();
    expect(parseGs1Date("26ab20")).toBeNull();
    expect(parseGs1Date("")).toBeNull();
  });
});

describe("codice GS1", () => {
  it("con le parentesi", () => {
    expect(parseGs1(`(01)${GTIN}(17)261120(10)LOTTO1`)).toEqual({ gtin: GTIN, expiry: { date: "2026-11-20", kind: "use_by" } });
  });

  it("senza parentesi e senza separatori", () => {
    expect(parseGs1(`01${GTIN}17261120`)).toEqual({ gtin: GTIN, expiry: { date: "2026-11-20", kind: "use_by" } });
    expect(parseGs1(`01${GTIN}15261120`)).toEqual({ gtin: GTIN, expiry: { date: "2026-11-20", kind: "best_before" } });
  });

  it("con il separatore FNC1 dopo un campo variabile e l'identificatore di simbologia", () => {
    expect(parseGs1(`]d201${GTIN}10AB12${GS}17261120`)).toEqual({ gtin: GTIN, expiry: { date: "2026-11-20", kind: "use_by" } });
    expect(parseGs1(`]C101${GTIN}17260200${GS}21XYZ`)).toEqual({ gtin: GTIN, expiry: { date: "2026-02-28", kind: "use_by" } });
  });

  it("se ci sono (17) e (15) vince la scadenza", () => {
    expect(parseGs1(`(01)${GTIN}(15)270101(17)261120`)?.expiry).toEqual({ date: "2026-11-20", kind: "use_by" });
  });

  it("senza data legge comunque il GTIN", () => {
    expect(parseGs1(`(01)${GTIN}`)).toEqual({ gtin: GTIN });
  });

  it("stringhe malformate o non GS1 danno null", () => {
    expect(parseGs1("8076800195057")).toBeNull();
    expect(parseGs1("96385074")).toBeNull();
    expect(parseGs1("")).toBeNull();
    expect(parseGs1("(01)123")).toBeNull();
    expect(parseGs1(`01${GTIN}17261`)).toBeNull();
    expect(parseGs1("(17)261399")).toBeNull();
    expect(parseGs1("ciao (17)261120")).toBeNull();
    expect(parseGs1("(01)08076800195058")).toBeNull();
  });

  it("GTIN-14 verso codice di vendita", () => {
    expect(gtinToRetailCode(GTIN)).toBe("8076800195057");
    expect(gtinToRetailCode("18076800195054")).toBeNull();
  });
});
