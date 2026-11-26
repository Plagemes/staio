import { describe, expect, it } from "vitest";
import { deriveDeclarations, planDeclarationChanges } from "@/core/allergens";
import { prefsWithout, readPrefsDeclarations } from "./allergens";

describe("prefsWithout", () => {
  it("una voce del ricettario con caratteri di controllo si toglie, come la riconosce la lettura", () => {
    const raw = { allergens: ["lat\u0007te", "uova"], excludedFoods: ["  Fun\tghi "], limitToEquipment: true };
    const legacy = { recipePrefs: readPrefsDeclarations(raw), planStructure: undefined };
    const shown = deriveDeclarations([], legacy).allergens.map((v) => v.text);
    expect(shown).toContain("lat te");
    const plan = planDeclarationChanges([], legacy, [{ action: "remove", list: "allergens", text: "lat te" }], { deviceId: "A" });
    if (!plan.ok) throw new Error(plan.reason);
    const { next, dropped } = prefsWithout(raw, plan.prefsRemovals);
    expect(next).toEqual({ allergens: ["uova"], excludedFoods: ["  Fun\tghi "], limitToEquipment: true });
    expect(dropped.allergens).toEqual(["lat\u0007te"]);
    // tolta dal ricettario e ritirata negli eventi: la voce non c'è più, e un secondo tentativo non trova niente
    const after = { recipePrefs: readPrefsDeclarations(next), planStructure: undefined };
    const log = [...plan.prelude, ...plan.events];
    expect(deriveDeclarations(log, after).allergens.map((v) => v.text)).toEqual(["uova"]);
    expect(planDeclarationChanges(log, after, [{ action: "remove", list: "allergens", text: "lat te" }], { deviceId: "A" })).toEqual({ ok: false, reason: "missing" });
  });

  it("spazi, maiuscole e accenti diversi: la stessa voce", () => {
    expect(prefsWithout({ excludedFoods: ["  FÙNGHI  "] }, { allergens: [], excludedFoods: ["funghi"] }).next).toEqual({ excludedFoods: [] });
  });

  it("un testo solo al posto dell'elenco si toglie", () => {
    expect(prefsWithout({ allergens: "latte" }, { allergens: ["latte"], excludedFoods: [] }).next).toEqual({ allergens: [] });
  });
});
