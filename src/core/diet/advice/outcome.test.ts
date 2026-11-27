import { describe, expect, it } from "vitest";
import type { AdviceRule, DietHistory } from "../types";
import { computeOutcomes } from "./outcome";
import { frame, ind, type FrameSpec } from "./test-helpers";

const W1 = "2026-11-02";
const W2 = "2026-11-09";
const W3 = "2026-11-16";

const hist = (...specs: FrameSpec[]): DietHistory => ({
  level: 2000,
  weeks: [...specs.map(frame), frame({ weekStart: "2026-11-23", inProgress: true })],
  trends: {},
  daily: {},
});

describe("computeOutcomes", () => {
  it("moved: l'indicatore si muove nella direzione della regola", () => {
    const out = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:legumes", "below", 1)] },
        { weekStart: W2, indicators: [ind("group:legumes", "within", 3)] },
      ),
    );
    expect(out).toEqual([{ ruleId: "legumesLow", weekStart: W1, nextWeekStart: W2, before: 1, after: 3, result: "moved" }]);
  });

  it("same e opposite", () => {
    const same = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("salt", "above", 8)] },
        { weekStart: W2, indicators: [ind("salt", "above", 7.8)] },
      ),
    );
    expect(same[0]).toMatchObject({ ruleId: "saltHigh", result: "same" });
    const opposite = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("salt", "above", 6)] },
        { weekStart: W2, indicators: [ind("salt", "above", 9)] },
      ),
    );
    expect(opposite[0]).toMatchObject({ result: "opposite", before: 6, after: 9 });
  });

  it("da zero: qualunque aumento è «moved»", () => {
    const out = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:fish", "below", 0)] },
        { weekStart: W2, indicators: [ind("group:fish", "below", 1)] },
      ),
    );
    expect(out[0]).toMatchObject({ ruleId: "fishLow", result: "moved" });
  });

  it("insufficient se la settimana dopo è insufficiente; la settimana in corso non conta", () => {
    const out = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:legumes", "below", 1)] },
        { weekStart: W2, daysWithData: 2, indicators: [ind("group:legumes", "insufficient")] },
      ),
    );
    expect(out).toEqual([{ ruleId: "legumesLow", weekStart: W1, nextWeekStart: W2, before: 1, result: "insufficient" }]);
    // L'ultima settimana chiusa non ha ancora una settimana chiusa dopo.
    const last = computeOutcomes(hist({ weekStart: W3, indicators: [ind("group:legumes", "below", 1)] }));
    expect(last).toEqual([]);
  });

  it("un minimo dice solo ciò che garantisce", () => {
    const up = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:legumes", "below", 1)] },
        { weekStart: W2, indicators: [ind("group:legumes", "atLeast", 1, { lowerBound: true })] },
      ),
    );
    expect(up[0].result).toBe("insufficient");
    const down = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:redMeat", "above", 4)] },
        { weekStart: W2, indicators: [ind("group:redMeat", "above", 2, { lowerBound: true })] },
      ),
    );
    expect(down[0].result).toBe("insufficient");
  });

  it("le «occasionali» confrontano le volte della stessa riga", () => {
    const out = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:sugaryDrinks", "occasional", 5)] },
        { weekStart: W2, indicators: [ind("group:sugaryDrinks", "occasional", 1), ind("group:cakesIceCream", "occasional", 6)] },
      ),
    );
    expect(out[0]).toMatchObject({ ruleId: "sweetsDrinksOften", weekStart: W1, before: 5, after: 1, result: "moved" });
  });

  it("ordinati per settimana e per severità; salta i buchi tra settimane", () => {
    const out = computeOutcomes(
      hist(
        { weekStart: W1, indicators: [ind("group:legumes", "below", 1.5), ind("group:fish", "below", 0)] },
        { weekStart: W2, indicators: [ind("salt", "above", 9)] },
        { weekStart: W3 },
      ),
    );
    expect(out.map((o) => [o.weekStart, o.ruleId])).toEqual([
      [W1, "fishLow"],
      [W1, "legumesLow"],
      [W2, "saltHigh"],
    ]);
    const gap = computeOutcomes(
      hist({ weekStart: W1, indicators: [ind("group:legumes", "below", 1)] }, { weekStart: W3 }),
    );
    expect(gap).toEqual([]);
  });

  it("accetta regole fuori catalogo", () => {
    const custom: AdviceRule = {
      id: "fiberLow",
      indicator: "fiber",
      direction: "increase",
      severity: (i) => ((i.value ?? 99) < 20 ? 0.5 : undefined),
      lookFor: [],
      source: "efsa-drv",
    };
    const out = computeOutcomes(
      hist({ weekStart: W1, indicators: [ind("fiber", "within", 18)] }, { weekStart: W2, indicators: [ind("fiber", "within", 24)] }),
      [custom],
    );
    expect(out).toEqual([{ ruleId: "fiberLow", weekStart: W1, nextWeekStart: W2, before: 18, after: 24, result: "moved" }]);
  });
});
