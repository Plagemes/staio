import { describe, expect, it } from "vitest";
import { adoptLegacyDeclarations, declaredTexts, deriveDeclarations, legacyPlanStructure, type LegacyDeclarations } from "@/core/allergens";
import { recipeOf } from "../prep/test-helpers";
import { recipeSafety, unionDeclared } from "./safety";

// Prova di severità: con la lettura unica, gli esiti «contiene» e «da controllare» contengono quelli che davano prima
// ricettario e piano messi insieme. Mai un controllo più permissivo.

const RANK = { clear: 0, uncertain: 1, contains: 2 } as const;
const at = "2026-11-01T08:00:00.000Z";
const plan = {
  id: "s-1",
  type: "planStructure",
  at,
  recordedAt: at,
  deviceId: "B",
  schemaVersion: 1,
  certainty: "measured",
  source: "manual",
  meals: [{ kind: "lunch" }],
  allergens: ["Glutine"],
  excludedFoods: ["funghi"],
};
const prefs = { allergens: ["latte", "uova"], excludedFoods: ["olive"] };

const recipes = [
  recipeOf("panna", { title: "Panna cotta", ingredients: [{ name: "Latte intero", quantity: { value: 200, unit: "ml" } }], steps: [{ text: "Scalda." }] }),
  recipeOf("toast", { title: "Toast", ingredients: [{ name: "Formaggio", quantity: { value: 50, unit: "g" } }, { name: "Pane", quantity: { value: 2, unit: "pz" } }], steps: [{ text: "Tosta." }] }),
  recipeOf("misterioso", { title: "Misterioso", ingredients: [{ name: "Salsa kzzr", quantity: { value: 30, unit: "g" } }], steps: [{ text: "Mescola." }] }),
  recipeOf("funghi", { title: "Risotto", ingredients: [{ name: "Funghi porcini", quantity: { value: 100, unit: "g" } }, { name: "Riso", quantity: { value: 80, unit: "g" } }], steps: [{ text: "Cuoci." }] }),
];

describe("19. la lettura unica non è mai più permissiva di ricettario e piano insieme", () => {
  const before = { allergens: unionDeclared(prefs.allergens, plan.allergens), excludedFoods: unionDeclared(prefs.excludedFoods, plan.excludedFoods) };
  const legacy: LegacyDeclarations = { recipePrefs: prefs, planStructure: legacyPlanStructure([plan]) };
  const migrated = [plan, ...adoptLegacyDeclarations([plan], legacy, { deviceId: "A", now: () => "2026-11-02T08:00:00.000Z" })];
  const cases = {
    "prima della migrazione": declaredTexts(deriveDeclarations([plan], legacy)),
    "dopo la migrazione": declaredTexts(deriveDeclarations(migrated, { recipePrefs: prefs, planStructure: legacyPlanStructure(migrated) })),
    "dopo, su un telefono senza ricettario": declaredTexts(deriveDeclarations(migrated, { recipePrefs: undefined, planStructure: legacyPlanStructure(migrated) })),
  };

  for (const [name, after] of Object.entries(cases)) {
    it(name, () => {
      for (const r of recipes) {
        const old = recipeSafety(r, before);
        const now = recipeSafety(r, after);
        expect(RANK[now.verdict]).toBeGreaterThanOrEqual(RANK[old.verdict]);
        for (const line of old.contains) expect(now.contains).toContain(line);
        for (const line of old.uncertain) expect([...now.contains, ...now.uncertain]).toContain(line);
      }
    });
  }

  it("le ricette di prova non sono tutte «nessuna corrispondenza»", () => {
    expect(recipes.map((r) => recipeSafety(r, before).verdict)).toContain("contains");
  });
});
