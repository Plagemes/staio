import { describe, expect, it } from "vitest";
import type { NutrientKey, ReferenceComparison } from "../nutrition";
import type { Candidate } from "./alternatives";
import { shelfVerdict } from "./shelf";
import { product, withNutrients } from "./test-helpers";

const CATS = ["snacks", "biscuits"];

const fiberBelow: ReferenceComparison = {
  nutrient: "fiberG" satisfies NutrientKey,
  kind: "AI",
  reference: { nutrient: "fiberG", kind: "AI", ageMin: 18, amount: 25, source: { body: "prova", document: "prova", url: "https://example.test" } },
  periodDays: 7,
  completeDays: 7,
  daysWithData: 7,
  status: "compared",
  outcome: { kind: "AI", intake: 10, referenceAmount: 25, coveredShare: 0.4 },
  averageMissingShare: 0,
  certainty: "label",
};

const biscuits = withNutrients(
  "100",
  { energyKcal: 450, fat: 18, saturatedFat: 8, sugars: 30, salt: 0.5, fiber: 3 },
  { name: "Biscotti", categories: CATS, nova: 4, nutriScore: "d" },
);

const better: Candidate = {
  product: withNutrients(
    "200",
    { energyKcal: 400, fat: 10, saturatedFat: 3, sugars: 12, salt: 0.5, fiber: 6 },
    { name: "Biscotti integrali", categories: CATS, nova: 3, nutriScore: "c" },
  ),
  prices: [{ totalCents: 250, amount: 500, unit: "g", store: "Mercato" }],
};

describe("shelfVerdict", () => {
  it("riunisce dimensioni, effetto per l'utente, dispensa e alternativa", () => {
    const v = shelfVerdict({
      product: biscuits,
      comparisons: [fiberBelow],
      candidates: [better],
      pantry: { has: true, amount: 400, unit: "g" },
    });
    expect(v.headline).toContain("Biscotti");
    expect(v.headline).toContain("sfavorevoli");
    expect(v.lines[0]).toMatch(/^Sfavorevole: .*Grassi saturi/);
    expect(v.lines.some((l) => l.startsWith("Per te aiuta:") && l.includes("fibre"))).toBe(true);
    expect(v.pantryLine).toBe("Ne hai già in casa (400 g).");
    expect(v.alternative?.product.barcode).toBe("200");
    expect(v.lines.at(-1)).toContain("Biscotti integrali");
    expect(v.lines.at(-1)).toContain("5 € al kg");
  });

  it("senza dato sulla dispensa non dice nulla", () => {
    const v = shelfVerdict({ product: biscuits, comparisons: [fiberBelow] });
    expect(v.pantryLine).toBeUndefined();
    expect(v.lines.some((l) => l.includes("in casa"))).toBe(false);
  });

  it("dispensa: se la ricerca è stata solo per codice il testo lo dice", () => {
    expect(shelfVerdict({ product: biscuits, pantry: { has: false } }).pantryLine).toBe("Nessuna confezione con questo codice in casa.");
    expect(shelfVerdict({ product: biscuits, pantry: { has: false, searchedBy: ["barcode"] } }).pantryLine).toBe("Nessuna confezione con questo codice in casa.");
  });

  it("dispensa: corrispondenza per nome o categoria fornita da chi chiama", () => {
    const byName = shelfVerdict({
      product: biscuits,
      pantry: { has: true, matchedBy: "name", matchLabel: "Biscotti secchi", amount: 300, unit: "g" },
    });
    expect(byName.pantryLine).toBe("In casa hai un prodotto con un nome simile: Biscotti secchi (300 g). Non è detto che sia lo stesso.");
    expect(shelfVerdict({ product: biscuits, pantry: { has: true, matchedBy: "category" } }).pantryLine).toContain("della stessa categoria");
    expect(shelfVerdict({ product: biscuits, pantry: { has: true, matchedBy: "barcode" } }).pantryLine).toBe("Ne hai già in casa.");
    expect(shelfVerdict({ product: biscuits, pantry: { has: false, searchedBy: ["barcode", "name", "category"] } }).pantryLine).toBe(
      "Non ne hai in casa (cercato per codice, per nome, per categoria).",
    );
  });

  it("motivo per cui non c'è un'alternativa, enumerato e con testo", () => {
    const noCat = shelfVerdict({ product: { ...biscuits, categories: undefined }, candidates: [better] });
    expect(noCat.alternative).toBeNull();
    expect(noCat.alternativeReason).toBe("no_category");
    expect(noCat.alternativeReasonText).toContain("non ha categorie");

    const other: Candidate = { product: withNutrients("400", { fat: 1 }, { categories: ["drinks"] }) };
    const none = shelfVerdict({ product: biscuits, candidates: [other] });
    expect(none.alternativeReason).toBe("no_candidates_in_category");
    expect(shelfVerdict({ product: biscuits }).alternativeReason).toBe("no_candidates_in_category");

    const worse: Candidate = { product: withNutrients("300", { fat: 30, saturatedFat: 12, sugars: 40, salt: 2 }, { categories: CATS, nova: 4, nutriScore: "e" }) };
    const notBetter = shelfVerdict({ product: biscuits, candidates: [worse] });
    expect(notBetter.alternativeReason).toBe("none_better");
    expect(notBetter.alternativeReasonText).toContain("nessuno è migliore");

    const good = withNutrients("500", { fat: 1, saturatedFat: 0.5, sugars: 1, salt: 0.1 }, { categories: CATS, nova: 1, nutriScore: "a" });
    const nothing = shelfVerdict({ product: good, candidates: [better] });
    expect(nothing.alternativeReason).toBe("nothing_to_improve");

    const found = shelfVerdict({ product: biscuits, candidates: [better] });
    expect(found.alternative).not.toBeNull();
    expect(found.alternativeReason).toBeUndefined();
  });

  it("nessuna alternativa se i candidati non sono migliori", () => {
    const worse: Candidate = { product: withNutrients("300", { fat: 30, saturatedFat: 12, sugars: 40, salt: 2 }, { categories: CATS, nova: 4, nutriScore: "e" }) };
    const v = shelfVerdict({ product: biscuits, candidates: [worse] });
    expect(v.alternative).toBeNull();
    expect(v.lines.some((l) => l.startsWith("Alternativa"))).toBe(false);
  });

  it("prodotto senza dati: tutto non valutabile e dati insufficienti per l'utente", () => {
    const v = shelfVerdict({ product: product("999") });
    expect(v.assessment.summary.notAssessable).toBe(7);
    expect(v.personal.status).toBe("insufficient_data");
    expect(v.lines[0]).toMatch(/^Non valutabile:/);
    expect(v.lines.some((l) => l.startsWith("Sfavorevole") || l.startsWith("Favorevole"))).toBe(false);
    expect(v.alternative).toBeNull();
  });

  it("senza confronti: lo dice con il motivo", () => {
    const v = shelfVerdict({ product: biscuits });
    expect(v.lines.some((l) => l.includes("non posso dire come incide su di te"))).toBe(true);
  });
});
