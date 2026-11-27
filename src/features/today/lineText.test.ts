import { describe, expect, it } from "vitest";
import { computeIntake, createResolver, type IntakeLine } from "@/core/nutrition";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import { consume, meal, purchase } from "@/core/diary/test-helpers";
import type { ClassPart } from "@/core/diet";
import { canCorrectClass, classBasisOf, classCurrentOf, classLinesOf, lineMarkSuffix, lineNutrientText } from "./lineText";

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

describe("il segno «molto lavorato» sulla riga", () => {
  it("dice «· molto lavorato», con la tilde se è una stima", () => {
    expect(lineMarkSuffix({ level: 4, certainty: "label", fromPrep: false })).toBe("· molto lavorato");
    expect(lineMarkSuffix({ level: 4, certainty: "estimated", fromPrep: false })).toBe("· molto lavorato ~");
  });

  it("senza segno non dice niente", () => {
    expect(lineMarkSuffix(undefined)).toBeUndefined();
  });
});

const part = (over: Partial<ClassPart> = {}): ClassPart => ({ group: "legumes", basis: "name", certainty: "estimated", label: "Ceci", ...over });

describe("«Come la conto»", () => {
  it("una voce semplice: gruppo e lavorazione, con la tilde se stimati", () => {
    const cls = { parts: [part({ processing: { level: 1, certainty: "estimated", basis: "declared" } })] };
    expect(classLinesOf(cls)).toEqual({ lines: [{ text: "Legumi ~ · non lavorato o poco ~" }], more: 0 });
  });

  it("senza la tilde se il dato viene dalla scheda", () => {
    const cls = { parts: [part({ certainty: "label", basis: "product", processing: { level: 4, certainty: "label", basis: "product" } })] };
    expect(classLinesOf(cls).lines[0].text).toBe("Legumi · molto lavorato");
  });

  it("una preparazione: una riga per ingrediente, al massimo quattro", () => {
    const parts = Array.from({ length: 6 }, (_, i) => part({ label: `Ingrediente ${i}`, prepId: "p1", basis: "prep" }));
    const { lines, more } = classLinesOf({ parts });
    expect(lines).toHaveLength(4);
    expect(lines[0].label).toBe("Ingrediente 0");
    expect(more).toBe(2);
  });

  it("finché la classificazione non c'è non dice niente", () => {
    expect(classLinesOf(undefined)).toEqual({ lines: [], more: 0 });
  });

  it("da dove viene: una preparazione dagli ingredienti, altrimenti dalla parte", () => {
    expect(classBasisOf({ parts: [part({ basis: "name" })] })).toBe("name");
    expect(classBasisOf({ parts: [part({ prepId: "p1", basis: "food" })] })).toBe("prep");
    expect(classBasisOf(undefined)).toBeUndefined();
  });

  it("il valore di partenza della correzione: solo per una voce semplice con un gruppo vero", () => {
    expect(classCurrentOf({ parts: [part({ processing: { level: 3, certainty: "estimated", basis: "declared" } })] })).toEqual({ group: "legumes", processing: 3 });
    expect(classCurrentOf({ parts: [part({ group: "unknown" })] })).toEqual({});
    expect(classCurrentOf({ parts: [part(), part()] })).toEqual({});
  });

  it("si corregge solo con una chiave e senza essere una preparazione o un pasto fuori casa", () => {
    expect(canCorrectClass({ parts: [part()], overrideKey: "n:cec" })).toBe(true);
    expect(canCorrectClass({ parts: [part()] })).toBe(false);
    expect(canCorrectClass({ parts: [part({ prepId: "p1", basis: "prep" })], overrideKey: "n:x" })).toBe(false);
    expect(canCorrectClass({ parts: [part({ group: "outOfHome", basis: "outOfHome" })], overrideKey: "n:x" })).toBe(false);
  });
});
