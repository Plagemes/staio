import { describe, expect, it } from "vitest";
import type { NutrientKey, ReferenceComparison, ReferenceKind } from "../nutrition";
import { personalVerdict } from "./personal";
import { product, withNutrients } from "./test-helpers";

function base(nutrient: NutrientKey, kind: ReferenceKind) {
  return {
    nutrient,
    kind,
    reference: { nutrient, kind, ageMin: 18, source: { body: "prova", document: "prova", url: "https://example.test" } },
    periodDays: 7,
    completeDays: 7,
    daysWithData: 7,
  };
}

const covered = (nutrient: NutrientKey, share: number): ReferenceComparison => ({
  ...base(nutrient, "AI"),
  status: "compared",
  outcome: { kind: "AI", intake: 10, referenceAmount: 25, coveredShare: share },
  averageMissingShare: 0,
  certainty: "label",
});

const upper = (nutrient: NutrientKey, exceeds: boolean): ReferenceComparison => ({
  ...base(nutrient, "UL"),
  status: "compared",
  outcome: { kind: "UL", intake: 12, limit: 10, ratio: 1.2, exceeds, daysOver: 3 },
  averageMissingShare: 0,
  certainty: "label",
});

const range = (nutrient: NutrientKey, position: "below_range" | "within_range" | "above_range"): ReferenceComparison => ({
  ...base(nutrient, "RI"),
  status: "compared",
  outcome: { kind: "RI", percentOfEnergy: 40, min: 20, max: 35, position },
  averageMissingShare: 0,
  certainty: "label",
});

const noAmount = (nutrient: NutrientKey, intake?: number): ReferenceComparison => ({
  ...base(nutrient, "AI"),
  status: "not_comparable",
  reason: "no_amount",
  ...(intake !== undefined ? { intake } : {}),
});

const insufficient = (nutrient: NutrientKey): ReferenceComparison => ({
  ...base(nutrient, "PRI"),
  status: "insufficient_data",
  reason: "few_complete_days",
  required: 5,
});

const rusks = withNutrients("1", { fiber: 6, salt: 1.2, sugars: 3, fat: 8, saturatedFat: 4 });

describe("personalVerdict", () => {
  it("contribuisce a un nutriente sotto il riferimento", () => {
    const v = personalVerdict(rusks, [covered("fiberG", 0.6)]);
    expect(v.status).toBe("ok");
    expect(v.helps).toHaveLength(1);
    expect(v.helps[0]).toMatchObject({ nutrient: "fiber", effect: "helps", basis: "reference" });
    expect(v.helps[0].text).toContain("60%");
    expect(v.weighs).toEqual([]);
  });

  it("nessuna affermazione se l'assunzione ha già raggiunto il riferimento", () => {
    const v = personalVerdict(rusks, [covered("fiberG", 1.2)]);
    expect(v.helps).toEqual([]);
    expect(v.weighs).toEqual([]);
  });

  it("aggiunge un nutriente che supera già il limite massimo", () => {
    const v = personalVerdict(rusks, [upper("saturatedFatG", true), upper("sugarsG", false)]);
    expect(v.weighs).toHaveLength(1);
    expect(v.weighs[0]).toMatchObject({ nutrient: "saturatedFat", effect: "weighs" });
    expect(v.weighs[0].text).toContain("supera");
  });

  it("intervallo di riferimento: sopra pesa, sotto aiuta, dentro niente", () => {
    expect(personalVerdict(rusks, [range("fatG", "above_range")]).weighs).toHaveLength(1);
    expect(personalVerdict(rusks, [range("fatG", "below_range")]).helps).toHaveLength(1);
    const within = personalVerdict(rusks, [range("fatG", "within_range")]);
    expect(within.helps).toEqual([]);
    expect(within.weighs).toEqual([]);
  });

  it("riferimento senza valore numerico: mostra l'assunzione ma non dice se è alta", () => {
    const v = personalVerdict(rusks, [noAmount("saltG", 7.5), covered("fiberG", 0.5)]);
    const note = v.info.find((s) => s.nutrient === "salt");
    expect(note?.text).toContain("7,5");
    expect(note?.text).toContain("non dico se è alta o bassa");
    expect(v.weighs).toEqual([]);
  });

  it("un nutriente che il prodotto non contiene non genera affermazioni", () => {
    const v = personalVerdict(withNutrients("2", { fiber: 0, salt: 0 }), [covered("fiberG", 0.1), upper("saltG", true)]);
    expect(v.helps).toEqual([]);
    expect(v.weighs).toEqual([]);
  });

  it("un nutriente assente nel prodotto non vale zero né genera affermazioni", () => {
    const v = personalVerdict(withNutrients("3", { sugars: 1 }), [covered("fiberG", 0.1)]);
    expect(v.helps).toEqual([]);
  });

  it("confronti con dati insufficienti: dati insufficienti, senza inventare", () => {
    const v = personalVerdict(rusks, [insufficient("fiberG")]);
    expect(v.status).toBe("insufficient_data");
    expect(v.reason).toContain("giorni completi");
    expect(v.helps).toEqual([]);
    expect(v.weighs).toEqual([]);
  });

  it("senza confronti né obiettivi: dati insufficienti", () => {
    expect(personalVerdict(rusks, undefined).status).toBe("insufficient_data");
    expect(personalVerdict(rusks, []).status).toBe("insufficient_data");
  });

  it("senza valori nutrizionali nel prodotto: dati insufficienti", () => {
    const v = personalVerdict(product("4"), [covered("fiberG", 0.1)], [{ nutrient: "fiber", direction: "increase" }]);
    expect(v.status).toBe("insufficient_data");
  });

  it("obiettivo ridurre il sale: rosso pesa, verde aiuta, ambra è solo informazione", () => {
    const goal = [{ nutrient: "salt", direction: "reduce" }] as const;
    const red = personalVerdict(withNutrients("5", { salt: 2 }), undefined, goal);
    expect(red.status).toBe("ok");
    expect(red.weighs[0]).toMatchObject({ nutrient: "salt", basis: "goal" });
    expect(personalVerdict(withNutrients("5", { salt: 0.1 }), undefined, goal).helps).toHaveLength(1);
    const amber = personalVerdict(withNutrients("5", { salt: 1 }), undefined, goal);
    expect(amber.helps).toEqual([]);
    expect(amber.weighs).toEqual([]);
    expect(amber.info[0].text).toContain("ambra");
  });

  it("obiettivo ridurre senza dato nel prodotto: lo dice", () => {
    const v = personalVerdict(withNutrients("6", { fat: 1 }), undefined, [{ nutrient: "salt", direction: "reduce" }]);
    expect(v.weighs).toEqual([]);
    expect(v.info[0].text).toContain("non riporta il valore");
  });

  it("obiettivo aumentare fibre: aiuta se ne contiene, altrimenti informazione", () => {
    const goal = [{ nutrient: "fiber", direction: "increase" }] as const;
    expect(personalVerdict(rusks, undefined, goal).helps[0].text).toContain("6");
    const none = personalVerdict(withNutrients("7", { fiber: 0 }), undefined, goal);
    expect(none.helps).toEqual([]);
    expect(none.info).toHaveLength(1);
  });

  it("obiettivo ridurre un nutriente senza soglia ufficiale: nessun giudizio", () => {
    const v = personalVerdict(withNutrients("8", { carbohydrates: 60 }), undefined, [{ nutrient: "carbohydrates", direction: "reduce" }]);
    expect(v.weighs).toEqual([]);
    expect(v.helps).toEqual([]);
    expect(v.info[0].text).toContain("non ho una soglia ufficiale");
  });
});
