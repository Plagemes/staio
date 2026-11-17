import { describe, expect, it } from "vitest";
import { nutrientsOfQuantity } from "./amounts";
import { compositionFromFood } from "./resolve";
import { FAKE_FOODS } from "./test-helpers";
import { applyYield, convertCompositionState, findYield, type YieldRule } from "./yield";

// La resa 2,2 è finta: serve solo a far tornare i conti.
const RULES: YieldRule[] = [
  { foodId: "pasta-secca", cookedPerRaw: 2.2, method: "bollitura" },
  { foodId: "pasta-secca", cookedPerRaw: 2.0, method: "al dente" },
  { foodId: "mela", cookedPerRaw: 0.9 },
  { foodId: "uovo", cookedPerRaw: 0 },
];

const pasta = () => {
  const f = FAKE_FOODS.find((x) => x.id === "pasta-secca");
  if (!f) throw new Error("pasta");
  return compositionFromFood(f);
};

describe("applyYield", () => {
  it("passa dal crudo al cotto e viceversa", () => {
    expect(applyYield(100, 2.2, "toCooked")).toBe(220);
    expect(applyYield(220, 2.2, "toRaw")).toBe(100);
  });

  it("rifiuta pesi e rese non validi", () => {
    expect(applyYield(-1, 2, "toCooked")).toBeUndefined();
    expect(applyYield(Number.NaN, 2, "toCooked")).toBeUndefined();
    expect(applyYield(100, 0, "toCooked")).toBeUndefined();
    expect(applyYield(100, -2, "toRaw")).toBeUndefined();
  });
});

describe("findYield", () => {
  it("trova la resa per alimento e, se serve, per metodo", () => {
    expect(findYield(RULES, "mela")?.cookedPerRaw).toBe(0.9);
    expect(findYield(RULES, "pasta-secca", "al dente")?.cookedPerRaw).toBe(2.0);
  });

  it("con rese diverse e nessun metodo non sceglie; senza regola o con resa non valida, nulla", () => {
    expect(findYield(RULES, "pasta-secca")).toBeUndefined();
    expect(findYield(RULES, "pollo-petto-crudo")).toBeUndefined();
    expect(findYield(RULES, "uovo")).toBeUndefined();
  });
});

describe("convertCompositionState", () => {
  it("per 100 g di cotto: i nutrienti si diluiscono, l'acqua cresce", () => {
    const cooked = convertCompositionState(pasta(), 2.2, "toCooked");
    expect(cooked?.per100.proteinG).toBeCloseTo(12 / 2.2, 5);
    expect(cooked?.per100.energyKcal).toBeCloseTo(350 / 2.2, 5);
    expect(cooked?.per100.waterG).toBeCloseTo((10 + 120) / 2.2, 5);
  });

  it("l'energia totale si conserva: 100 g di secco = 220 g di cotto", () => {
    const cooked = convertCompositionState(pasta(), 2.2, "toCooked");
    if (!cooked) throw new Error("cotto");
    const r = nutrientsOfQuantity(cooked, { value: 220, unit: "g" }, "measured");
    expect(r.ok && r.value.nutrients.energyKcal).toBeCloseTo(350, 3);
  });

  it("l'andata e ritorno restituisce la composizione di partenza", () => {
    const cooked = convertCompositionState(pasta(), 2.2, "toCooked");
    if (!cooked) throw new Error("cotto");
    const back = convertCompositionState(cooked, 2.2, "toRaw");
    expect(back?.per100.proteinG).toBeCloseTo(12, 4);
    expect(back?.per100.waterG).toBeCloseTo(10, 4);
  });

  it("il risultato è una stima e non porta pezzo né densità", () => {
    const base = { ...pasta(), unitWeightG: 50, densityGPerMl: 0.7 };
    const cooked = convertCompositionState(base, 2.2, "toCooked");
    expect(cooked?.origin).toBe("derived");
    expect(cooked?.unitWeightG).toBeUndefined();
    expect(cooked?.densityGPerMl).toBeUndefined();
    const r = nutrientsOfQuantity(cooked!, { value: 100, unit: "g" }, "measured");
    expect(r.ok && r.value.certainty).toBe("estimated");
  });

  it("non inventa un'acqua impossibile e non tocca i nutrienti assenti", () => {
    const dry = { ...pasta(), per100: { waterG: 5, energyKcal: 100 } };
    expect(convertCompositionState(dry, 0.5, "toCooked")?.per100.waterG).toBeUndefined();
    expect("carbsG" in (convertCompositionState(dry, 2, "toCooked")?.per100 ?? {})).toBe(false);
  });

  it("rifiuta composizioni a volume e rese non valide", () => {
    expect(convertCompositionState({ ...pasta(), basis: "ml" }, 2, "toCooked")).toBeUndefined();
    expect(convertCompositionState(pasta(), 0, "toCooked")).toBeUndefined();
  });
});
