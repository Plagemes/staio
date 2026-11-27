import { describe, expect, it } from "vitest";
import { ADVICE_RULE_IDS, type AdviceRuleId, type Indicator } from "../types";
import { ADVICE_RULES, OCCASIONAL_PER_WEEK, evaluateRule, type CatalogRule } from "./rules";
import { LAST_CLOSED, frame, ind, type FrameSpec } from "./test-helpers";

const rule = (id: AdviceRuleId): CatalogRule => ADVICE_RULES.find((r) => r.id === id)!;
const evalOn = (id: AdviceRuleId, spec: Omit<FrameSpec, "weekStart">, past: FrameSpec[] = []) =>
  evaluateRule(
    rule(id),
    frame({ ...spec, weekStart: LAST_CLOSED }),
    past.map((p) => frame(p)),
  );

describe("catalogo delle regole", () => {
  it("copre ogni id del contratto una volta, con indicatori distinti", () => {
    expect(ADVICE_RULES.map((r) => r.id).sort()).toEqual([...ADVICE_RULE_IDS].sort());
    expect(new Set(ADVICE_RULES.map((r) => r.indicator)).size).toBe(ADVICE_RULES.length);
  });

  it("nessuna regola su alcol, latte e yogurt", () => {
    for (const r of ADVICE_RULES) {
      expect(r.indicator).not.toMatch(/alcohol|milkYogurt/);
      expect(r.lookFor).not.toContain("alcohol");
      expect(r.lookFor).not.toContain("milkYogurt");
    }
  });

  it("le carni citano CREA", () => {
    for (const id of ["redMeatHigh", "processedMeatOften"] as const) {
      expect(rule(id).source).toBe("crea-lg-2018");
      expect(rule(id).sourceFromTarget).toBe(false);
    }
  });

  it("gli ultra-processati usano solo il proprio andamento", () => {
    expect(rule("processedShareUp").source).toBe("ownTrend");
  });

  it("soglie di «occasionale» decise", () => {
    expect(OCCASIONAL_PER_WEEK).toEqual({ processedMeat: 1, cakesIceCream: 2, snacksChocolate: 2, sugaryDrinks: 1 });
  });

  it("un quadro calmo non fa scattare nessuna regola", () => {
    const past = [0, 1, 2].map((i) => ({ weekStart: `2026-10-${26 + i}` }));
    for (const r of ADVICE_RULES) {
      expect(evaluateRule(r, frame({ weekStart: LAST_CLOSED }), past.map((p) => frame(p))).kind).toBe("not_triggered");
    }
  });
});

describe("regole «increase»: scattano solo su «sotto»", () => {
  const cases: [AdviceRuleId, Indicator, Indicator][] = [
    ["vegFruitLow", ind("vegFruit", "below", 200), ind("vegFruit", "atLeast", 200, { lowerBound: true })],
    ["legumesLow", ind("group:legumes", "below", 1), ind("group:legumes", "atLeast", 1, { lowerBound: true })],
    ["fishLow", ind("group:fish", "below", 0), ind("group:fish", "within", 2)],
    ["wholeGrainLow", ind("wholeGrainShare", "below", 0.2), ind("wholeGrainShare", "within", 0.6)],
    ["nutsLow", ind("group:nutsSeeds", "below", 1), ind("group:nutsSeeds", "atLeast", 1, { lowerBound: true })],
    ["fiberLow", ind("fiber", "below", 15), ind("fiber", "within", 26)],
  ];
  for (const [id, fires, quiet] of cases) {
    it(id, () => {
      const on = evalOn(id, { indicators: [fires] });
      expect(on.kind).toBe("fired");
      if (on.kind === "fired") {
        expect(on.severity).toBeGreaterThan(0);
        expect(on.severity).toBeLessThanOrEqual(1);
      }
      expect(evalOn(id, { indicators: [quiet] }).kind).toBe("not_triggered");
      expect(evalOn(id, { indicators: [{ ...fires, status: "insufficient" }] }).kind).toBe("insufficient");
    });
  }

  it("la severità cresce con lo scarto", () => {
    const a = evalOn("legumesLow", { indicators: [ind("group:legumes", "below", 1.5)] });
    const b = evalOn("legumesLow", { indicators: [ind("group:legumes", "below", 0)] });
    expect(a.kind === "fired" && b.kind === "fired" && a.severity < b.severity).toBe(true);
    expect(b.kind === "fired" && b.severity).toBe(1);
  });

  it("un quadro con pochi giorni o poca copertura è insufficiente", () => {
    expect(evalOn("legumesLow", { daysWithData: 3, indicators: [ind("group:legumes", "below", 0)] }).kind).toBe("insufficient");
    expect(evalOn("legumesLow", { coverage: 0.5, indicators: [ind("group:legumes", "below", 0)] }).kind).toBe("insufficient");
  });
});

describe("regole «decrease»", () => {
  it("redMeatHigh: sopra il massimo", () => {
    expect(evalOn("redMeatHigh", { indicators: [ind("group:redMeat", "above", 3)] }).kind).toBe("fired");
    expect(evalOn("redMeatHigh", { indicators: [ind("group:redMeat", "within", 1)] }).kind).toBe("not_triggered");
  });

  it("saltHigh: sopra i 5 g", () => {
    expect(evalOn("saltHigh", { indicators: [ind("salt", "above", 8)] }).kind).toBe("fired");
    expect(evalOn("saltHigh", { indicators: [ind("salt", "within", 4.5)] }).kind).toBe("not_triggered");
  });

  it("freeSugarsHigh: sopra il 10% anche con un minimo", () => {
    expect(evalOn("freeSugarsHigh", { indicators: [ind("freeSugars", "above", 14, { lowerBound: true })] }).kind).toBe("fired");
    expect(evalOn("freeSugarsHigh", { indicators: [ind("freeSugars", "within", 8)] }).kind).toBe("not_triggered");
  });

  it("processedMeatOften: oltre 1 volta a settimana", () => {
    expect(evalOn("processedMeatOften", { indicators: [ind("group:processedMeat", "occasional", 2)] }).kind).toBe("fired");
    expect(evalOn("processedMeatOften", { indicators: [ind("group:processedMeat", "occasional", 1)] }).kind).toBe("not_triggered");
  });

  it("processedMeatOften conta le volte (occasioni), non le porzioni", () => {
    const spec = { indicators: [ind("group:processedMeat", "occasional", 0.5)], rowOccasions: { processedMeat: 3 } };
    expect(evalOn("processedMeatOften", spec).kind).toBe("fired");
  });

  it("sweetsDrinksOften: sceglie la riga con lo scarto maggiore", () => {
    const quiet = evalOn("sweetsDrinksOften", {
      indicators: [ind("group:cakesIceCream", "occasional", 2), ind("group:sugaryDrinks", "occasional", 1)],
    });
    expect(quiet.kind).toBe("not_triggered");
    const drinks = evalOn("sweetsDrinksOften", {
      indicators: [ind("group:cakesIceCream", "occasional", 3), ind("group:sugaryDrinks", "occasional", 4)],
    });
    expect(drinks.kind).toBe("fired");
    if (drinks.kind === "fired") {
      expect(drinks.indicator.id).toBe("group:sugaryDrinks");
      expect(drinks.severity).toBeCloseTo(0.75);
    }
    const snacks = evalOn("sweetsDrinksOften", { indicators: [ind("group:snacksChocolate", "occasional", 3)] });
    expect(snacks.kind === "fired" && snacks.indicator.id).toBe("group:snacksChocolate");
  });

  it("processedShareUp: sopra la mediana delle proprie settimane del 15%", () => {
    const past = ["2026-10-26", "2026-11-02", "2026-11-09"].map((weekStart, i) => ({
      weekStart,
      indicators: [ind("processedShare", "noTarget", [0.2, 0.22, 0.18][i])],
    }));
    expect(evalOn("processedShareUp", { indicators: [ind("processedShare", "noTarget", 0.3)] }, past).kind).toBe("fired");
    expect(evalOn("processedShareUp", { indicators: [ind("processedShare", "noTarget", 0.22)] }, past).kind).toBe(
      "not_triggered",
    );
  });

  it("processedShareUp: senza 3 settimane sufficienti non scatta", () => {
    const past = [
      { weekStart: "2026-10-26", indicators: [ind("processedShare", "noTarget", 0.1)] },
      { weekStart: "2026-11-02", daysWithData: 2, indicators: [ind("processedShare", "noTarget", 0.1)] },
      { weekStart: "2026-11-09", indicators: [ind("processedShare", "insufficient")] },
    ];
    expect(evalOn("processedShareUp", { indicators: [ind("processedShare", "noTarget", 0.5)] }, past).kind).toBe(
      "not_triggered",
    );
  });
});
