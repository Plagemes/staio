import { describe, expect, it } from "vitest";
import { assessProduct, type ProductFacts } from "./index";

const full = (product: ProductFacts): ProductFacts => ({ safetyFields: true, ...product });
const one = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) => assessProduct(full(product), criteria).outcomes[0];
const all = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) =>
  Object.fromEntries(assessProduct(full(product), criteria).outcomes.map((o) => [o.declared, o.verdict]));
const TEXT = (ingredientsText: string): ProductFacts => ({ ingredientsText, ingredientsLang: "it" });

describe("frasi sulle tracce dentro gli ingredienti", () => {
  it("«(può contenere latte)» tra parentesi non si porta via gli ingredienti che seguono", () => {
    const r = all(TEXT("burro di cacao (può contenere latte), latte intero in polvere, nocciole, lecitina di soia."), { allergens: ["latte", "frutta a guscio", "soia"] });
    expect(r).toEqual({ latte: "contains", "frutta a guscio": "contains", soia: "contains" });
  });

  it("«tracce di X» in mezzo all'elenco finisce alla virgola", () => {
    const r = all(TEXT("Farina di frumento, tracce di sesamo, uova, burro"), { allergens: ["uova", "latte", "sesamo"] });
    expect(r).toEqual({ uova: "contains", latte: "contains", sesamo: "traces" });
  });

  it("«tracce di latte» dentro una parentesi: il resto è ingrediente", () => {
    const r = all(TEXT("Cioccolato (pasta di cacao, tracce di latte), nocciole, latte scremato in polvere."), { allergens: ["latte", "frutta a guscio"] });
    expect(r).toEqual({ latte: "contains", "frutta a guscio": "contains" });
  });

  it("il punto decimale non chiude la frase; un punto di fine frase sì", () => {
    expect(all(TEXT("Riso, può contenere 0.5% latte"), { allergens: ["latte"] })).toEqual({ latte: "traces" });
    expect(all(TEXT("Riso. Può contenere soia. Contiene: uova."), { allergens: ["soia", "uova"] })).toEqual({ soia: "traces", uova: "contains" });
  });

  it("riconosce le formule diverse come tracce, non come ingredienti", () => {
    for (const phrase of [
      "Puo' contenere arachidi",
      "Può contenere arachidi",
      "PUÒ CONTENERE ARACHIDI",
      "Eventuali tracce: arachidi",
      "Nello stabilimento si lavorano anche arachidi.",
      "Prodotto in uno stabilimento che utilizza anche arachidi",
      "May contain peanuts",
      "Contiene tracce di arachidi",
    ]) {
      expect(all(TEXT(`Riso, sale. ${phrase}`), { allergens: ["arachidi"] }), phrase).toEqual({ arachidi: "traces" });
    }
  });

  it("un testo fatto solo di «può contenere» non è un elenco di ingredienti", () => {
    expect(one(TEXT("Può contenere tracce di soia."), { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
  });
});

describe("tag che il motore non riconosce", () => {
  it("tag in francese, tedesco e spagnolo valgono come l'allergene", () => {
    for (const [tag, declared] of [
      ["lait", "latte"], ["milch", "latte"], ["leche", "latte"], ["soja", "soia"], ["oeufs", "uova"], ["moutarde", "senape"],
      ["sellerie", "sedano"], ["arachides", "arachidi"], ["fruits-a-coque", "frutta a guscio"],
    ] as const) {
      expect(one({ allergens: [tag] }, { allergens: [declared] }), tag).toMatchObject({ verdict: "contains", reason: "tag" });
    }
  });

  it("i singoli cereali valgono come glutine e le singole noci come frutta a guscio", () => {
    for (const tag of ["barley", "oats", "rye", "spelt", "kamut", "wheat"]) expect(one({ allergens: [tag] }, { allergens: ["glutine"] }), tag).toMatchObject({ verdict: "contains" });
    for (const tag of ["almonds", "hazelnuts", "walnuts", "pistachios", "noisettes", "cashew-nuts"]) {
      expect(one({ allergens: [tag] }, { allergens: ["frutta a guscio"] }), tag).toMatchObject({ verdict: "contains" });
    }
    expect(one({ traces: ["almonds"], ...TEXT("riso") }, { allergens: ["frutta a guscio"] })).toMatchObject({ verdict: "traces", reason: "traces_tag" });
  });

  it("un tag sconosciuto non diventa «non risulta»: è incerto e si mostra", () => {
    const o = one({ allergens: ["zorbaz"], ...TEXT("Acqua, sale") }, { allergens: ["latte"] });
    expect(o).toMatchObject({ verdict: "uncertain", reason: "unknown_tag", term: "zorbaz" });
    expect(o?.text).toContain("zorbaz");
    expect(one({ traces: ["zorbaz"], ...TEXT("Acqua, sale") }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag" });
  });

  it("ciò che si trova altrove vince sul tag sconosciuto", () => {
    expect(one({ allergens: ["zorbaz"], ...TEXT("Acqua, latte") }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
    expect(one({ allergens: ["zorbaz"], traces: ["milk"], ...TEXT("Acqua") }, { allergens: ["latte"] })).toMatchObject({ verdict: "traces" });
  });
});

describe("dichiarato specifico contro tag di gruppo", () => {
  it("«nocciole» e «mandorle» contro nuts, «gamberi» contro crustaceans, «orzo» contro gluten: almeno incerto", () => {
    expect(all({ allergens: ["nuts"], ...TEXT("zucchero, cacao") }, { allergens: ["nocciole", "mandorle"] })).toEqual({ nocciole: "uncertain", mandorle: "uncertain" });
    expect(one({ allergens: ["crustaceans"], ...TEXT("sale") }, { allergens: ["gamberi"] })).toMatchObject({ verdict: "uncertain", reason: "group_tag", term: "crostacei" });
    expect(one({ allergens: ["gluten"], ...TEXT("sale") }, { allergens: ["orzo"] })).toMatchObject({ verdict: "uncertain", reason: "group_tag" });
  });

  it("lo stesso vale per le tracce e per le esclusioni che sono membri di un gruppo", () => {
    expect(one({ traces: ["nuts"], ...TEXT("riso") }, { allergens: ["nocciole"] })).toMatchObject({ verdict: "uncertain", reason: "group_traces" });
    expect(one({ allergens: ["gluten"], ...TEXT("sale") }, { excludedFoods: ["pasta"] })).toMatchObject({ verdict: "uncertain", reason: "group_tag" });
  });

  it("un gruppo diverso non conta, e il tag che nomina proprio la voce dichiarata è contains", () => {
    expect(one({ allergens: ["milk"], ...TEXT("sale") }, { allergens: ["nocciole"] })).toMatchObject({ verdict: "not_found" });
    expect(one({ allergens: ["nocciola"], ...TEXT("sale") }, { allergens: ["nocciole"] })).toMatchObject({ verdict: "contains", reason: "tag" });
  });
});

describe("i tag non abbassano mai l'esito", () => {
  it("senza testo ingredienti l'esito base è incerto, con qualunque tag", () => {
    expect(one({ allergens: ["gluten"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
    expect(one({ traces: ["nuts"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
    expect(one({ allergens: ["milk"] }, { excludedFoods: ["maiale"] })).toMatchObject({ verdict: "uncertain", reason: "no_data" });
  });

  it("i tag possono solo alzare l'esito", () => {
    expect(one({ allergens: ["milk"] }, { allergens: ["latte"] })?.verdict).toBe("contains");
    expect(one({ traces: ["milk"] }, { allergens: ["latte"] })?.verdict).toBe("traces");
  });

  it("una scheda salvata prima (senza il segno) non è mai «non risulta»", () => {
    const stale = { allergens: ["gluten"], ...TEXT("Acqua, sale"), safetyFields: false };
    expect(one(stale, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "stale" });
    expect(one({ ...stale, allergens: ["milk"] }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains" });
    expect(assessProduct(TEXT("Acqua, sale"), { allergens: ["latte"] }).verdict).toBe("uncertain");
  });
});

describe("i dubbi del motore", () => {
  it("ingredienti generici che possono nascondere un allergene dichiarato: incerto", () => {
    expect(all(TEXT("Patate, olio, sale, aromi, spezie"), { allergens: ["sedano", "senape"] })).toEqual({ sedano: "uncertain", senape: "uncertain" });
    expect(one(TEXT("Patate, olio, sale, aromi, spezie"), { allergens: ["sedano"] })).toMatchObject({ reason: "generic" });
  });

  it("alfabeti mescolati («lаtte» con la «а» cirillica): incerto, per allergeni ed esclusioni", () => {
    const product = TEXT("Zucchero, lаtte intero, cacao");
    expect(one(product, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "mixed_script" });
    expect(one(product, { excludedFoods: ["funghi"] })).toMatchObject({ verdict: "uncertain", reason: "mixed_script" });
  });

  it("un elenco semplice resta «non risulta»", () => {
    expect(one(TEXT("Acqua, sale, pomodori"), { allergens: ["latte", "sedano"] })).toMatchObject({ verdict: "not_found" });
  });
});

describe("testo tagliato", () => {
  it("se il testo è stato tagliato e nulla si trova è incerto; se si trova è contains", () => {
    expect(one({ ...TEXT("Acqua, sale"), ingredientsTruncated: true }, { allergens: ["latte"] })).toMatchObject({ verdict: "uncertain", reason: "truncated" });
    expect(one({ ...TEXT("Acqua, latte"), ingredientsTruncated: true }, { allergens: ["latte"] })).toMatchObject({ verdict: "contains" });
  });
});
