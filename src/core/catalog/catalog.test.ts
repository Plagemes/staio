import { describe, expect, it } from "vitest";
import { SHELF_LIFE } from "@/core/expiry";
import {
  expiryCategoryFor,
  expiryCategoryMatch,
  expiryCategoryProposal,
  isStoredProduct,
  isValidBarcode,
  parsePackageQuantity,
  productFromOpenFoodFacts,
  quantityText,
  toGtin13,
  validateBarcode,
} from "./index";

const NOW = "2026-11-17T08:00:00.000Z";

const COMPLETE = {
  code: "8076800195057",
  status: 1,
  status_verbose: "product found",
  product: {
    code: "8076800195057",
    product_name: "Spaghetti n. 5",
    product_name_it: "Spaghetti n. 5",
    brands: "Barilla, Altra Marca",
    quantity: "500 g",
    product_quantity: "500",
    packaging_tags: ["en:cardboard", "en:box"],
    categories_tags: ["en:plant-based-foods-and-beverages", "en:cereals-and-potatoes", "en:pastas", "en:dried-pastas"],
    nutriments: {
      "energy-kcal_100g": 359,
      "energy-kj_100g": 1522,
      proteins_100g: 13,
      carbohydrates_100g: 71.2,
      sugars_100g: 3.5,
      fat_100g: 2,
      "saturated-fat_100g": 0.5,
      fiber_100g: 3,
      salt_100g: 0.013,
    },
    nova_group: 1,
    nutriscore_grade: "a",
    allergens_tags: ["en:gluten"],
    additives_tags: [],
    image_front_small_url: "https://images.openfoodfacts.org/images/products/807/680/019/5057/front_it.small.400.jpg",
  },
};

describe("validateBarcode", () => {
  it("accetta EAN-13, EAN-8 e UPC-A con cifra di controllo corretta", () => {
    expect(validateBarcode("8076800195057")).toEqual({ ok: true, code: "8076800195057", format: "ean13" });
    expect(validateBarcode("96385074")).toEqual({ ok: true, code: "96385074", format: "ean8" });
    expect(validateBarcode("036000291452")).toEqual({ ok: true, code: "036000291452", format: "upca" });
  });

  it("ignora spazi e trattini tra le cifre", () => {
    expect(validateBarcode(" 8076 8001-95057 ")).toMatchObject({ ok: true, code: "8076800195057" });
  });

  it("rifiuta cifra di controllo errata, lunghezza sbagliata, lettere e testo vuoto", () => {
    expect(validateBarcode("8076800195058")).toEqual({ ok: false, reason: "bad_checksum" });
    expect(validateBarcode("96385075")).toEqual({ ok: false, reason: "bad_checksum" });
    expect(validateBarcode("807680019505")).toEqual({ ok: false, reason: "bad_checksum" });
    expect(validateBarcode("12345")).toEqual({ ok: false, reason: "bad_length" });
    expect(validateBarcode("80768001950570")).toEqual({ ok: false, reason: "bad_length" });
    expect(validateBarcode("80768O0195057")).toEqual({ ok: false, reason: "not_digits" });
    expect(validateBarcode("   ")).toEqual({ ok: false, reason: "empty" });
    expect(isValidBarcode("8076800195057")).toBe(true);
    expect(isValidBarcode("8076800195050")).toBe(false);
  });

  it("porta un UPC-A alla forma a 13 cifre", () => {
    expect(toGtin13("036000291452")).toBe("0036000291452");
    expect(toGtin13("8076800195057")).toBe("8076800195057");
    expect(validateBarcode(toGtin13("036000291452")).ok).toBe(true);
  });
});

describe("parsePackageQuantity", () => {
  it("legge grammi e litri", () => {
    expect(parsePackageQuantity("500 g")).toEqual({ text: "500 g", value: 500, unit: "g" });
    expect(parsePackageQuantity("1 l")).toEqual({ text: "1 l", value: 1000, unit: "ml" });
    expect(parsePackageQuantity("1,5 kg")).toMatchObject({ value: 1500, unit: "g" });
    expect(parsePackageQuantity("500g")).toMatchObject({ value: 500, unit: "g" });
    expect(parsePackageQuantity("1 L")).toMatchObject({ value: 1000, unit: "ml" });
  });

  it("converte i centilitri in millilitri", () => {
    expect(parsePackageQuantity("33 cl")).toMatchObject({ value: 330, unit: "ml" });
    expect(parsePackageQuantity("75 cl")).toMatchObject({ value: 750, unit: "ml" });
  });

  it("calcola il totale delle confezioni multiple", () => {
    expect(parsePackageQuantity("6 x 125 g")).toEqual({ text: "6 x 125 g", value: 750, unit: "g", count: 6 });
    expect(parsePackageQuantity("4x33cl")).toMatchObject({ value: 1320, unit: "ml", count: 4 });
  });

  it("con più misure vince la prima", () => {
    expect(parsePackageQuantity("250 g (2 x 125 g)")).toMatchObject({ value: 250, unit: "g" });
  });

  it("conta i pezzi", () => {
    expect(parsePackageQuantity("6 pz")).toMatchObject({ value: 6, unit: "pz" });
  });

  it("se non interpretabile conserva solo il testo", () => {
    expect(parsePackageQuantity("una confezione")).toEqual({ text: "una confezione" });
    expect(parsePackageQuantity("")).toBeUndefined();
    expect(parsePackageQuantity("0 g")).toEqual({ text: "0 g" });
  });

  it("scrive la quantità per il modulo di cattura", () => {
    expect(quantityText(parsePackageQuantity("500 g"))).toBe("500 g");
    expect(quantityText(parsePackageQuantity("1 l"))).toBe("1 l");
    expect(quantityText(parsePackageQuantity("1,5 kg"))).toBe("1,5 kg");
    expect(quantityText(parsePackageQuantity("33 cl"))).toBe("330 ml");
    expect(quantityText(parsePackageQuantity("6 x 125 g"))).toBe("750 g");
    expect(quantityText({ text: "boh" })).toBeUndefined();
    expect(quantityText(undefined)).toBeUndefined();
  });
});

describe("productFromOpenFoodFacts", () => {
  it("trasforma una risposta completa", () => {
    const product = productFromOpenFoodFacts(COMPLETE, { fetchedAt: NOW });
    expect(product).toEqual({
      barcode: "8076800195057",
      name: "Spaghetti n. 5",
      brand: "Barilla",
      quantity: { text: "500 g", value: 500, unit: "g" },
      packaging: ["cardboard", "box"],
      categories: ["plant-based-foods-and-beverages", "cereals-and-potatoes", "pastas", "dried-pastas"],
      nutrients: {
        per: "100g",
        certainty: "label",
        energyKcal: 359,
        proteins: 13,
        carbohydrates: 71.2,
        sugars: 3.5,
        fat: 2,
        saturatedFat: 0.5,
        fiber: 3,
        salt: 0.01,
      },
      nova: 1,
      nutriScore: "a",
      allergens: ["gluten"],
      imageUrl: "https://images.openfoodfacts.org/images/products/807/680/019/5057/front_it.small.400.jpg",
      fetchedAt: NOW,
      source: "openfoodfacts",
    });
  });

  it("lascia assente ciò che manca, senza inventare", () => {
    const product = productFromOpenFoodFacts(
      { code: "5449000000996", status: 1, product: { code: "5449000000996", product_name: "Cola", quantity: "33 cl" } },
      { fetchedAt: NOW },
    );
    expect(product).toEqual({
      barcode: "5449000000996",
      name: "Cola",
      quantity: { text: "33 cl", value: 330, unit: "ml" },
      fetchedAt: NOW,
      source: "openfoodfacts",
    });
    expect(product).not.toHaveProperty("brand");
    expect(product).not.toHaveProperty("nutrients");
    expect(product).not.toHaveProperty("nova");
    expect(product).not.toHaveProperty("allergens");
  });

  it("scarta valori non validi e voci vuote", () => {
    const product = productFromOpenFoodFacts(
      {
        status: 1,
        product: {
          code: "8076800195057",
          product_name: "   ",
          brands: "",
          nutriments: { proteins_100g: "n/a", fat_100g: -3 },
          nova_group: 7,
          nutriscore_grade: "unknown",
          image_front_url: "http://insicuro.example/x.jpg",
        },
      },
      { fetchedAt: NOW },
    );
    expect(product).toEqual({ barcode: "8076800195057", fetchedAt: NOW, source: "openfoodfacts" });
  });

  it("accetta numeri scritti come stringa e ricava le kcal dai kJ", () => {
    const product = productFromOpenFoodFacts(
      { status: 1, product: { code: "96385074", nutriments: { "energy-kj_100g": "1000", proteins_100g: "7.5" } } },
      { fetchedAt: NOW },
    );
    expect(product?.nutrients).toEqual({ per: "100g", certainty: "label", energyKcal: 239, proteins: 7.5 });
  });

  it("per le bevande i valori sono per 100 ml", () => {
    const product = productFromOpenFoodFacts(
      { status: 1, product: { code: "5449000000996", quantity: "1 l", nutriments: { sugars_100g: 10.6 } } },
      { fetchedAt: NOW },
    );
    expect(product?.nutrients?.per).toBe("100ml");
  });

  it("usa product_quantity solo se l'unità è dichiarata", () => {
    const withUnit = productFromOpenFoodFacts(
      { status: 1, product: { code: "96385074", product_quantity: 250, product_quantity_unit: "ml" } },
      { fetchedAt: NOW },
    );
    expect(withUnit?.quantity).toEqual({ value: 250, unit: "ml" });
    const withoutUnit = productFromOpenFoodFacts({ status: 1, product: { code: "96385074", product_quantity: 250 } }, { fetchedAt: NOW });
    expect(withoutUnit).not.toHaveProperty("quantity");
  });

  it("prodotto non trovato", () => {
    expect(productFromOpenFoodFacts({ code: "0000000000000", status: 0, status_verbose: "product not found" })).toBeNull();
    expect(productFromOpenFoodFacts({ status: 1 })).toBeNull();
    expect(productFromOpenFoodFacts(null)).toBeNull();
    expect(productFromOpenFoodFacts("testo")).toBeNull();
    expect(productFromOpenFoodFacts([])).toBeNull();
  });

  it("usa il codice richiesto se la risposta non lo riporta", () => {
    const product = productFromOpenFoodFacts({ status: 1, product: { product_name: "X" } }, { barcode: "96385074", fetchedAt: NOW });
    expect(product?.barcode).toBe("96385074");
  });

  it("riconosce un prodotto salvato", () => {
    const product = productFromOpenFoodFacts(COMPLETE, { fetchedAt: NOW });
    expect(isStoredProduct(product)).toBe(true);
    expect(isStoredProduct({ barcode: "abc" })).toBe(false);
    expect(isStoredProduct(undefined)).toBe(false);
  });
});

describe("expiryCategoryFor", () => {
  const cats = (...categories: string[]) => ({ categories });

  it("propone la categoria dalle categorie di Open Food Facts", () => {
    expect(expiryCategoryFor(cats("dairies", "milks", "uht-milks"))).toBe("milk_uht");
    expect(expiryCategoryFor(cats("dairies", "milks", "fresh-milks"))).toBe("milk_fresh");
    expect(expiryCategoryFor(cats("dairies", "fermented-milk-products", "yogurts"))).toBe("yogurt");
    expect(expiryCategoryFor(cats("pastas", "dried-pastas"))).toBe("pasta_dry");
    expect(expiryCategoryFor(cats("pastas", "fresh-pastas"))).toBe("pasta_fresh");
    expect(expiryCategoryFor(cats("beverages", "carbonated-drinks", "sodas"))).toBe("beverages");
    expect(expiryCategoryFor(cats("dairies", "butters"))).toBe("butter");
    expect(expiryCategoryFor(cats("eggs"))).toBe("eggs");
    expect(expiryCategoryFor(cats("snacks", "biscuits"))).toBe("snacks_dry");
  });

  it("i casi particolari battono i generali", () => {
    expect(expiryCategoryFor(cats("seafood", "fishes", "canned-fishes", "canned-tunas"))).toBe("canned_closed");
    expect(expiryCategoryFor(cats("frozen-foods", "frozen-pizzas", "pizzas", "meals"))).toBe("frozen_foods");
    expect(expiryCategoryFor(cats("meals", "pasta-dishes", "pastas"))).toBe("ready_meals");
    expect(expiryCategoryFor(cats("beverages", "plant-based-beverages", "plant-based-milks"))).toBe("beverages");
  });

  it("nei casi dubbi sceglie la durata più breve", () => {
    expect(expiryCategoryFor(cats("dairies", "cheeses"))).toBe("cheese_fresh");
    expect(expiryCategoryFor(cats("meats", "prepared-meats", "cured-hams"))).toBe("cold_cuts_sliced");
  });

  it("senza corrispondenza usa il ripiego prudente, deperibile", () => {
    const match = expiryCategoryMatch(cats("en-qualcosa-di-strano"));
    expect(match).toEqual({ category: "ready_meals", matched: false });
    expect(SHELF_LIFE[match.category].perishable).toBe(true);
    expect(expiryCategoryMatch({})).toEqual({ category: "ready_meals", matched: false });
  });

  it("segnala quando la categoria è riconosciuta", () => {
    expect(expiryCategoryMatch(cats("yogurts"))).toEqual({ category: "yogurt", matched: true });
  });

  it("restituisce sempre una chiave che il motore delle scadenze conosce", () => {
    const samples = ["milks", "pastas", "breads", "juices-and-nectars", "jams", "cakes", "legumes", "rices", "fresh-fruits", "seafood", "hams"];
    for (const c of samples) expect(SHELF_LIFE[expiryCategoryFor(cats(c))]).toBeDefined();
  });
});

describe("productFromOpenFoodFacts: additivi", () => {
  const base = { code: "8076800195057", product_name: "Spaghetti n. 5", categories_tags: ["en:pastas"] };
  const read = (product: Record<string, unknown>) => productFromOpenFoodFacts({ code: base.code, status: 1, product: { ...base, ...product } }, { fetchedAt: NOW });

  it("ingredienti analizzati e nessun additivo: elenco vuoto conservato", () => {
    expect(read({ additives_n: 0, additives_tags: [], ingredients_text: "Semola di grano duro" })?.additives).toEqual([]);
    expect(read({ additives_n: 0 })?.additives).toEqual([]);
    expect(read({ additives_tags: [], ingredients_text: "Semola di grano duro, acqua" })?.additives).toEqual([]);
  });

  it("additivi presenti: i codici in maiuscolo", () => {
    expect(read({ additives_n: 2, additives_tags: ["en:e330", "en:e412"], ingredients_text: "acqua, E330, E412" })?.additives).toEqual(["E330", "E412"]);
  });

  it("senza i campi di analisi il dato manca e additives resta assente", () => {
    expect(read({ additives_tags: [] })).not.toHaveProperty("additives");
    expect(read({ additives_tags: [], ingredients_text: "   " })).not.toHaveProperty("additives");
    expect(read({ ingredients_text: "Semola di grano duro" })).not.toHaveProperty("additives");
    expect(read({})).not.toHaveProperty("additives");
    // conteggio positivo senza etichette: incoerente, non si afferma nulla
    expect(read({ additives_n: 3, additives_tags: [] })).not.toHaveProperty("additives");
  });
});

describe("proposta di categoria: tag di Open Food Facts e nome", () => {
  const p = (name: string, ...categories: string[]) => expiryCategoryProposal({ name, categories });
  const cases: ReadonlyArray<readonly [string, string[], string]> = [
    ["Mousse cacao protein", [], "yogurt"],
    ["Mousse al cioccolato", ["desserts", "dairy-desserts", "mousses"], "yogurt"],
    ["Pancakes freschi", [], "pastries_fresh"],
    ["Skyr bianco naturale", [], "yogurt"],
    ["Skyr", ["dairies", "fermented-milk-products", "skyr"], "yogurt"],
    ["Budino proteico vaniglia", [], "yogurt"],
    ["Prosciutto cotto affettato", [], "cold_cuts_sliced"],
    ["Affettato di tacchino", ["meats", "deli-meats"], "cold_cuts_sliced"],
    ["Bevanda di soia", [], "beverages"],
    ["Bevanda all'avena", ["plant-based-beverages"], "beverages"],
    ["Gnocchi di patate freschi", [], "pasta_fresh"],
    ["Pizza margherita surgelata", [], "frozen_foods"],
    ["Spinaci surgelati", [], "frozen_foods"],
    ["Piadina romagnola", [], "bread_packaged"],
    ["Mozzarella di bufala", [], "cheese_fresh"],
    ["Parmigiano Reggiano 24 mesi", [], "cheese_aged"],
    ["Tonno all'olio d'oliva", [], "canned_closed"],
    ["Latte fresco intero", [], "milk_fresh"],
    ["Latte UHT parzialmente scremato", [], "milk_uht"],
    ["Cioccolato al latte", [], "snacks_dry"],
    ["Barretta proteica cocco", [], "snacks_dry"],
    ["Yogurt greco 0%", [], "yogurt"],
    ["Qualcosa di sconosciuto", ["plant-based-foods", "snacks-dolci-strani"], "ready_meals"],
  ];
  it.each(cases)("%s", (name, categories, expected) => {
    expect(p(name, ...categories).category).toBe(expected);
  });

  it("indica la fonte della proposta", () => {
    expect(p("Mousse cacao protein")).toMatchObject({ matched: true, source: "name" });
    expect(p("X", "mousses")).toMatchObject({ matched: true, source: "off" });
    expect(p("Qualcosa di sconosciuto")).toMatchObject({ matched: false, source: "none" });
  });

  it("i tag di Open Food Facts hanno la precedenza sul nome", () => {
    expect(p("Mousse speciale", "frozen-desserts").category).toBe("frozen_foods");
  });
});
