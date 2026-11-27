import { describe, expect, it } from "vitest";
import { DIET_GROUPS, type KnownAlternative } from "../types";
import { buildAdvice } from "./engine";
import { computeOutcomes } from "./outcome";
import { history, ind, input, pantry, recipe } from "./test-helpers";

describe("prestazioni del motore", () => {
  it("300 ricette, 500 alimenti in dispensa, 8 settimane: sotto 50 ms", () => {
    const fired = [
      ind("group:legumes", "below", 0),
      ind("group:fish", "below", 0),
      ind("vegFruit", "below", 150),
      ind("fiber", "below", 12),
      ind("salt", "above", 9),
      ind("group:redMeat", "above", 4),
      ind("group:sugaryDrinks", "occasional", 5),
    ];
    const h = history({ indicators: fired }, { closedWeeks: 7, past: () => ({ indicators: fired }) });
    expect(h.weeks).toHaveLength(8);
    const pantryList = Array.from({ length: 500 }, (_, i) =>
      pantry(`Alimento ${i}`, DIET_GROUPS[i % DIET_GROUPS.length], `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, `lot-${i}`),
    );
    const recipes = Array.from({ length: 300 }, (_, i) =>
      recipe(`r${i}`, [DIET_GROUPS[i % DIET_GROUPS.length], DIET_GROUPS[(i * 7) % DIET_GROUPS.length]], (i % 10) / 10),
    );
    const alternatives: KnownAlternative[] = Array.from({ length: 100 }, (_, i) => ({
      fromBarcode: `f${i}`,
      fromName: `Da ${i}`,
      toBarcode: `t${i}`,
      toName: `A ${i}`,
      dimension: (["nova", "salt", "sugars"] as const)[i % 3],
      fromShare: (i % 17) / 17,
    }));
    const args = input(h, { pantry: pantryList, recipes, alternatives, shoppingNames: ["pesce"] });

    buildAdvice(args); // riscaldamento
    const t0 = performance.now();
    const result = buildAdvice(args);
    const outcomes = computeOutcomes(h);
    const elapsed = performance.now() - t0;

    expect(result.advice.length).toBe(3);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
