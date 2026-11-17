import { describe, expect, it } from "vitest";
import { isStoredProduct } from "./openFoodFacts";
import { applyLabelValues, hasFullNutrients, keepLabelValues } from "./labelValues";
import type { Nutrients, Product } from "./types";

const NOW = "2026-11-17T10:00:00.000Z";
const NUTRIENTS: Nutrients = { per: "100g", certainty: "label", energyKcal: 535, fat: 31, carbohydrates: 57, proteins: 6.5 };
const OFF: Product = {
  barcode: "8000000000017",
  name: "Cioccolato",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  source: "openfoodfacts",
  safetyFields: true,
  allergens: ["milk"],
  ingredientsText: "zucchero, cacao",
  ingredientsLang: "it",
};

describe("applyLabelValues", () => {
  it("su un prodotto sconosciuto nasce una scheda solo col codice, dichiarata come da foto", () => {
    const p = applyLabelValues(undefined, "8000000000017", { nutrients: NUTRIENTS, name: "Cioccolato" }, NOW);
    expect(p).toMatchObject({ barcode: "8000000000017", source: "label_photo", name: "Cioccolato", nutrients: NUTRIENTS });
    expect(p.labelPhoto).toEqual({ readAt: NOW, by: "photo", nutrients: true, name: true });
    expect(isStoredProduct(p)).toBe(true);
  });
  it("i valori nutrizionali hanno certezza label e il prodotto passa a «ha i valori»", () => {
    const p = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS }, NOW);
    expect(p.nutrients?.certainty).toBe("label");
    expect(hasFullNutrients(p)).toBe(true);
    expect(hasFullNutrients(OFF)).toBe(false);
    expect(hasFullNutrients({ nutrients: { per: "100g", certainty: "label", energyKcal: 10 } })).toBe(false);
  });
  it("non tocca la scheda di partenza e non cambia il nome che c'è già", () => {
    const p = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS, name: "Altro nome" }, NOW);
    expect(OFF.nutrients).toBeUndefined();
    expect(p.name).toBe("Cioccolato");
    expect(p.labelPhoto?.name).toBeUndefined();
  });
  it("gli ingredienti letti sostituiscono quelli mancanti e rendono la scheda completa per il controllo allergeni", () => {
    const p = applyLabelValues({ barcode: "1", fetchedAt: "x", source: "label_photo" }, "1", { ingredientsText: "farina, latte", ingredientsLang: "it", ingredientsComplete: true }, NOW);
    expect(p).toMatchObject({ ingredientsText: "farina, latte", ingredientsLang: "it", safetyFields: true });
    expect(p.ingredientsTruncated).toBeUndefined();
    expect(p.labelPhoto?.ingredients).toBe(true);
  });
  it("senza la conferma dell'utente l'elenco resta parziale (il controllo dirà «incerto»)", () => {
    const unconfirmed = applyLabelValues(OFF, OFF.barcode, { ingredientsText: "farina, latte", ingredientsLang: "it" }, NOW);
    expect(unconfirmed.ingredientsTruncated).toBe(true);
    const confirmed = applyLabelValues(OFF, OFF.barcode, { ingredientsText: "farina, latte", ingredientsLang: "it", ingredientsComplete: true }, NOW);
    expect(confirmed.ingredientsTruncated).toBeUndefined();
    // e una rilettura dal servizio non lo cambia
    expect(keepLabelValues({ ...OFF, ingredientsText: "altro" }, unconfirmed).ingredientsTruncated).toBe(true);
    expect(keepLabelValues({ ...OFF, ingredientsText: "altro", ingredientsTruncated: true }, confirmed).ingredientsTruncated).toBeUndefined();
  });
  it("allergeni e tracce si sommano: dalla foto non si toglie un allergene dichiarato", () => {
    const p = applyLabelValues(OFF, OFF.barcode, { allergens: ["soybeans", "milk"], traces: ["nuts"] }, NOW);
    expect(p.allergens).toEqual(["milk", "soybeans"]);
    expect(p.traces).toEqual(["nuts"]);
    expect(p.labelPhoto?.allergens).toBe(true);
  });
  it("niente da applicare: la scheda resta com'è, con il marchio della lettura", () => {
    const p = applyLabelValues(OFF, OFF.barcode, {}, NOW);
    expect(p.nutrients).toBeUndefined();
    expect(p.ingredientsText).toBe(OFF.ingredientsText);
  });
});

describe("valori scritti a mano", () => {
  it("su un codice sconosciuto la scheda nasce come «inserita da te»", () => {
    const p = applyLabelValues(undefined, "2991234567893", { nutrients: NUTRIENTS, name: "Pane di casa" }, NOW, "manual");
    expect(p).toMatchObject({ source: "manual", name: "Pane di casa", nutrients: NUTRIENTS });
    expect(p.labelPhoto).toEqual({ readAt: NOW, by: "manual", nutrients: true, name: true });
    expect(isStoredProduct(p)).toBe(true);
  });
  it("su una scheda di Open Food Facts senza valori, li aggiunge e non cambia la fonte", () => {
    const p = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS }, NOW, "manual");
    expect(p.source).toBe("openfoodfacts");
    expect(p.labelPhoto?.by).toBe("manual");
    expect(keepLabelValues({ ...OFF, fetchedAt: "2026-12-01T00:00:00.000Z" }, p).nutrients).toEqual(NUTRIENTS);
  });
  it("una correzione cambia i campi scritti e lascia gli altri; toglierne uno richiede il gesto esplicito", () => {
    const first = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS }, NOW, "manual");
    const second = applyLabelValues(first, OFF.barcode, { nutrients: { per: "100g", certainty: "label", energyKcal: 500 } }, "2026-11-18T10:00:00.000Z", "manual");
    expect(second.nutrients).toEqual({ ...NUTRIENTS, energyKcal: 500 });
    expect(second.labelPhoto?.readAt).toBe("2026-11-18T10:00:00.000Z");
    const third = applyLabelValues(second, OFF.barcode, { nutrients: { per: "100g", certainty: "label", energyKcal: 500 }, clearNutrients: ["fat"] }, NOW, "manual");
    expect(third.nutrients).not.toHaveProperty("fat");
  });
});

describe("keepLabelValues", () => {
  const confirmed = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS, ingredientsText: "zucchero, latte, soia", ingredientsLang: "it", allergens: ["soybeans"] }, NOW);
  const fresh: Product = { ...OFF, fetchedAt: "2026-11-18T00:00:00.000Z", nutrients: { per: "100g", certainty: "label", energyKcal: 1 }, ingredientsText: "altro", allergens: ["milk"] };

  it("una rilettura dal servizio non cancella ciò che l'utente ha confermato", () => {
    const out = keepLabelValues(fresh, confirmed);
    expect(out.nutrients).toEqual(NUTRIENTS);
    expect(out.ingredientsText).toBe("zucchero, latte, soia");
    expect(out.allergens).toEqual(["milk", "soybeans"]);
    expect(out.fetchedAt).toBe(fresh.fetchedAt);
    expect(out.labelPhoto).toEqual(confirmed.labelPhoto);
  });
  it("senza lettura da foto restituisce la scheda nuova così com'è", () => {
    expect(keepLabelValues(fresh, OFF)).toBe(fresh);
    expect(keepLabelValues(fresh, undefined)).toBe(fresh);
  });
  it("un valore del servizio non coperto dalla foto resta", () => {
    const onlyNutrients = applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS }, NOW);
    expect(keepLabelValues(fresh, onlyNutrients).ingredientsText).toBe("altro");
  });
});

describe("unione campo per campo con i valori già sulla scheda", () => {
  const WITH_OFF: Product = { ...OFF, nutrients: { per: "100g", certainty: "label", energyKcal: 400, sugars: 20, fat: 10, salt: 1 } };

  it("leggere solo grassi e sale non cancella kcal e zuccheri della scheda", () => {
    const p = applyLabelValues(WITH_OFF, OFF.barcode, { nutrients: { per: "100g", certainty: "label", fat: 12, salt: 1.2 } }, NOW);
    expect(p.nutrients).toEqual({ per: "100g", certainty: "label", energyKcal: 400, sugars: 20, fat: 12, salt: 1.2 });
  });
  it("togliere un valore richiede un gesto esplicito", () => {
    const p = applyLabelValues(WITH_OFF, OFF.barcode, { nutrients: { per: "100g", certainty: "label", fat: 12 }, clearNutrients: ["sugars"] }, NOW);
    expect(p.nutrients).toEqual({ per: "100g", certainty: "label", energyKcal: 400, fat: 12, salt: 1 });
  });
  it("con un'altra base (per 100 ml invece di 100 g) non si mescola: valgono i nuovi valori", () => {
    const p = applyLabelValues(WITH_OFF, OFF.barcode, { nutrients: { per: "100ml", certainty: "label", energyKcal: 40 } }, NOW);
    expect(p.nutrients).toEqual({ per: "100ml", certainty: "label", energyKcal: 40 });
  });
  it("la scheda di partenza non cambia", () => {
    applyLabelValues(WITH_OFF, OFF.barcode, { nutrients: { per: "100g", certainty: "label", fat: 12 }, clearNutrients: ["sugars"] }, NOW);
    expect(WITH_OFF.nutrients).toEqual({ per: "100g", certainty: "label", energyKcal: 400, sugars: 20, fat: 10, salt: 1 });
  });
});

describe("schede create dal nome", () => {
  it("il segno si mette alla nascita e non si aggiunge a una scheda che c'è già", () => {
    const born = applyLabelValues(undefined, "2991234567893", { nutrients: NUTRIENTS, name: "Biscotti", localFromName: true }, NOW, "manual");
    expect(born.localFromName).toBe(true);
    expect(applyLabelValues(OFF, OFF.barcode, { nutrients: NUTRIENTS, localFromName: true }, NOW, "manual").localFromName).toBeUndefined();
    expect(applyLabelValues(undefined, "8000000000017", { nutrients: NUTRIENTS }, NOW).localFromName).toBeUndefined();
    // una correzione successiva lo conserva
    expect(applyLabelValues(born, born.barcode, { nutrients: { ...NUTRIENTS, fat: 14 } }, NOW, "manual").localFromName).toBe(true);
    expect(keepLabelValues({ ...OFF, barcode: born.barcode }, born).localFromName).toBeUndefined();
  });
});
