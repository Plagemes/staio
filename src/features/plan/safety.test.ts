import { describe, expect, it } from "vitest";
import type { PlanStructureState, PlanWeekState } from "@/core/plan";
import { recipeOf } from "../prep/test-helpers";
import { makeLinkOf } from "../recipes/allergenLinks";
import { makeExpandForChecks } from "./expand";
import { checkWeekConstraints } from "./safety";
import { constraintLines } from "./verify";

const structure = (allergens: string[]): PlanStructureState => ({ meals: [], excludedFoods: [], allergens, eventId: "s", recordedAt: "2026-11-10T00:00:00.000Z" });
const week = (recipeId: string): PlanWeekState => ({
  weekStart: "2026-11-16",
  entries: [{ date: "2026-11-17", meal: "dinner", item: { kind: "recipe", recipeId, servings: 2 } }],
  eventId: "w",
  recordedAt: "2026-11-10T00:00:00.000Z",
});

const pasta = recipeOf("pasta", {
  title: "Pasta al forno",
  servings: 2,
  ingredients: [{ name: "Pasta", quantity: { value: 200, unit: "g" } }, { name: "Ripieno" }],
  steps: [{ text: "Inforna." }],
});
const nameOf = (via: { kind: "recipe" | "prep"; id: string }) => (via.id === "pasta" ? "Pasta al forno" : "una preparazione");
const none = makeLinkOf([]);

describe("controllo del piano", () => {
  it("controlla anche gli ingredienti senza quantità e nomina piatto e ingrediente", () => {
    const expandForChecks = makeExpandForChecks({ recipes: [pasta], preps: [] });
    const r = checkWeekConstraints(structure(["latte"]), week("pasta"), { expandForChecks, linkOf: none });
    expect(r.verified).toBe(false);
    const [line] = constraintLines(r, nameOf);
    expect(line?.kind).toBe("unverified");
    expect(line?.text).toBe("Pasta al forno: «Ripieno» è un ingrediente generico o composto: potrebbe contenere latte. Controlla l'etichetta.");
  });

  it("legge l'etichetta del prodotto collegato a un ingrediente", () => {
    const expandForChecks = makeExpandForChecks({ recipes: [pasta], preps: [] });
    const linkOf = makeLinkOf([{ name: "Pasta", productName: "Pasta fresca", allergens: ["en:milk"] }]);
    const r = checkWeekConstraints(structure(["latte"]), week("pasta"), { expandForChecks, linkOf });
    expect(r.ok).toBe(false);
  });
});
