import { describe, expect, it } from "vitest";
import { confirmIngredient, deriveConfirmations } from "../allergens";
import type { PantryRef } from "./mealPhraseShared";
import { checkIdeas } from "./recipeIdeasCheck";
import { parseRecipeIdeas } from "./recipeIdeasParse";

const PANTRY: PantryRef[] = [{ id: "A1", name: "Riso", remaining: { value: 500, unit: "g" } }];

const reading = (ingredients: { name: string; quantity?: number; unit?: string }[]) =>
  parseRecipeIdeas(
    JSON.stringify({ recipes: [{ title: "Riso e prosciutto", servings: 2, ingredients, steps: [{ text: "Cuoci il riso e aggiungi il prosciutto." }] }] }),
    PANTRY,
  ).ideas;

const CRITERIA = { allergens: ["glutine"], excludedFoods: [] as string[] };

describe("idee di ricette con le conferme dell'utente", () => {
  it("un ingrediente non verificabile porta ciò che serve a confermarlo", () => {
    const { accepted } = checkIdeas(reading([{ name: "Riso", quantity: 100, unit: "g" }, { name: "Prosciutto cotto", quantity: 50, unit: "g" }]), CRITERIA, PANTRY);
    const idea = accepted[0];
    expect(idea?.uncertain).toHaveLength(1);
    expect(idea?.uncertainIngredients.map((u) => u.name)).toEqual(["Prosciutto cotto"]);
    expect(idea?.confirmed).toEqual([]);
    const subject = idea?.uncertainIngredients[0]?.subject;
    expect(subject).toBeDefined();
    expect(confirmIngredient(subject!, CRITERIA, { deviceId: "A" }).ok).toBe(true);
  });

  it("con la conferma esce dall'incerto ed entra in `confirmed`", () => {
    const first = checkIdeas(reading([{ name: "Riso", quantity: 100, unit: "g" }, { name: "Prosciutto cotto", quantity: 50, unit: "g" }]), CRITERIA, PANTRY);
    const subject = first.accepted[0]!.uncertainIngredients[0]!.subject;
    const r = confirmIngredient(subject, CRITERIA, { deviceId: "A", now: () => "2026-11-05T09:00:00.000Z", idGenerator: () => "c1" });
    if (!r.ok) throw new Error(r.reason);
    const confirmations = deriveConfirmations([r.event]).byKey;
    const again = checkIdeas(first.accepted.map((a) => a.idea), { ...CRITERIA, confirmations }, PANTRY);
    const idea = again.accepted[0];
    expect(idea?.uncertain).toEqual([]);
    expect(idea?.uncertainIngredients).toEqual([]);
    expect(idea?.confirmed).toEqual([{ name: "Prosciutto cotto", allergens: ["glutine"], confirmedAt: "2026-11-05T09:00:00.000Z" }]);
    expect(again.rejected).toEqual([]);
  });

  it("una conferma non salva un'idea che contiene un allergene: resta scartata", () => {
    const ideas = reading([{ name: "Farina 00", quantity: 100, unit: "g" }, { name: "Prosciutto cotto", quantity: 50, unit: "g" }]);
    const first = checkIdeas(reading([{ name: "Riso", quantity: 100, unit: "g" }, { name: "Prosciutto cotto", quantity: 50, unit: "g" }]), CRITERIA, PANTRY);
    const subject = first.accepted[0]!.uncertainIngredients[0]!.subject;
    const r = confirmIngredient(subject, CRITERIA, { deviceId: "A" });
    if (!r.ok) throw new Error(r.reason);
    const confirmations = deriveConfirmations([r.event]).byKey;
    const out = checkIdeas(ideas, { ...CRITERIA, confirmations }, PANTRY);
    expect(out.accepted).toEqual([]);
    expect(out.rejected[0]?.reasons.join(" ")).toContain("glutine");
  });
});
