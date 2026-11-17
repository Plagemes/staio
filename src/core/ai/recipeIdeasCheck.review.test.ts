import { describe, expect, it } from "vitest";
import { confirmIngredient, deriveConfirmations } from "../allergens";
import type { PantryRef } from "./mealPhraseShared";
import { checkIdeas, type CheckedPantryRef } from "./recipeIdeasCheck";
import { parseRecipeIdeas } from "./recipeIdeasParse";

const REFS: PantryRef[] = [{ id: "A1", name: "Prosciutto cotto", remaining: { value: 200, unit: "g" } }];
const CRITERIA = { allergens: ["glutine"], excludedFoods: [] as string[] };

const ideas = () =>
  parseRecipeIdeas(
    JSON.stringify({
      recipes: [
        { title: "Toast", servings: 1, ingredients: [{ name: "Prosciutto cotto", quantity: 50, unit: "g", id: "A1" }], steps: [{ text: "Scalda." }] },
      ],
    }),
    REFS,
  ).ideas;

const labelled = (barcode?: string): CheckedPantryRef[] => [{ ...(REFS[0] as PantryRef), productName: "Prosciutto Alfa", ...(barcode ? { barcode } : {}) }];

describe("idee: la conferma è legata anche al codice a barre del prodotto", () => {
  it("il soggetto da confermare porta i codici dei prodotti collegati", () => {
    const first = checkIdeas(ideas(), CRITERIA, labelled("800111"));
    const subject = first.accepted[0]?.uncertainIngredients[0]?.subject;
    expect(subject?.productRefs).toEqual(["800111"]);
    // come nelle ricette: nome del lotto e del prodotto tra i collegati
    expect(subject?.linkedNames).toEqual(["Prosciutto cotto", "Prosciutto Alfa"]);
  });

  it("stesso nome del prodotto ma altro codice a barre: la conferma decade", () => {
    const first = checkIdeas(ideas(), CRITERIA, labelled("800111"));
    const subject = first.accepted[0]?.uncertainIngredients[0]?.subject;
    if (!subject) throw new Error("niente da confermare");
    const r = confirmIngredient(subject, CRITERIA, { deviceId: "A", now: () => "2026-11-05T09:00:00.000Z", idGenerator: () => "c1" });
    if (!r.ok) throw new Error(r.reason);
    const confirmations = deriveConfirmations([r.event]).byKey;
    const same = checkIdeas(ideas(), { ...CRITERIA, confirmations }, labelled("800111"));
    expect(same.accepted[0]?.uncertain).toEqual([]);
    expect(same.accepted[0]?.confirmed).toHaveLength(1);
    const other = checkIdeas(ideas(), { ...CRITERIA, confirmations }, labelled("800222"));
    expect(other.accepted[0]?.uncertain).toHaveLength(1);
    expect(other.accepted[0]?.confirmed).toEqual([]);
  });
});
