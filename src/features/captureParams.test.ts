import { describe, expect, it } from "vitest";
import { createIdGenerator, derivePantry } from "@/core/ledger";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import { captureParamsKey, mergeCaptureParams, readCaptureParams, resolveCaptureFields } from "./captureParams";

const from = (query: string) => {
  const p = new URLSearchParams(query);
  return readCaptureParams((k) => p.get(k));
};

describe("readCaptureParams", () => {
  it("legge tutti i parametri", () => {
    expect(from("nome=Latte%20intero&quantita=1%20l&categoria=milk_fresh&barcode=8001234567890&marca=Granarolo")).toEqual({
      name: "Latte intero",
      quantityText: "1 l",
      category: "milk_fresh",
      barcode: "8001234567890",
      brand: "Granarolo",
    });
  });

  it("senza parametri non c'è niente", () => {
    expect(from("")).toEqual({});
  });

  it("scarta categorie e codici non validi", () => {
    expect(from("categoria=boh&barcode=abc&nome=%20%20")).toEqual({});
    expect(from("barcode=123")).toEqual({});
    expect(from("barcode=1234567")).toEqual({});
  });

  it("taglia i testi troppo lunghi", () => {
    expect(from(`nome=${"a".repeat(500)}`).name).toHaveLength(120);
  });
});

describe("cattura da codice a barre", () => {
  const input: CaptureInput = {
    name: "Latte intero",
    quantityText: "1 l",
    location: "frigo",
    category: "milk_fresh",
    expiryKind: "none",
    expiryDate: "",
    priceText: "",
    alreadyHave: false,
    barcode: "8001234567890",
    brand: "Granarolo",
  };
  const ctx = { now: "2026-11-16T10:00:00.000Z", deviceId: "d", idGenerator: createIdGenerator({ now: () => 1, random: () => 0.5 }) };

  it("scrive fonte barcode, certezza label, il codice nel campo e la marca nella nota", () => {
    const r = buildCaptureEvents(input, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events[0]).toMatchObject({
      type: "purchase",
      source: "barcode",
      certainty: "label",
      barcode: "8001234567890",
      note: "Marca: Granarolo",
    });
    expect(r.events[0].note).not.toMatch(/Codice a barre/);
    expect(derivePantry(r.events).lots[0].barcode).toBe("8001234567890");
    expect(derivePantry(r.events).lots).toHaveLength(1);
  });

  it("anche «già in casa» da codice a barre vale come letto in etichetta", () => {
    const r = buildCaptureEvents({ ...input, alreadyHave: true }, ctx);
    expect(r.ok && r.events[0]).toMatchObject({ type: "declare", source: "barcode", certainty: "label" });
  });

  it("senza codice resta manuale", () => {
    const r = buildCaptureEvents({ ...input, barcode: undefined, brand: undefined }, ctx);
    expect(r.ok && r.events[0]).toMatchObject({ source: "manual" });
    expect(r.ok && r.events[0]).not.toHaveProperty("note");
    expect(r.ok && r.events[0]).not.toHaveProperty("barcode");
  });

  it("un codice non valido non diventa un campo né cambia la fonte", () => {
    const r = buildCaptureEvents({ ...input, barcode: "123" }, ctx);
    expect(r.ok && r.events[0]).toMatchObject({ source: "manual" });
    expect(r.ok && r.events[0]).not.toHaveProperty("barcode");
  });
});

describe("precompilato robusto", () => {
  const arrived = from("nome=Farfalle%20n%C2%B0%20265&quantita=500%20g&categoria=pasta_dry&barcode=8076800195057&marca=Barilla");

  it("i parametri che arrivano dopo il primo disegno riempiono i campi (con una lettura sola restava tutto vuoto)", () => {
    const first = resolveCaptureFields(from(""), {});
    expect(first).toMatchObject({ name: "", quantityText: "", barcode: undefined });
    // difetto di prima: il primo valore veniva tenuto per sempre
    const later = resolveCaptureFields(arrived, {});
    expect(later).toMatchObject({ name: "Farfalle n° 265", quantityText: "500 g", category: "pasta_dry", barcode: "8076800195057", brand: "Barilla" });
  });

  it("non sovrascrive ciò che l'utente ha già scritto", () => {
    const fields = resolveCaptureFields(arrived, { name: "Le mie farfalle", quantityText: "" });
    expect(fields.name).toBe("Le mie farfalle");
    expect(fields.quantityText).toBe("");
    expect(fields.category).toBe("pasta_dry");
  });

  it("scollegare il codice vale anche se i parametri restano", () => {
    expect(resolveCaptureFields(arrived, { barcode: null, brand: null })).toMatchObject({ barcode: undefined, brand: undefined });
  });

  it("l'indirizzo reale del browser riempie i campi quando useSearchParams non li ha", () => {
    const merged = mergeCaptureParams(from(""), from("nome=Latte&barcode=8001234567890"));
    expect(merged).toEqual({ name: "Latte", barcode: "8001234567890" });
    expect(mergeCaptureParams(from("nome=Pane"), from("nome=Latte&quantita=1%20l"))).toEqual({ name: "Pane", quantityText: "1 l" });
  });

  it("la chiave cambia quando cambiano i parametri", () => {
    expect(captureParamsKey(arrived)).not.toBe(captureParamsKey(from("")));
    expect(captureParamsKey(arrived)).toBe(captureParamsKey({ ...arrived }));
  });
});
