import { describe, expect, it } from "vitest";
import { stockFromLots, compareWithPantry, substitutesFor, type Substitute } from "@/core/recipes";
import { createTasteIndex, decodeTasteData, type CompactTasteData } from "@/core/taste";
import compact from "@/core/taste/data/flavorgraph.json";
import { pantryFoods } from "../recipes/allergenLinks";
import { homeFoodsOf, makeSubstituteScreen, missingIndices, parseSubstitutions } from "../recipes/substitutes";
import { proposeFromRecipe } from "./fromRecipe";
import { prepHref, resolvePrepSubstitutions } from "./substitution";
import { lotsOf, recipeOf } from "./test-helpers";

const index = createTasteIndex(decodeTasteData(compact as unknown as CompactTasteData));
const recipe = recipeOf("torta", {
  title: "Torta",
  servings: 4,
  ingredients: [
    { name: "Farina", quantity: { value: 200, unit: "g" } },
    { name: "Burro", quantity: { value: 100, unit: "g" }, foodId: "burro" },
  ],
});
const { lots } = lotsOf([
  { id: "f", name: "Farina", value: 1000 },
  { id: "m", name: "Margarina", value: 250 },
  { id: "o", name: "Olio d'oliva", value: 500, unit: "ml" },
]);

function optionsFor(allergens: string[]): ReadonlyMap<number, readonly Substitute[]> {
  const foods = pantryFoods(lots, undefined);
  const screen = makeSubstituteScreen({ allergens, excludedFoods: [] }, foods);
  return new Map([[1, substitutesFor(index, { name: "Burro" }, homeFoodsOf(foods, () => undefined), { screen })]]);
}

describe("preparazione con sostituzioni", () => {
  it("l'indirizzo della preparazione porta ricetta, porzioni e sostituzioni, e si rilegge uguale", () => {
    const href = prepHref("torta", 8, [{ index: 1, name: "Margarina" }]);
    const q = new URL(href, "http://x").searchParams;
    expect(href.startsWith("/app/preparazioni/nuova?")).toBe(true);
    expect(q.get("ricetta")).toBe("torta");
    expect(q.get("porzioni")).toBe("8");
    expect(parseSubstitutions(q.getAll("sost"), 2)).toEqual([{ index: 1, name: "Margarina" }]);
    expect(prepHref("torta", 8, [])).not.toContain("sost");
  });

  it("applica il sostituto tra le proposte e alla preparazione si scala il sostituto, per le porzioni scelte", () => {
    const options = optionsFor([]);
    const r = resolvePrepSubstitutions(recipe, [{ index: 1, name: "Margarina" }], options, { missing: [1], failed: false });
    expect(r.unapplied).toBeUndefined();
    expect(r.applied).toEqual([{ index: 1, name: "Margarina" }]);
    const proposal = proposeFromRecipe(r.recipe, lots, { servings: 8 });
    expect(proposal.picks.find((p) => p.lotId === "m")?.quantity).toEqual({ value: 200, unit: "g" });
    expect(proposal.unmatched).toEqual([]);
    const cmp = compareWithPantry(recipe, stockFromLots(lots));
    if (!cmp.ok) throw new Error("confronto");
    expect(missingIndices(cmp.value)).toEqual([1]);
  });

  it("un sostituto con l'allergene dichiarato è rifiutato anche se scritto nell'indirizzo, con la riga di avviso", () => {
    const options = optionsFor(["latte"]);
    expect(options.get(1)?.map((s) => s.name)).toEqual(["Olio d'oliva"]);
    const r = resolvePrepSubstitutions(recipe, [{ index: 1, name: "Margarina" }], options, { missing: [1], failed: false });
    expect(r.applied).toEqual([]);
    expect(r.recipe).toBe(recipe);
    expect(r.unapplied).toContain("Sostituzione non applicata");
    expect(r.unapplied).toContain("«Margarina» al posto di «Burro»");
  });

  it("un nome inventato o un ingrediente non più mancante non si applica; senza dati lo dice", () => {
    const options = optionsFor([]);
    expect(resolvePrepSubstitutions(recipe, [{ index: 1, name: "Tartufo" }], options, { missing: [1], failed: false }).applied).toEqual([]);
    const gone = resolvePrepSubstitutions(recipe, [{ index: 1, name: "Margarina" }], new Map(), { missing: [], failed: false });
    expect(gone.unapplied).toContain("ora è in dispensa");
    const offline = resolvePrepSubstitutions(recipe, [{ index: 1, name: "Margarina" }], new Map(), { missing: [1], failed: true });
    expect(offline.unapplied).toContain("controlla la connessione");
  });
});
