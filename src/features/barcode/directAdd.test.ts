import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { buildCaptureEvents } from "../capture";
import { readCaptureParams } from "../captureParams";
import { confirmationText, draftFromProduct, estimatedExpiryDate, inputFromDraft, locationFor, missingFields } from "./directAdd";
import { captureHref } from "./links";

const FARFALLE: Product = {
  barcode: "8076800195057",
  name: "Farfalle n° 265",
  brand: "Barilla",
  quantity: { text: "500 g", value: 500, unit: "g" },
  categories: ["dried-pastas"],
  fetchedAt: "2026-11-17T08:00:00.000Z",
  source: "openfoodfacts",
};
const ctx = { now: "2026-11-17T08:00:00.000Z", deviceId: "d" };

describe("aggiunta diretta dalla scheda", () => {
  it("un prodotto completo non chiede niente e va in credenza", () => {
    const draft = draftFromProduct(FARFALLE);
    expect(missingFields(draft)).toEqual([]);
    expect(draft).toMatchObject({ name: "Farfalle n° 265", quantityText: "500 g", category: "pasta_dry", brand: "Barilla" });
    expect(locationFor(draft.category)).toBe("dispensa");

    const result = buildCaptureEvents(inputFromDraft(draft, locationFor(draft.category)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]).toMatchObject({ type: "purchase", source: "barcode", location: "dispensa", category: "pasta_dry" });
    expect(result.events[0]).not.toHaveProperty("expiry");
    expect(confirmationText(result.events[0], "2026-11-17")).toMatch(/^Aggiunto alla dispensa: Farfalle n° 265, 500 g, in credenza\. Scadenza stimata: /);
  });

  it("la quantità illeggibile viene chiesta, non inventata", () => {
    const draft = draftFromProduct({ ...FARFALLE, quantity: { text: "circa un po'" } });
    expect(missingFields(draft)).toEqual(["quantity"]);
    expect(buildCaptureEvents(inputFromDraft(draft, "dispensa"), ctx)).toMatchObject({ ok: false, errors: { quantity: expect.any(String) } });
    // risposta sulla scheda: solo quel dato, il resto resta com'è
    const answered = buildCaptureEvents(inputFromDraft(draft, "dispensa", { quantityText: "500 g" }), ctx);
    expect(answered.ok && answered.events[0]).toMatchObject({ quantity: { value: 500, unit: "g" }, productRef: "Farfalle n° 265", barcode: FARFALLE.barcode });
  });

  it("usa il valore in unità base quando il testo non si legge (6 x 125 g)", () => {
    const draft = draftFromProduct({ ...FARFALLE, quantity: { text: "6 x 125 g", value: 750, unit: "g", count: 6 } });
    expect(draft.quantityText).toBe("750 g");
    expect(missingFields(draft)).toEqual([]);
  });

  it("categoria non riconosciuta e nome assente: si chiedono, in ordine", () => {
    const draft = draftFromProduct({ ...FARFALLE, name: undefined, categories: ["en:boh"] });
    expect(missingFields(draft)).toEqual(["name", "category"]);
    const input = inputFromDraft(draft, "frigo", { name: "farfalle", category: "pasta_dry" });
    const result = buildCaptureEvents(input, ctx);
    expect(result.ok && result.events[0]).toMatchObject({ productRef: "Farfalle", category: "pasta_dry" });
  });

  it("data stampata e prezzo facoltativi finiscono nell'evento", () => {
    const draft = draftFromProduct(FARFALLE);
    const input = inputFromDraft(draft, "dispensa", { expiryKind: "best_before", expiryDate: "2027-03-01", priceText: "1,29" });
    const result = buildCaptureEvents(input, ctx);
    expect(result.ok && result.events[0]).toMatchObject({ expiry: { date: "2027-03-01", kind: "best_before" }, priceCents: 129 });
    expect(result.ok && confirmationText(result.events[0], "2026-11-17")).toContain("Scadenza: 1 mar 2027");
  });

  it("il luogo scelto sulla scheda vale più di quello predefinito", () => {
    const draft = draftFromProduct(FARFALLE);
    const result = buildCaptureEvents(inputFromDraft(draft, "freezer"), ctx);
    expect(result.ok && result.events[0]).toMatchObject({ location: "freezer" });
  });

  it("la scadenza stimata dipende da categoria e luogo", () => {
    expect(estimatedExpiryDate("pasta_dry", "dispensa", "2026-11-17")).toBe("2028-11-16");
    expect(estimatedExpiryDate(undefined, "frigo", "2026-11-17")).toBeNull();
  });
});

describe("modifica prima di aggiungere", () => {
  it("il collegamento al modulo riporta gli stessi dati letti dal precompilato", () => {
    const href = captureHref(FARFALLE);
    const params = new URL(href, "https://staio.test").searchParams;
    expect(readCaptureParams((k) => params.get(k))).toEqual({
      name: "Farfalle n° 265",
      quantityText: "500 g",
      category: "pasta_dry",
      barcode: "8076800195057",
      brand: "Barilla",
    });
  });
});
