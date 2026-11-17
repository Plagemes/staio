import { describe, expect, it } from "vitest";
import { OFF_FIELDS, parsePeriodAfterOpening, productFromOpenFoodFacts } from "./index";

const NOW = "2026-11-17T08:00:00.000Z";
const read = (product: Record<string, unknown>) => productFromOpenFoodFacts({ code: "8076800195057", status: 1, product }, { fetchedAt: NOW });

describe("campi di sicurezza di Open Food Facts", () => {
  it("li chiede all'API, senza la data di scadenza", () => {
    for (const f of ["allergens_tags", "traces_tags", "ingredients_text_it", "ingredients_text", "periods_after_opening"]) expect(OFF_FIELDS).toContain(f);
    expect(OFF_FIELDS).not.toContain("expiration_date");
  });

  it("legge allergeni, tracce e ingredienti in italiano", () => {
    const p = read({
      allergens_tags: ["en:milk", "en:gluten"],
      traces_tags: ["en:soybeans", "en:nuts"],
      ingredients_text_it: " Farina, latte, sale ",
      ingredients_text: "Flour, milk, salt",
      lang: "en",
    });
    expect(p).toMatchObject({ allergens: ["milk", "gluten"], traces: ["soybeans", "nuts"], ingredientsText: "Farina, latte, sale", ingredientsLang: "it" });
  });

  it("senza l'italiano usa il testo del prodotto e la sua lingua", () => {
    expect(read({ ingredients_text: "Zucker, Milch", lang: "de" })).toMatchObject({ ingredientsText: "Zucker, Milch", ingredientsLang: "de" });
    expect(read({ ingredients_text: "Zucker, Milch" })).not.toHaveProperty("ingredientsLang");
    expect(read({ ingredients_text: "Zucchero, latte", lang: "it-IT" })).toMatchObject({ ingredientsLang: "it" });
    expect(read({ ingredients_text: "Zucker", lang: "<script>" })).not.toHaveProperty("ingredientsLang");
  });

  it("i tag sconosciuti restano come testo; i segnaposto no", () => {
    const p = read({ allergens_tags: ["fr:lait", "en:none", "en:Kiwi", 4, null, ""], traces_tags: "en:milk" });
    expect(p?.allergens).toEqual(["lait", "kiwi"]);
    expect(p).not.toHaveProperty("traces");
  });

  it("dati assenti o sbagliati: i campi restano assenti", () => {
    const p = read({ product_name: "X", ingredients_text_it: 42, ingredients_text: "   ", allergens_tags: {}, periods_after_opening: ["12 M"] });
    expect(p).not.toHaveProperty("ingredientsText");
    expect(p).not.toHaveProperty("allergens");
    expect(p).not.toHaveProperty("daysAfterOpening");
  });

  it("espone i giorni dopo l'apertura solo se interpretabili", () => {
    expect(read({ periods_after_opening: "12 M" })?.daysAfterOpening).toBe(365);
    expect(read({ periods_after_opening: "boh" })).not.toHaveProperty("daysAfterOpening");
  });

  it("limita la lunghezza del testo degli ingredienti e segna il taglio", () => {
    const cut = read({ ingredients_text_it: "a".repeat(10_000) });
    expect(cut?.ingredientsText).toHaveLength(4000);
    expect(cut?.ingredientsTruncated).toBe(true);
    const whole = read({ ingredients_text_it: "a".repeat(4000) });
    expect(whole?.ingredientsText).toHaveLength(4000);
    expect(whole).not.toHaveProperty("ingredientsTruncated");
  });
});

describe("parsePeriodAfterOpening", () => {
  it("interpreta mesi, anni, settimane e giorni", () => {
    expect(parsePeriodAfterOpening("12 M")).toBe(365);
    expect(parsePeriodAfterOpening("12M")).toBe(365);
    expect(parsePeriodAfterOpening("6 months")).toBe(183);
    expect(parsePeriodAfterOpening("3 mois")).toBe(91);
    expect(parsePeriodAfterOpening("1 anno")).toBe(365);
    expect(parsePeriodAfterOpening("2 years")).toBe(730);
    expect(parsePeriodAfterOpening("2 settimane")).toBe(14);
    expect(parsePeriodAfterOpening("30 days")).toBe(30);
    expect(parsePeriodAfterOpening("1,5 months")).toBe(46);
  });

  it("rifiuta ciò che non si capisce", () => {
    for (const v of ["", "12", "M", "12 parsec", "-3 months", "0 days", "9999 years", "tra 12 mesi", undefined, null, 12, {}]) {
      expect(parsePeriodAfterOpening(v)).toBeUndefined();
    }
  });
});
