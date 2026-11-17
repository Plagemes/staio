import { describe, expect, it } from "vitest";
import { isLocalCode, isLocalProduct, isRestrictedCode, needsStoreCodeConfirmation } from "./restrictedCode";

describe("isRestrictedCode", () => {
  it("i prefissi 20-29 sono a circolazione ristretta", () => {
    for (const code of ["2000000000015", "2100000000008", "2999999999993", "2012345678905"]) expect(isRestrictedCode(code)).toBe(true);
  });
  it("anche 02 e 04, e gli UPC-A che cominciano per 2 o 4", () => {
    expect(isRestrictedCode("0212345678905")).toBe(true);
    expect(isRestrictedCode("0412345678904")).toBe(true);
    expect(isRestrictedCode("212345678904")).toBe(true);
    expect(isRestrictedCode("412345678904")).toBe(true);
  });
  it("i prodotti normali no", () => {
    for (const code of ["8076800195057", "5449000000996", "3017620422003", "012345678905", "737628064502"]) expect(isRestrictedCode(code)).toBe(false);
  });
  it("non è un codice: non è ristretto", () => {
    expect(isRestrictedCode("")).toBe(false);
    expect(isRestrictedCode("abc")).toBe(false);
  });
});

describe("isLocalCode", () => {
  it("13 cifre col prefisso 299", () => {
    expect(isLocalCode("2991234567893")).toBe(true);
    expect(isLocalCode("2981234567893")).toBe(false);
    expect(isLocalCode("299123456789")).toBe(false);
    expect(isRestrictedCode("2991234567893")).toBe(true);
  });
});

describe("isLocalProduct", () => {
  it("lo dice la scheda, non il prefisso", () => {
    expect(isLocalProduct({ localFromName: true })).toBe(true);
    expect(isLocalProduct({})).toBe(false);
    expect(isLocalProduct(undefined)).toBe(false);
  });
});

describe("needsStoreCodeConfirmation", () => {
  const user = (barcode: string, extra: { localFromName?: true } = {}) => ({ barcode, source: "manual", ...extra });
  it("un codice interno con la scheda dell'utente va confermato a ogni lettura", () => {
    expect(needsStoreCodeConfirmation(user("2000000012345"))).toBe(true);
    expect(needsStoreCodeConfirmation({ barcode: "2000000012345", source: "label_photo" })).toBe(true);
    // anche un 299 letto in negozio, se non è una scheda creata dal nome
    expect(needsStoreCodeConfirmation(user("2991234567893"))).toBe(true);
  });
  it("non serve per le schede create dal nome, per i codici normali, né per Open Food Facts (che ha un altro avviso)", () => {
    expect(needsStoreCodeConfirmation(user("2991234567893", { localFromName: true }))).toBe(false);
    expect(needsStoreCodeConfirmation(user("8076800195057"))).toBe(false);
    expect(needsStoreCodeConfirmation({ barcode: "2000000012345", source: "openfoodfacts" })).toBe(false);
  });
});
