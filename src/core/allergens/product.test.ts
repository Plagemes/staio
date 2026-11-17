import { describe, expect, it } from "vitest";
import { assessProduct, type ProductFacts } from "./index";

const IT = "it";
// le schede di prova sono lette con ingredienti e tracce, salvo diversa indicazione
const full = (product: ProductFacts): ProductFacts => ({ safetyFields: true, ...product });
const one = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) => assessProduct(full(product), criteria).outcomes[0];

describe("assessProduct: allergeni", () => {
  it("latte tra gli allergeni dichiarati: contains", () => {
    const o = one({ name: "Budino", allergens: ["milk", "eggs"] }, { allergens: ["latte"] });
    expect(o).toMatchObject({ kind: "allergen", label: "latte", verdict: "contains", reason: "tag", term: "milk" });
    expect(o?.text).toContain("Contiene latte");
  });

  it("riconosce gli identificatori di Open Food Facts per tutti gli allergeni", () => {
    const tags = ["gluten", "peanuts", "nuts", "soybeans", "sesame-seeds", "sulphur-dioxide-and-sulphites", "molluscs", "crustaceans", "lupin", "celery", "mustard", "fish"];
    for (const [declared, tag] of [
      ["glutine", "gluten"], ["arachidi", "peanuts"], ["frutta a guscio", "nuts"], ["soia", "soybeans"], ["sesamo", "sesame-seeds"],
      ["solfiti", "sulphur-dioxide-and-sulphites"], ["molluschi", "molluscs"], ["crostacei", "crustaceans"], ["lupini", "lupin"],
      ["sedano", "celery"], ["senape", "mustard"], ["pesce", "fish"],
    ] as const) {
      expect(tags).toContain(tag);
      expect(one({ allergens: [tag] }, { allergens: [declared] })).toMatchObject({ verdict: "contains", reason: "tag" });
    }
  });

  it("«lattosio» dichiarato vale latte", () => {
    expect(one({ allergens: ["milk"] }, { allergens: ["Lattosio"] })).toMatchObject({ verdict: "contains", label: "latte" });
  });

  it("solo nelle tracce: esito distinto, mai compatibile", () => {
    const o = one({ name: "Biscotti", allergens: ["gluten"], traces: ["milk"], ingredientsText: "farina di frumento, zucchero", ingredientsLang: IT }, { allergens: ["latte"] });
    expect(o).toMatchObject({ verdict: "traces", reason: "traces_tag", term: "milk" });
    expect(o?.text).toBe("Può contenere tracce di latte.");
  });

  it("le tracce scritte nel testo degli ingredienti non sono ingredienti", () => {
    const text = "Farina di frumento, zucchero, olio di girasole. Può contenere tracce di latte e soia.";
    const product = { ingredientsText: text, ingredientsLang: IT };
    expect(one(product, { allergens: ["latte"] })).toMatchObject({ verdict: "traces", reason: "traces_text" });
    expect(one(product, { allergens: ["soia"] })).toMatchObject({ verdict: "traces", reason: "traces_text" });
    expect(one(product, { allergens: ["uova"] })?.verdict).toBe("not_found");
  });

  it("un allergene sia negli ingredienti sia nelle tracce è contains", () => {
    expect(one({ ingredientsText: "latte intero, cacao", ingredientsLang: IT, traces: ["milk"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains" });
  });

  it("testo italiano con derivati: contains", () => {
    const product = { ingredientsText: "Zucchero, siero di latte in polvere, burro di cacao, emulsionante: lecitina di soia", ingredientsLang: IT };
    expect(one(product, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
    expect(one(product, { allergens: ["soia"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
  });

  it("il burro di cacao da solo non è latte", () => {
    expect(one({ ingredientsText: "Massa di cacao, burro di cacao, zucchero", ingredientsLang: IT }, { allergens: ["latte"] })?.verdict).toBe("not_found");
  });

  it("dati assenti: uncertain con motivo", () => {
    for (const product of [{}, { name: "Qualcosa" }, { allergens: [], traces: [], ingredientsText: "  " }]) {
      const o = one(product, { allergens: ["latte"] });
      expect(o).toMatchObject({ verdict: "uncertain", reason: "no_data" });
      expect(o?.text).toContain("Dati assenti");
    }
  });

  it("ingredienti presenti e nulla trovato: mai compatibile, solo «non risulta»", () => {
    const o = one({ ingredientsText: "Acqua, sale, pomodori", ingredientsLang: IT }, { allergens: ["latte"] });
    expect(o).toMatchObject({ verdict: "not_found", reason: "not_in_data" });
    expect(o?.text).toBe("Non risulta dai dati di Open Food Facts. Controlla l'etichetta.");
    expect(JSON.stringify(o)).not.toMatch(/compatibil|clear|sicuro/i);
  });

  it("solo tag, senza ingredienti, e nulla trovato: dati assenti, non «non risulta»", () => {
    expect(one({ allergens: ["gluten"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
  });

  it("tag sconosciuto: resta testo e si confronta per testo", () => {
    expect(one({ allergens: ["kiwi"] }, { allergens: ["kiwi"] })).toMatchObject({ verdict: "contains", reason: "tag", term: "kiwi" });
    expect(one({ allergens: ["fr:lupin-blanc"] }, { allergens: ["lupini"] })).toMatchObject({ verdict: "contains" });
    expect(one({ allergens: ["kiwi"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag", term: "kiwi" });
  });

  it("allergene dichiarato che le tabelle non conoscono: si cerca come parola", () => {
    expect(one({ ingredientsText: "Zucchero, succo di kiwi", ingredientsLang: IT }, { allergens: ["kiwi"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
  });

  it("testo in un'altra lingua: se non si trova nulla è incerto, non «non risulta»", () => {
    const product = { ingredientsText: "Zucker, Weizenmehl, Salz", ingredientsLang: "de" };
    expect(one(product, { allergens: ["uova"] })).toMatchObject({ verdict: "uncertain", reason: "foreign_text" });
    expect(one({ ingredientsText: "Sugar, salt", ingredientsLang: undefined }, { allergens: ["uova"] })).toMatchObject({ verdict: "uncertain", reason: "foreign_text" });
  });

  it("testo in un'altra lingua: ciò che si riconosce vale comunque", () => {
    expect(one({ ingredientsText: "Sugar, milk powder, salt", ingredientsLang: "en" }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
    expect(one({ ingredientsText: "Zucker, Milch", ingredientsLang: "de", allergens: ["milk"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "tag" });
  });

  it("il nome del prodotto conta", () => {
    expect(one({ name: "Biscotti al latte", ingredientsText: "farina, zucchero", ingredientsLang: IT }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "name" });
  });
});

describe("assessProduct: esclusioni", () => {
  it("un'esclusione che non è un allergene si cerca negli ingredienti", () => {
    const product = { ingredientsText: "Carne di maiale, sale, spezie", ingredientsLang: IT };
    const o = one(product, { excludedFoods: ["maiale"] });
    expect(o).toMatchObject({ kind: "exclusion", label: "maiale", verdict: "contains", reason: "ingredients" });
  });

  it("gli iponimi dell'esclusione contano", () => {
    expect(one({ ingredientsText: "Prosciutto cotto, sale", ingredientsLang: IT }, { excludedFoods: ["maiale"] })).toMatchObject({ verdict: "contains" });
  });

  it("un'esclusione che è anche un allergene guarda anche i tag e le tracce", () => {
    expect(one({ allergens: ["milk"] }, { excludedFoods: ["latte"] })).toMatchObject({ kind: "exclusion", verdict: "contains", reason: "tag" });
    expect(one({ traces: ["milk"], ingredientsText: "riso", ingredientsLang: IT }, { excludedFoods: ["latte"] })).toMatchObject({ verdict: "traces" });
  });

  it("esclusione non trovata: «non risulta», o dati assenti", () => {
    expect(one({ ingredientsText: "Farina, acqua, lievito", ingredientsLang: IT }, { excludedFoods: ["funghi"] })).toMatchObject({ verdict: "not_found" });
    expect(one({}, { excludedFoods: ["funghi"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
  });

  it("le tracce di un'esclusione non allergene scritte nel testo sono tracce", () => {
    expect(one({ ingredientsText: "Riso. Prodotto in uno stabilimento che utilizza funghi.", ingredientsLang: IT }, { excludedFoods: ["funghi"] })).toMatchObject({ verdict: "traces", reason: "traces_text" });
  });
});

describe("assessProduct: insieme", () => {
  it("un esito per ciascuno, senza doppioni, e il peggiore guida il riepilogo", () => {
    const r = assessProduct(
      { safetyFields: true, allergens: ["gluten"], traces: ["eggs"], ingredientsText: "farina di frumento", ingredientsLang: IT },
      { allergens: ["glutine", "uova", "latte", "Latte"], excludedFoods: ["latte", "funghi"] },
    );
    expect(r.outcomes.map((o) => [o.declared, o.verdict])).toEqual([
      ["glutine", "contains"],
      ["uova", "traces"],
      ["latte", "not_found"],
      ["funghi", "not_found"],
    ]);
    expect(r.verdict).toBe("contains");
  });

  it("senza nulla di dichiarato non c'è esito", () => {
    expect(assessProduct({ allergens: ["milk"] }, {})).toEqual({ verdict: "none", outcomes: [] });
    expect(assessProduct({ allergens: ["milk"] }, { allergens: ["  "], excludedFoods: [""] })).toEqual({ verdict: "none", outcomes: [] });
  });

  it("senza dati il riepilogo è incerto, non «non risulta»", () => {
    expect(assessProduct({ safetyFields: true }, { allergens: ["latte"], excludedFoods: ["funghi"] }).verdict).toBe("uncertain");
  });

  it("tolleranza ai dati sporchi dei volontari", () => {
    const dirty = { allergens: ["", "  ", "EN:Milk"], traces: [" "], ingredientsText: "\n\t", name: undefined } as ProductFacts;
    expect(one(dirty, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "tag" });
  });
});
