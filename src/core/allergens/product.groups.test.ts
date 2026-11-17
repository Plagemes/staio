import { describe, expect, it } from "vitest";
import { assessProduct, type ProductFacts } from "./index";

const full = (product: ProductFacts): ProductFacts => ({ safetyFields: true, ...product });
const one = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) => assessProduct(full(product), criteria).outcomes[0];
const all = (product: ProductFacts, criteria: Parameters<typeof assessProduct>[1]) =>
  Object.fromEntries(assessProduct(full(product), criteria).outcomes.map((o) => [o.declared, o.verdict]));
const TEXT = (ingredientsText: string): ProductFacts => ({ ingredientsText, ingredientsLang: "it" });

describe("gruppo scritto nel testo degli ingredienti", () => {
  it("«frutta a guscio» e «frutta secca» con nocciole o mandorle dichiarate: almeno incerto", () => {
    expect(all(TEXT("Cereali, frutta a guscio in proporzione variabile, miele"), { allergens: ["nocciole", "mandorle"] })).toEqual({ nocciole: "uncertain", mandorle: "uncertain" });
    expect(one(TEXT("Cereali, frutta secca, miele"), { allergens: ["nocciole"] })).toMatchObject({ verdict: "uncertain", reason: "group_text", term: "frutta secca" });
  });

  it("«crostacei» con gamberi, «pesce» con tonno, «cereali» con orzo", () => {
    expect(one(TEXT("Riso, crostacei, sale"), { allergens: ["gamberi"] })).toMatchObject({ verdict: "uncertain", reason: "group_text" });
    expect(one(TEXT("Riso, pesce, sale"), { allergens: ["tonno"] })).toMatchObject({ verdict: "uncertain", reason: "group_text" });
    expect(one(TEXT("Cereali (frumento, segale), sale"), { allergens: ["orzo"] })).toMatchObject({ verdict: "uncertain", reason: "group_text" });
  });

  it("vale anche per le esclusioni, e in inglese", () => {
    expect(one(TEXT("Riso, crostacei"), { excludedFoods: ["gamberi"] })).toMatchObject({ verdict: "uncertain" });
    expect(one({ ingredientsText: "Rice, shellfish, salt", ingredientsLang: "en" }, { allergens: ["gamberi"] })).toMatchObject({ verdict: "uncertain", reason: "group_text" });
  });

  it("un gruppo diverso, o una voce senza gruppo nominato, resta «non risulta»", () => {
    expect(one(TEXT("Riso, pesce, sale"), { allergens: ["nocciole"] })).toMatchObject({ verdict: "not_found" });
    expect(one(TEXT("Farina di frumento, sale"), { allergens: ["orzo"] })).toMatchObject({ verdict: "not_found" });
  });

  it("se la voce dichiarata è nominata davvero, vince contains", () => {
    expect(one(TEXT("Cereali, mandorle"), { allergens: ["mandorle"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
  });
});

describe("gruppo e frasi sulle tracce", () => {
  it("«Può contenere frutta secca» con nocciole: almeno incerto, mai «non risulta»", () => {
    expect(one(TEXT("Riso, sale. Può contenere frutta secca."), { allergens: ["nocciole"] })).toMatchObject({ verdict: "uncertain", reason: "group_traces" });
  });

  it("una frase in inglese dentro un testo italiano si legge con la mappa dei tag", () => {
    expect(one(TEXT("Riso, sale. May contain nuts."), { allergens: ["frutta a guscio"] })).toMatchObject({ verdict: "traces", reason: "traces_text" });
    expect(one(TEXT("Riso, sale. May contain nuts."), { allergens: ["nocciole"] })).toMatchObject({ verdict: "uncertain", reason: "group_traces" });
    expect(one(TEXT("Riso, sale. May contain shellfish."), { allergens: ["gamberi"] })).toMatchObject({ verdict: "uncertain", reason: "group_traces" });
    expect(one(TEXT("Riso, sale. May contain milk."), { allergens: ["latte"] })).toMatchObject({ verdict: "traces" });
  });

  it("una frase letta che riguarda altro non cambia nulla", () => {
    expect(one(TEXT("Riso, sale. May contain nuts."), { allergens: ["latte"] })).toMatchObject({ verdict: "not_found" });
  });

  it("una frase sulle tracce che non si capisce rende incerte tutte le voci", () => {
    const r = all(TEXT("Riso, sale. May contain xyzzy."), { allergens: ["latte"], excludedFoods: ["funghi"] });
    expect(r).toEqual({ latte: "uncertain", funghi: "uncertain" });
    expect(one(TEXT("Riso, sale. May contain xyzzy."), { allergens: ["latte"] })).toMatchObject({ reason: "traces_unreadable" });
  });
});

describe("tag con parole che il sinonimo non spiega", () => {
  it("«noix de coco» e «coconut milk» con cocco dichiarato: incerto, non «non risulta»", () => {
    expect(one({ allergens: ["noix-de-coco"], ...TEXT("Acqua, sale") }, { allergens: ["cocco"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag" });
    expect(one({ allergens: ["coconut-milk"], ...TEXT("Acqua, sale") }, { allergens: ["cocco"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag" });
  });

  it("«nuez moscada» non è frutta a guscio", () => {
    expect(one({ allergens: ["nuez-moscada"], ...TEXT("Acqua") }, { allergens: ["frutta a guscio"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag" });
    expect(one({ allergens: ["nuez-moscada"], ...TEXT("Acqua") }, { allergens: ["nocciole"] })?.verdict).toBe("uncertain");
  });

  it("un tag con parole sconosciute accanto a un sinonimo non esclude le altre voci", () => {
    expect(one({ allergens: ["milk-protein"], ...TEXT("Acqua, sale") }, { allergens: ["uova"] })).toMatchObject({ verdict: "uncertain", reason: "unknown_tag" });
  });

  it("«gluten free», «sans lactose», «milk free» non sono contains: incerti", () => {
    for (const [tag, declared] of [["gluten-free", "glutine"], ["sans-lactose", "latte"], ["milk-free", "latte"]] as const) {
      const o = one({ allergens: [tag], ...TEXT("Acqua, sale") }, { allergens: [declared] });
      expect(o?.verdict, tag).toBe("uncertain");
    }
  });
});

describe("chiusura delle frasi sulle tracce", () => {
  it("«[può contenere latte], latte intero»: il latte intero è ingrediente", () => {
    expect(one(TEXT("Zucchero, [può contenere latte], latte intero in polvere"), { allergens: ["latte"] })).toMatchObject({ verdict: "contains", reason: "ingredients" });
  });

  it("la parola «ingredienti» riapre l'elenco", () => {
    const r = all(TEXT("PUÒ CONTENERE TRACCE DI SOIA INGREDIENTI: LATTE, UOVA"), { allergens: ["latte", "uova", "soia"] });
    expect(r).toEqual({ latte: "contains", uova: "contains", soia: "traces" });
    expect(all({ ingredientsText: "May contain soy. Ingredients: milk, eggs", ingredientsLang: "en" }, { allergens: ["latte", "uova"] })).toEqual({ latte: "contains", uova: "contains" });
  });
});

describe("testo dell'esito di gruppo", () => {
  it("nomina l'allergene in italiano, non il tag grezzo", () => {
    const o = one({ allergens: ["nuts"], ...TEXT("Acqua") }, { allergens: ["nocciole"] });
    expect(o).toMatchObject({ reason: "group_tag", term: "frutta a guscio" });
    expect(o?.text).toContain("frutta a guscio");
    expect(o?.text).not.toContain("nuts");
    expect(one({ allergens: ["crustaceans"], ...TEXT("Acqua") }, { allergens: ["gamberi"] })?.text).toContain("crostacei");
  });
});
