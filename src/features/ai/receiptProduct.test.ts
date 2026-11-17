import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { codeLabel, codeOnlyPatch, linkedProductText, linkPatch, needsConfirmation, unlinkPatch } from "./receiptProduct";

const MILK: Product = {
  barcode: "8001120974504",
  name: "Latte parzialmente scremato",
  brand: "Granarolo",
  quantity: { text: "1 l", value: 1000, unit: "ml" },
  categories: ["milks", "uht-milks"],
  daysAfterOpening: 3,
  fetchedAt: "2026-11-17T08:00:00.000Z",
  source: "openfoodfacts",
};

describe("riga collegata a un prodotto", () => {
  it("prende nome vero, quantità della confezione, categoria e codice", () => {
    const patch = linkPatch(MILK);
    expect(patch).toMatchObject({
      include: true,
      barcode: "8001120974504",
      name: "Latte parzialmente scremato",
      productLabel: "Latte parzialmente scremato · Granarolo",
      daysAfterOpening: 3,
      quantityGuessed: false,
    });
    expect(patch.quantityText).toMatch(/1\s?l|1000\s?ml/);
    expect(patch.category).toBeTruthy();
  });

  it("lascia com'è ciò che il prodotto non dice", () => {
    const patch = linkPatch({ barcode: "8001120974504", fetchedAt: "2026-11-17T08:00:00.000Z", source: "openfoodfacts" });
    expect(patch).not.toHaveProperty("name");
    expect(patch).not.toHaveProperty("quantityText");
    expect(patch).not.toHaveProperty("category");
    expect(patch.productLabel).toBe("Codice 8001120974504");
  });

  it("un codice sconosciuto resta comunque sulla riga, e si può scollegare", () => {
    expect(codeOnlyPatch("8001120974504")).toMatchObject({ barcode: "8001120974504", include: true });
    expect(unlinkPatch()).toEqual({ barcode: undefined, productLabel: undefined, daysAfterOpening: undefined });
  });
});

describe("codici nelle righe dello scontrino", () => {
  const LOCAL: Product = { ...MILK, barcode: "2990000012345", name: "Pane di casa", source: "manual", localFromName: true };
  it("un prodotto locale non mostra il codice come codice a barre", () => {
    const patch = linkPatch(LOCAL);
    expect(patch.localProduct).toBe(true);
    expect(linkedProductText({ barcode: LOCAL.barcode, localProduct: true, productLabel: "Pane di casa" })).toBe("Prodotto: Pane di casa");
    expect(linkedProductText({ barcode: LOCAL.barcode, localProduct: true })).not.toContain("2990000012345");
    expect(codeLabel("2990000012345", true)).not.toContain("2990000012345");
  });
  it("un vero codice si mostra; senza la scheda, un codice con forma locale no", () => {
    expect(linkedProductText({ barcode: "8001120974504", productLabel: "Latte" })).toBe("Prodotto: Latte (8001120974504)");
    expect(linkedProductText({ barcode: "2990000099999", productLabel: "Salume" })).toBe("Prodotto: Salume");
    expect(linkedProductText({ barcode: "2012345000000", productLabel: "Salume" })).toContain("2012345000000");
  });
  it("un codice interno del negozio chiede conferma, qualunque sia l'origine della scheda", () => {
    expect(needsConfirmation({ ...MILK, barcode: "2012345000000" })).toBe(true);
    expect(needsConfirmation({ ...MILK, barcode: "2012345000000", source: "manual" })).toBe(true);
    expect(needsConfirmation({ ...MILK, barcode: "2990000099999", source: "manual" })).toBe(true);
    expect(needsConfirmation(LOCAL)).toBe(false);
    expect(needsConfirmation(MILK)).toBe(false);
  });
});
