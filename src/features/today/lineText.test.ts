import { describe, expect, it } from "vitest";
import { computeIntake, createResolver, type IntakeLine } from "@/core/nutrition";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import { consume, meal, purchase } from "@/core/diary/test-helpers";
import { lineNutrientText } from "./lineText";

const D = "2026-03-10";
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function linesOf(productRef: string, grams: number): IntakeLine[] {
  const log = [
    purchase("p1", at("06:00"), { lotId: "lot-1", productRef, quantity: { value: 1000, unit: "g" }, location: "frigo" }),
    meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch" }),
    consume("c1", at("13:01"), { lotId: "lot-1", quantity: { value: grams, unit: "g" }, mealId: "meal-1" }),
  ];
  return computeIntake(log, resolver, { timeZone: "UTC" }).days[0].meals[0].lines;
}

describe("il testo dei nutrienti di una riga di Oggi", () => {
  it("un alimento con valori dice energia e proteine", () => {
    const [line] = linesOf("Petto di pollo crudo", 275);
    expect(lineNutrientText(line)).toMatch(/^~?275 kcal · ~?55 g proteine$/);
  });

  it("un alimento senza valori dice «senza dato», non zero", () => {
    const [line] = linesOf("Qualcosa di sconosciuto", 100);
    expect(lineNutrientText(line)).toBe("senza dato");
  });

  it("finché il calcolo non è pronto non dice niente", () => {
    expect(lineNutrientText(undefined)).toBeUndefined();
  });
});
