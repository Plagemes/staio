import { describe, expect, it } from "vitest";
import { assessProduct } from "@/core/allergens";
import { PLAN_UNREADABLE_NOTE, SAFETY_FLAGS, SAFETY_HEADINGS, sortOutcomes } from "./safetyText";

describe("testi del controllo sulla scheda", () => {
  it("dice che il controllo è incompleto se il piano non si legge", () => {
    expect(PLAN_UNREADABLE_NOTE).toMatch(/incompleto/);
    expect(PLAN_UNREADABLE_NOTE).toMatch(/piano/);
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
