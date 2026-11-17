import { describe, expect, it } from "vitest";
import { parseLabelNutrition } from "@/core/ai";
import { assessProduct } from "@/core/allergens";
import type { Product } from "@/core/catalog";
import { allergenTags, canConfirm, draftProduct, emptyForm, formFromProduct, formFromReading, liveProblems, numbersOf, rescaled, valuesFromForm } from "./labelDraft";

const NOW = "2026-11-17T10:00:00.000Z";
const reading = (over: Record<string, unknown> = {}) =>
  parseLabelNutrition(
    JSON.stringify({
      found: true,
      name: "Biscotti",
      columnHeader: "per 100 g",
      per: "100g",
      servingSize: 30,
      servingUnit: "g",
      energyKcal: 470,
      energyKj: 1970,
      fat: 18,
      saturatedFat: 8,
      carbohydrates: 68,
      sugars: 24,
      fiber: 3,
      proteins: 7,
      salt: 0.8,
      ingredients: "Farina di frumento, zucchero, burro, uova, latte scremato in polvere.",
      ingredientsLanguage: "it",
      allergens: ["glutine", "uova", "latte"],
      traces: ["soia", "frutta a guscio"],
      confidence: 0.9,
      ...over,
    }),
  );
const OFF: Product = { barcode: "8000000000017", name: "Biscotti", fetchedAt: "2026-01-01T00:00:00.000Z", source: "openfoodfacts" };

describe("formFromReading", () => {
  it("riempie un testo per valore, con la virgola italiana", () => {
    const form = formFromReading(reading({ proteins: 7.5 }), undefined);
    expect(form.values.proteins).toBe("7,5");
    expect(form.values.energyKcal).toBe("470");
    expect(form.basis).toBe("100g");
    expect(form.allergens).toBe("glutine, uova, latte");
  });
  it("ingredienti e nome si propongono solo se la scheda non li ha", () => {
    expect(formFromReading(reading(), undefined)).toMatchObject({ name: "Biscotti", ingredientsLang: "it" });
    const known = formFromReading(reading(), { ...OFF, ingredientsText: "farina" });
    expect(known).toMatchObject({ name: "", ingredients: "", ingredientsLang: "" });
  });
});

describe("modulo di revisione", () => {
  it("una lettura coerente si può confermare e non ha problemi", () => {
    const form = formFromReading(reading(), OFF);
    expect(liveProblems(form)).toEqual([]);
    expect(canConfirm(form)).toBe(true);
  });
  it("un testo che non è un numero è un errore sul campo e impedisce di salvare", () => {
    const form = formFromReading(reading(), OFF);
    form.values.fat = "tanti";
    const problems = liveProblems(form);
    expect(problems.find((p) => p.field === "fat")?.severity).toBe("error");
    expect(canConfirm(form)).toBe(false);
    expect(numbersOf(form).invalid).toEqual(["fat"]);
  });
  it("i controlli si ricalcolano mentre si corregge: kJ scritti nelle kcal, poi sistemati", () => {
    const form = formFromReading(reading(), OFF);
    form.values.energyKcal = "1970";
    expect(liveProblems(form).map((p) => p.code)).toContain("kj_as_kcal");
    expect(canConfirm(form)).toBe(false); // uguali ai kJ: non si salva così
    form.values.energyKcal = "471";
    expect(liveProblems(form)).toEqual([]);
  });
  it("valori per porzione: non si confermano finché l'utente non sceglie, o riporta a 100", () => {
    const form = formFromReading(reading({ per: "serving", columnHeader: "per porzione (30 g)", energyKcal: 141, fat: 5.4, carbohydrates: 20.4, proteins: 2.1, saturatedFat: 2.4, sugars: 7.2, fiber: 0.9, salt: 0.24, energyKj: 591 }), OFF);
    expect(form.basis).toBe("serving");
    expect(canConfirm(form)).toBe(false);
    const scaled = rescaled(form);
    expect(scaled.basis).toBe("100g");
    expect(scaled.values.energyKcal).toBe("470");
    expect(scaled.values.fat).toBe("18");
    expect(canConfirm(scaled)).toBe(true);
    // senza porzione nota non si inventa niente
    const noServing = { ...form, serving: "" };
    expect(rescaled(noServing)).toBe(noServing);
  });
  it("niente da salvare: non si conferma", () => {
    const form = formFromReading(reading({ found: false, energyKcal: null, fat: null, carbohydrates: null, proteins: null, saturatedFat: null, sugars: null, fiber: null, salt: null, energyKj: null, ingredients: null, allergens: [], traces: [] }), OFF);
    expect(canConfirm(form)).toBe(false);
  });
});

describe("valuesFromForm", () => {
  it("i valori confermati hanno certezza label e la base scelta", () => {
    const form = formFromReading(reading(), OFF);
    form.basis = "100ml";
    const values = valuesFromForm(form, OFF);
    expect(values.nutrients).toEqual({ per: "100ml", certainty: "label", energyKcal: 470, fat: 18, saturatedFat: 8, carbohydrates: 68, sugars: 24, fiber: 3, proteins: 7, salt: 0.8 });
  });
  it("senza base scelta i valori non escono", () => {
    const form = formFromReading(reading({ per: "unclear", columnHeader: null }), OFF);
    expect(valuesFromForm(form, OFF).nutrients).toBeUndefined();
  });
  it("un campo svuotato non è salvato", () => {
    const form = formFromReading(reading(), OFF);
    form.values.fiber = "";
    expect(valuesFromForm(form, OFF).nutrients).not.toHaveProperty("fiber");
  });
  it("gli ingredienti già presenti non si sostituiscono", () => {
    const form = formFromReading(reading(), undefined);
    expect(valuesFromForm(form, { ...OFF, ingredientsText: "farina" }).ingredientsText).toBeUndefined();
    expect(valuesFromForm(form, OFF)).toMatchObject({ ingredientsText: expect.stringContaining("Farina"), ingredientsLang: "it" });
  });
});

describe("allergenTags", () => {
  it("porta le voci italiane agli identificatori di Open Food Facts", () => {
    expect(allergenTags("glutine, uova, latte, frutta a guscio, soia")).toEqual(["gluten", "eggs", "milk", "nuts", "soybeans"]);
  });
  it("una voce sconosciuta resta com'è, non si perde", () => {
    expect(allergenTags("Latte; Zenzero")).toEqual(["milk", "zenzero"]);
    expect(allergenTags("")).toEqual([]);
  });
});

describe("controllo degli allergeni sugli ingredienti letti", () => {
  it("la scheda dopo la conferma passa da assessProduct come quelle di Open Food Facts", () => {
    const form = formFromReading(reading(), undefined);
    form.ingredientsComplete = true;
    const product = draftProduct(form, undefined, OFF.barcode, NOW);
    expect(product).toMatchObject({ source: "label_photo", safetyFields: true, ingredientsLang: "it" });
    const milk = assessProduct(product, { allergens: ["latte"] });
    expect(milk.verdict).toBe("contains");
    const nuts = assessProduct(product, { allergens: ["frutta a guscio"] });
    expect(nuts.verdict).toBe("traces");
    const fish = assessProduct(product, { allergens: ["pesce"] });
    expect(fish.verdict).toBe("not_found");
  });
  it("senza la conferma «è tutto l'elenco» il controllo dà «incerto» per ciò che non trova", () => {
    const form = formFromReading(reading(), undefined);
    expect(form.ingredientsComplete).toBe(false);
    const product = draftProduct(form, undefined, OFF.barcode, NOW);
    expect(product.ingredientsTruncated).toBe(true);
    expect(assessProduct(product, { allergens: ["pesce"] }).verdict).toBe("uncertain");
    // ma ciò che trova lo dice lo stesso
    expect(assessProduct(product, { allergens: ["latte"] }).verdict).toBe("contains");
    // anche se il modello dice che è completo, serve la conferma dell'utente
    expect(formFromReading(reading({ ingredientsComplete: true }), undefined).ingredientsComplete).toBe(false);
  });
  it("ingredienti in un'altra lingua: il controllo non si fida", () => {
    const form = formFromReading(reading({ ingredientsLanguage: "en", ingredients: "Wheat flour, sugar, butter", allergens: [], traces: [] }), undefined);
    form.ingredientsComplete = true;
    const product = draftProduct(form, undefined, OFF.barcode, NOW);
    expect(assessProduct(product, { allergens: ["pesce"] }).verdict).toBe("uncertain");
  });
});

describe("valori scritti a mano", () => {
  const typed = (patch: Record<string, string> = {}) => {
    const form = emptyForm();
    Object.assign(form.values, { energyKcal: "350", fat: "12,5", carbohydrates: "50", proteins: "9", ...patch });
    return form;
  };

  it("il modulo vuoto parte da «per 100 g», non si può salvare e non ha errori da mostrare", () => {
    const form = emptyForm();
    expect(form.basis).toBe("100g");
    expect(canConfirm(form)).toBe(false);
    expect(liveProblems(form)).toEqual([]);
  });
  it("accetta la virgola e lascia i campi vuoti come «non indicato», mai zero", () => {
    const values = valuesFromForm(typed(), undefined);
    expect(values.nutrients).toEqual({ per: "100g", certainty: "label", energyKcal: 350, fat: 12.5, carbohydrates: 50, proteins: 9 });
    expect(values.nutrients).not.toHaveProperty("fiber");
    expect(values.nutrients).not.toHaveProperty("salt");
  });
  it("uno zero scritto resta zero", () => {
    expect(valuesFromForm(typed({ sugars: "0" }), undefined).nutrients).toMatchObject({ sugars: 0 });
  });
  it("accetta anche il punto, e rifiuta testo e numeri negativi", () => {
    expect(valuesFromForm(typed({ fat: "12.5" }), undefined).nutrients).toMatchObject({ fat: 12.5 });
    expect(canConfirm(typed({ fat: "abc" }))).toBe(false);
    expect(liveProblems(typed({ fat: "-3" })).some((p) => p.field === "fat" && p.severity === "error")).toBe(true);
  });
  it("stessi controlli di plausibilità della foto: somma dei macro, oltre 100 g", () => {
    expect(liveProblems(typed({ fat: "60", carbohydrates: "50" })).map((p) => p.code)).toContain("macro_sum");
    expect(canConfirm(typed({ proteins: "140" }))).toBe(false);
  });
  it("per porzione: serve scegliere, o riportare a 100 con la porzione scritta", () => {
    const form = { ...typed({ energyKcal: "141", fat: "5,4", carbohydrates: "20,4", proteins: "2,1" }), basis: "serving" as const, serving: "30" };
    expect(canConfirm(form)).toBe(false);
    expect(liveProblems(form).map((p) => p.code)).toContain("per_serving");
    const scaled = rescaled(form);
    expect(scaled.basis).toBe("100g");
    expect(scaled.values.energyKcal).toBe("470");
    expect(scaled.values.fat).toBe("18");
    expect(canConfirm(scaled)).toBe(true);
    expect(rescaled({ ...form, servingUnit: "ml" }).basis).toBe("100ml");
  });
  it("una porzione scritta male è un errore sul suo campo", () => {
    const form = { ...typed(), basis: "serving" as const, serving: "trenta" };
    expect(liveProblems(form).some((p) => p.field === "serving" && p.severity === "error")).toBe(true);
  });
  it("kJ facoltativi: con le kcal servono al controllo, senza le kcal le calcolano e lo dicono", () => {
    const both = typed({ energyKcal: "350" });
    both.energyKj = "1465";
    expect(liveProblems(both)).toEqual([]);
    both.energyKj = "900";
    expect(liveProblems(both).map((p) => p.code)).toContain("kj_kcal");

    const onlyKj = typed({ energyKcal: "", fat: "10", carbohydrates: "40", proteins: "8" });
    onlyKj.energyKj = "1000";
    expect(numbersOf(onlyKj)).toMatchObject({ derivedKcal: true, nutrients: { energyKcal: 239 } });
    expect(liveProblems(onlyKj).find((p) => p.code === "derived")?.message).toContain("kJ");
    expect(valuesFromForm(onlyKj, undefined).nutrients?.energyKcal).toBe(239);
    onlyKj.energyKj = "tanti";
    expect(canConfirm(onlyKj)).toBe(false);
  });
  it("kJ scritti nelle kcal: avviso con la via d'uscita", () => {
    const form = typed({ energyKcal: "1465", fat: "12,5", carbohydrates: "50", proteins: "9" });
    expect(liveProblems(form).map((p) => p.code)).toContain("kj_as_kcal");
    expect(canConfirm(form)).toBe(false);
    form.values.energyKcal = "350";
    expect(canConfirm(form)).toBe(true);
  });
  it("kcal oltre 900 per 100 g non si salvano, nemmeno a mano", () => {
    expect(canConfirm(typed({ energyKcal: "1200", fat: "30", carbohydrates: "40", proteins: "10" }))).toBe(false);
    expect(canConfirm(typed({ energyKcal: "1000000" }))).toBe(false);
  });
  it("solo l'energia: serve confermare l'unità; cambiando il valore la conferma va data di nuovo", () => {
    const form = typed({ fat: "", carbohydrates: "", proteins: "", energyKcal: "180" });
    expect(liveProblems(form).map((p) => p.code)).toContain("energy_unit");
    expect(canConfirm(form)).toBe(false);
    form.kcalConfirmed = true;
    expect(canConfirm(form)).toBe(true);
    // i kJ stampati accanto confermano l'unità da soli
    const withKj = typed({ fat: "", carbohydrates: "", proteins: "", energyKcal: "180" });
    withKj.energyKj = "753";
    expect(canConfirm(withKj)).toBe(true);
  });
  it("ingredienti e allergeni scritti a mano passano dallo stesso controllo", () => {
    const form = typed();
    form.ingredients = "Farina di frumento, latte, zucchero";
    form.ingredientsLang = "it";
    form.allergens = "glutine, latte";
    form.ingredientsComplete = true;
    const product = draftProduct(form, undefined, OFF.barcode, NOW, "manual");
    expect(product).toMatchObject({ source: "manual", safetyFields: true, allergens: ["gluten", "milk"] });
    expect(product.labelPhoto).toMatchObject({ by: "manual", nutrients: true, ingredients: true });
    expect(assessProduct(product, { allergens: ["latte"] }).verdict).toBe("contains");
    expect(assessProduct(product, { allergens: ["pesce"] }).verdict).toBe("not_found");
  });
  it("correzione successiva: il modulo riparte dai valori già salvati", () => {
    const saved = draftProduct(typed(), OFF, OFF.barcode, NOW, "manual");
    const form = formFromProduct(saved);
    expect(form).toMatchObject({ basis: "100g" });
    expect(form.values).toMatchObject({ energyKcal: "350", fat: "12,5", carbohydrates: "50", proteins: "9", fiber: "" });
    form.values.fat = "14";
    const corrected = draftProduct(form, saved, OFF.barcode, "2026-11-18T08:00:00.000Z", "manual");
    expect(corrected.nutrients).toMatchObject({ fat: 14, energyKcal: 350, proteins: 9 });
    expect(corrected.nutrients).not.toHaveProperty("fiber");
    expect(corrected.labelPhoto?.readAt).toBe("2026-11-18T08:00:00.000Z");
    expect(saved.nutrients?.fat).toBe(12.5);
  });
});

describe("la foto parte dai valori già sulla scheda", () => {
  const WITH_OFF: Product = { ...OFF, nutrients: { per: "100g", certainty: "label", energyKcal: 400, sugars: 20, fat: 10, carbohydrates: 50, proteins: 8, salt: 1 } };
  const onlyFatAndSalt = () => reading({ energyKcal: null, energyKj: null, saturatedFat: null, carbohydrates: null, sugars: null, fiber: null, proteins: null, fat: 12, salt: 1.2 });

  it("leggere solo grassi e sale non fa sparire kcal e zuccheri della scheda", () => {
    const form = formFromReading(onlyFatAndSalt(), WITH_OFF);
    expect(form.values).toMatchObject({ fat: "12", salt: "1,2", energyKcal: "400", sugars: "20", carbohydrates: "50", proteins: "8" });
    const values = valuesFromForm(form, WITH_OFF);
    expect(values.nutrients).toMatchObject({ fat: 12, salt: 1.2, energyKcal: 400, sugars: 20 });
    expect(values.clearNutrients).toBeUndefined();
    const saved = draftProduct(form, WITH_OFF, OFF.barcode, NOW);
    expect(saved.nutrients).toMatchObject({ energyKcal: 400, sugars: 20, fat: 12, salt: 1.2 });
  });
  it("togliere un valore è un gesto esplicito: svuotare il campo", () => {
    const form = formFromReading(onlyFatAndSalt(), WITH_OFF);
    form.values.sugars = "";
    const values = valuesFromForm(form, WITH_OFF);
    expect(values.clearNutrients).toEqual(["sugars"]);
    expect(draftProduct(form, WITH_OFF, OFF.barcode, NOW).nutrients).not.toHaveProperty("sugars");
  });
  it("se la foto è per 100 ml e la scheda per 100 g non si mescolano", () => {
    const form = formFromReading(reading({ per: "100ml", columnHeader: "per 100 ml", energyKcal: 40, fat: 1, carbohydrates: 8, proteins: 1, saturatedFat: null, sugars: null, fiber: null, salt: null, energyKj: null }), WITH_OFF);
    expect(form.values.salt).toBe("");
    expect(form.values.sugars).toBe("");
    expect(draftProduct(form, WITH_OFF, OFF.barcode, NOW).nutrients).toEqual({ per: "100ml", certainty: "label", energyKcal: 40, fat: 1, carbohydrates: 8, proteins: 1 });
  });
});
