// I quattro difetti trovati dalla revisione, come prove di regressione sulle funzioni pubbliche dei tre punti d'uso.
import { describe, expect, it } from "vitest";
import type { PantryRef } from "../ai/mealPhraseShared";
import { checkIdeas, forbiddenReasons } from "../ai/recipeIdeasCheck";
import type { RecipeIdea } from "../ai/recipeIdeasParse";
import { checkConstraints, derivePlan, getWeek } from "../plan";
import { food, structureEv, weekEv } from "../plan/test-helpers";
import { allergensOfIngredient, filterRecipes, type Filterable } from "../recipes";

const idea = (names: string[], steps: string[] = ["Cuoci."], extra: Partial<RecipeIdea> = {}): RecipeIdea => ({
  title: "Prova",
  servings: 2,
  ingredients: names.map((name) => ({ name })),
  steps: steps.map((text) => ({ text })),
  equipment: [],
  ...extra,
});

const recipe = (names: string[], steps: string[] = []): Filterable => ({
  title: "Prova",
  ingredients: names.map((name) => ({ name })),
  steps: steps.map((text) => ({ text })),
});

const keptBy = (names: string[], allergens: string[], steps: string[] = []) => filterRecipes([recipe(names, steps)], { allergens }).kept.length;

const T = "2026-03-01T10:00:00.000Z";
function plan(structure: { allergens?: string[]; excludedFoods?: string[] }, names: string[]) {
  const state = derivePlan([
    structureEv("s", T, structure),
    weekEv("w", T, "2026-03-09", names.map((n) => food("2026-03-09", "lunch", n, 100))),
  ]);
  return checkConstraints(state.structure, getWeek(state, "2026-03-09"), { allergensOf: (item) => allergensOfIngredient({ name: item.name }) });
}

describe("difetto 1: sinonimi, plurali, accenti, maiuscole, composti", () => {
  const cases: [string, string][] = [
    ["Pan grattato", "glutine"],
    ["Cous cous", "glutine"],
    ["Bulgur", "glutine"],
    ["Farina di spelta", "glutine"],
    ["Burrata", "latte"],
    ["Scamorza affumicata", "latte"],
    ["FETA", "latte"],
    ["Pinolo", "frutta a guscio"],
    ["Polipo", "molluschi"],
    ["Moscardini", "molluschi"],
    ["Hummus", "sesamo"],
    ["Gomasio", "sesamo"],
    ["Mostarda di Cremona", "senape"],
    ["Marsala", "solfiti"],
    ["Surimi", "pesce"],
    ["Uova di lompo", "pesce"],
    ["Tamari", "soia"],
  ];
  it.each(cases)("«%s» non passa con l'allergia a %s, in tutti e tre i punti d'uso", (name, allergen) => {
    expect(keptBy([name], [allergen])).toBe(0);
    expect(forbiddenReasons(idea([name]), { allergens: [allergen], excludedFoods: [] }).length).toBeGreaterThan(0);
    expect(plan({ allergens: [allergen] }, [name]).ok).toBe(false);
  });

  it("dentro un passo della ricetta: «imburrate la teglia», «sfumate con il vermut»", () => {
    expect(forbiddenReasons(idea(["Riso"], ["Imburrate la teglia e infornate."]), { allergens: ["latte"], excludedFoods: [] }).length).toBeGreaterThan(0);
    expect(keptBy(["Riso"], ["latte"], ["Imburrate la teglia e infornate."])).toBe(0);
    expect(keptBy(["Riso"], ["solfiti"], ["Sfumate con il vermut."])).toBe(0);
  });
});

describe("difetto 2: l'alimento di dispensa collegato all'ingrediente", () => {
  const pantry: PantryRef[] = [{ id: "A9", name: "Crema di arachidi", remaining: { value: 200, unit: "g" } }];
  const crema: RecipeIdea = { ...idea([]), ingredients: [{ name: "Crema", quantity: { value: 30, unit: "g" }, pantryId: "A9" }] };

  it("«crema» collegata a «crema di arachidi» è scartata con l'allergia alle arachidi", () => {
    const out = checkIdeas([crema], { allergens: ["arachidi"], excludedFoods: [] }, pantry);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reasons.join(" ")).toMatch(/arachidi/);
  });

  it("anche quando il collegamento lo trova l'app per nome", () => {
    const unlinked: RecipeIdea = { ...idea([]), ingredients: [{ name: "Crema di arachidi", quantity: { value: 30, unit: "g" } }] };
    expect(checkIdeas([unlinked], { allergens: ["arachidi"], excludedFoods: [] }, pantry).accepted).toHaveLength(0);
  });
});

describe("difetto 3: valori vecchi o importati, al singolare o in altre lingue", () => {
  it("piano: «Uovo» al singolare riconosce le uova", () => {
    expect(plan({ allergens: ["Uovo"] }, ["Uova"]).ok).toBe(false);
    expect(plan({ allergens: ["Lattosio"] }, ["Burro"]).ok).toBe(false);
    expect(plan({ allergens: ["Arachide"] }, ["Arachidi tostate"]).ok).toBe(false);
  });

  it("ricettario e idee: «Arachide», «Crostaceo», «Mollusco», «Solfito», «en:milk»", () => {
    expect(keptBy(["Arachidi tostate"], ["Arachide"])).toBe(0);
    expect(keptBy(["Gamberi"], ["Crostaceo"])).toBe(0);
    expect(keptBy(["Cozze"], ["mollusco"])).toBe(0);
    expect(keptBy(["Vino bianco"], ["Solfito"])).toBe(0);
    expect(keptBy(["Burro"], ["en:milk"])).toBe(0);
    expect(forbiddenReasons(idea(["Gamberi"]), { allergens: ["Crostaceo"], excludedFoods: [] }).length).toBeGreaterThan(0);
  });
});

describe("difetto 4: esclusioni libere e iponimi", () => {
  const cases: [string, string][] = [
    ["maiale", "Salsiccia"],
    ["funghi", "Porcini secchi"],
    ["fegato", "Fegatini di pollo"],
    ["alcol", "Vino rosso"],
    ["carne", "Bresaola"],
  ];
  it.each(cases)("escludere «%s» toglie «%s» in tutti e tre i punti d'uso", (excluded, name) => {
    expect(filterRecipes([recipe([name])], { excludedFoods: [excluded] }).kept).toHaveLength(0);
    expect(forbiddenReasons(idea([name]), { allergens: [], excludedFoods: [excluded] }).length).toBeGreaterThan(0);
    expect(plan({ excludedFoods: [excluded] }, [name]).ok).toBe(false);
  });
});
