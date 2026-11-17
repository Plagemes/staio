import { describe, expect, it } from "vitest";
import { OFF_FIELDS, locationFromStorage, parsePackageQuantity, piecesHintFrom, productFromOpenFoodFacts } from "./index";

const off = (product: Record<string, unknown>) => productFromOpenFoodFacts({ status: 1, code: "8003170096165", product }, { fetchedAt: "2026-11-17T08:00:00.000Z" });

describe("«2 x 100 g» e simili", () => {
  it("legge numero di pezzi e grammatura", () => {
    expect(parsePackageQuantity("2 x 100 g")).toMatchObject({ value: 200, unit: "g", count: 2 });
    expect(parsePackageQuantity("6 x 125 g")).toMatchObject({ value: 750, count: 6 });
    expect(parsePackageQuantity("4 × 33 cl")).toMatchObject({ value: 1320, unit: "ml", count: 4 });
    expect(parsePackageQuantity("200 g")?.count).toBeUndefined();
  });

  it("dalla scritta della confezione nasce la proposta dei pezzi", () => {
    expect(piecesHintFrom(parsePackageQuantity("2 x 100 g"), undefined)).toEqual({ count: 2, each: 100, source: "label" });
    expect(piecesHintFrom(parsePackageQuantity("200 g"), undefined)).toBeUndefined();
    expect(piecesHintFrom(parsePackageQuantity("4 pz"), undefined)).toBeUndefined();
  });

  it("la porzione conta solo se divide esattamente la confezione", () => {
    expect(piecesHintFrom(parsePackageQuantity("200 g"), { value: 100, unit: "g" })).toEqual({ count: 2, each: 100, source: "serving" });
    // mousse: 170 g con porzione da 100 g
    expect(piecesHintFrom(parsePackageQuantity("170 g"), { value: 100, unit: "g" })).toBeUndefined();
    expect(piecesHintFrom(parsePackageQuantity("500 g"), { value: 85, unit: "g" })).toBeUndefined();
    // troppe porzioni non sono pezzi
    expect(piecesHintFrom(parsePackageQuantity("1000 g"), { value: 25, unit: "g" })).toBeUndefined();
    // unità diverse
    expect(piecesHintFrom(parsePackageQuantity("200 g"), { value: 100, unit: "ml" })).toBeUndefined();
  });

  it("gli imballaggi dichiarati con più unità, se tornano con la quantità", () => {
    const q = parsePackageQuantity("200 g");
    expect(piecesHintFrom(q, undefined, [{ count: 2, each: 100, unit: "g" }])).toEqual({ count: 2, each: 100, source: "packagings" });
    expect(piecesHintFrom(q, undefined, [{ count: 2, each: 80, unit: "g" }])).toBeUndefined();
  });
});

describe("dati di Open Food Facts per i pezzi e la conservazione", () => {
  it("la mousse del supermercato: porzione presente, nessuna proposta di pezzi", () => {
    const p = off({ product_name: "Mousse cacao protein", quantity: "170 g", product_quantity: 170, product_quantity_unit: "g", serving_size: "1 portion (100 g)", serving_quantity: 100, serving_quantity_unit: "g" });
    expect(p?.serving).toEqual({ value: 100, unit: "g" });
    expect(p?.piecesHint).toBeUndefined();
  });

  it("2 x 100 g e una porzione che divide: la scritta vince", () => {
    const p = off({ product_name: "Piadina", quantity: "2 x 100 g", serving_quantity: 100, serving_quantity_unit: "g" });
    expect(p?.piecesHint).toEqual({ count: 2, each: 100, source: "label" });
  });

  it("senza quantità né porzione non si propone niente", () => {
    const p = off({ product_name: "Piadina", expiration_date: "2020-11-11" });
    expect(p?.piecesHint).toBeUndefined();
    expect(p?.serving).toBeUndefined();
    expect(p).not.toHaveProperty("expiration_date");
  });

  it("la data di scadenza di Open Food Facts non si richiede né si usa", () => {
    expect(OFF_FIELDS).not.toContain("expiration_date");
    expect(JSON.stringify(off({ product_name: "X", expiration_date: "2020-11-11" }))).not.toContain("2020-11-11");
  });

  it("imballaggi con più unità", () => {
    const p = off({
      product_name: "Piadine",
      quantity: "200 g",
      product_quantity: 200,
      product_quantity_unit: "g",
      packagings: [{ number_of_units: 2, quantity_per_unit_value: 100, quantity_per_unit_unit: "g", shape: "en:bag" }],
    });
    expect(p?.piecesHint).toEqual({ count: 2, each: 100, source: "packagings" });
  });

  it("testo di conservazione", () => {
    expect(off({ conservation_conditions: "A conserver au sec." })?.storageText).toBe("A conserver au sec.");
    expect(off({ conservation_conditions: "x", conservation_conditions_it: "Conservare al fresco" })?.storageText).toBe("Conservare al fresco");
  });
});

describe("luogo dal testo di conservazione", () => {
  it.each([
    ["A conserver au sec et à l'abri de la chaleur. Ne pas mettre au réfrigérateur.", "dispensa"],
    ["Conserver dans un endroit frais et sec.", "dispensa"],
    ["Conservare in luogo fresco e asciutto", "dispensa"],
    ["Conservare in frigorifero tra 0 e 4 °C", "frigo"],
    ["Da conservare in frigo", "frigo"],
    ["Keep refrigerated", "frigo"],
    ["Conservare a -18°C. Non ricongelare dopo lo scongelamento", "freezer"],
    ["Conservare in freezer", "freezer"],
    ["Dopo l'apertura conservare in frigorifero e consumare entro 3 giorni", undefined],
    ["Conservare in frigo oppure in luogo fresco e asciutto", undefined],
    ["Proteggere dalla luce", undefined],
    ["", undefined],
  ])("%s", (text, expected) => {
    expect(locationFromStorage(text)).toBe(expected);
  });

  it("senza testo non c'è proposta", () => {
    expect(locationFromStorage(undefined)).toBeUndefined();
  });
});
