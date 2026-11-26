import { describe, expect, it } from "vitest";
import { assessProduct } from "@/core/allergens";
import { NEED_INGREDIENTS_TEXT, DECLARATIONS_UNREADABLE_NOTE, RESTRICTED_SAFETY_TEXT, SAFETY_FLAGS, SAFETY_HEADINGS, assessForCard, safetySourceNote, sortOutcomes, storeCodeQuestion } from "./safetyText";

describe("testi del controllo sulla scheda", () => {
  it("dice che il controllo è incompleto se il piano non si legge", () => {
    expect(DECLARATIONS_UNREADABLE_NOTE).toMatch(/incompleto/);
    expect(DECLARATIONS_UNREADABLE_NOTE).toMatch(/allergeni che hai indicato/);
  });

  it("nessun titolo suona come un via libera", () => {
    for (const text of [...Object.values(SAFETY_HEADINGS), ...Object.values(SAFETY_FLAGS)]) {
      expect(text).not.toMatch(/compatibil|sicuro|puoi mangiar|va bene|ok\b/i);
    }
  });

  it("mette per primi gli esiti più gravi", () => {
    const { outcomes } = assessProduct(
      { safetyFields: true, allergens: ["gluten"], traces: ["eggs"], ingredientsText: "farina di frumento", ingredientsLang: "it" },
      { allergens: ["latte", "uova", "glutine"] },
    );
    expect(sortOutcomes(outcomes).map((o) => o.verdict)).toEqual(["contains", "traces", "not_found"]);
  });
});

describe("controllo sulla scheda di un codice interno del negozio", () => {
  const off = (barcode: string, source: string) => ({
    barcode,
    source,
    name: "Latte bulgaro",
    allergens: ["milk"],
    ingredientsText: "latte intero",
    ingredientsLang: "it",
    safetyFields: true,
  });
  const criteria = { allergens: ["latte", "pesce"], excludedFoods: ["cipolla"] };

  it("i dati di quella scheda non contano: ogni voce dichiarata è «incerto»", () => {
    const a = assessForCard(off("2000000000015", "openfoodfacts"), criteria);
    expect(a.verdict).toBe("uncertain");
    expect(a.outcomes.map((o) => [o.declared, o.verdict, o.text])).toEqual([
      ["latte", "uncertain", RESTRICTED_SAFETY_TEXT],
      ["pesce", "uncertain", RESTRICTED_SAFETY_TEXT],
      ["cipolla", "uncertain", RESTRICTED_SAFETY_TEXT],
    ]);
  });
  it("senza nulla di dichiarato non c'è niente da mostrare", () => {
    expect(assessForCard(off("2000000000015", "openfoodfacts"), {}).verdict).toBe("none");
  });
  it("un codice normale si controlla come sempre", () => {
    expect(assessForCard(off("8076800195057", "openfoodfacts"), criteria).outcomes[0].verdict).toBe("contains");
  });
  it("una scheda scritta dall'utente per un codice interno vale solo dopo la sua conferma", () => {
    expect(assessForCard(off("2000000000015", "manual"), criteria).outcomes[0].verdict).toBe("uncertain");
    expect(assessForCard(off("2000000000015", "manual"), criteria, { confirmed: true }).outcomes[0].verdict).toBe("contains");
  });
});

describe("scheda scritta dall'utente, ancora senza ingredienti", () => {
  const blank = { barcode: "8000000000017", source: "manual", name: "Biscotti" };

  it("non dice «scheda salvata prima» né parla di rete: chiede gli ingredienti", () => {
    const a = assessForCard(blank, { allergens: ["latte"] });
    expect(a.outcomes[0].verdict).toBe("uncertain");
    expect(a.outcomes[0].text).toBe(NEED_INGREDIENTS_TEXT);
    expect(a.outcomes[0].text).not.toMatch(/rete|salvata prima|Open Food Facts/);
  });
  it("per la foto vale lo stesso, prima della lettura", () => {
    expect(assessForCard({ ...blank, source: "label_photo" }, { allergens: ["latte"] }).outcomes[0].text).toBe(NEED_INGREDIENTS_TEXT);
  });
  it("la fonte sotto il controllo: nessuna senza ingredienti, «scritti da te» con gli ingredienti scritti, Open Food Facts per i suoi", () => {
    expect(safetySourceNote({ source: "manual" }, "dato OFF")).toBeNull();
    expect(safetySourceNote({ source: "manual", labelPhoto: { ingredients: true, by: "manual" } }, "dato OFF")).toMatch(/scritti tu/);
    expect(safetySourceNote({ source: "label_photo", labelPhoto: { ingredients: true } }, "dato OFF")).toMatch(/foto/);
    expect(safetySourceNote({ source: "openfoodfacts" }, "dato OFF")).toBe("dato OFF");
  });
  it("con gli ingredienti scritti il controllo funziona e non si mescola con Open Food Facts", () => {
    const a = assessForCard({ ...blank, ingredientsText: "farina, latte", ingredientsLang: "it", safetyFields: true, ingredientsTruncated: true }, { allergens: ["latte", "pesce"] });
    expect(a.outcomes.map((o) => o.verdict)).toEqual(["contains", "uncertain"]);
    expect(a.outcomes[1].text).not.toBe(NEED_INGREDIENTS_TEXT);
  });
});

describe("codice interno del negozio con la scheda dell'utente", () => {
  const mine = {
    barcode: "2000000012345",
    source: "manual",
    name: "Prosciutto cotto",
    ingredientsText: "coscia di suino, sale",
    ingredientsLang: "it",
    safetyFields: true,
  };
  const criteria = { allergens: ["latte", "pesce"] };

  it("finché non conferma, ogni voce è «incerto»: niente «non risulta» per il latte", () => {
    const a = assessForCard(mine, criteria);
    expect(a.outcomes.map((o) => [o.declared, o.verdict])).toEqual([["latte", "uncertain"], ["pesce", "uncertain"]]);
    expect(assessForCard(mine, criteria, { confirmed: false }).verdict).toBe("uncertain");
  });
  it("dopo «Sì, è questo» il controllo vale", () => {
    const a = assessForCard(mine, criteria, { confirmed: true });
    expect(a.outcomes.map((o) => o.verdict)).toEqual(["not_found", "not_found"]);
  });
  it("una scheda creata dal nome non è di un negozio: nessuna conferma", () => {
    expect(assessForCard({ ...mine, localFromName: true }, criteria).outcomes[0].verdict).toBe("not_found");
  });
  it("la domanda dice cos'era l'ultima volta", () => {
    expect(storeCodeQuestion("Prosciutto cotto")).toBe("Codice interno del negozio: l'ultima volta era «Prosciutto cotto». È ancora questo prodotto?");
    expect(storeCodeQuestion(undefined)).toContain("un prodotto senza nome");
    expect(storeCodeQuestion("x".repeat(100)).length).toBeLessThan(140);
  });
});
