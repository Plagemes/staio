import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { compareWithPantry, applySubstitutions, stockFromLots, substitutesFor, type Recipe } from "@/core/recipes";
import { createTasteIndex, decodeTasteData, type CompactTasteData } from "@/core/taste";
import compact from "@/core/taste/data/flavorgraph.json";
import { NOW, lotsOf, recipeOf } from "../prep/test-helpers";
import { proposeFromRecipe, picksFromProposal } from "../prep/fromRecipe";
import { pantryFoods } from "./allergenLinks";
import { recipeSafety } from "./safety";
import {
  homeFoodsOf,
  makeSubstituteScreen,
  missingIndices,
  parseSubstitutions,
  recipeHref,
  unappliedNote,
  validSubstitutions,
  withSubstitution,
  type ScreenCriteria,
} from "./substitutes";

void NOW;
const index = createTasteIndex(decodeTasteData(compact as unknown as CompactTasteData));
const noId = () => undefined;

function propose(ingredient: string, stock: Parameters<typeof lotsOf>[0], criteria: ScreenCriteria, products?: ReadonlyMap<string, Product>) {
  const { lots } = lotsOf(stock);
  const foods = pantryFoods(lots, products);
  return substitutesFor(index, { name: ingredient }, homeFoodsOf(foods, noId), { screen: makeSubstituteScreen(criteria, foods) });
}

const none: ScreenCriteria = { allergens: [], excludedFoods: [] };

describe("sostituti e controllo degli allergeni", () => {
  const stock = [
    { id: "m", name: "Margarina", value: 250 },
    { id: "o", name: "Olio d'oliva", value: 500, unit: "ml" as const },
    { id: "y", name: "Yogurt", value: 500 },
  ];

  it("senza allergeni dichiarati propone tutto ciò che è della famiglia", () => {
    expect(propose("Burro", stock, none).map((s) => s.name)).toEqual(["Margarina", "Olio d'oliva"]);
  });

  it("un sostituto che contiene l'allergene dichiarato non esce MAI: panna → yogurt con latte dichiarato", () => {
    expect(propose("Panna", [{ id: "y", name: "Yogurt", value: 500 }], none).map((s) => s.name)).toEqual(["Yogurt"]);
    expect(propose("Panna", [{ id: "y", name: "Yogurt", value: 500 }], { allergens: ["latte"], excludedFoods: [] })).toEqual([]);
    expect(propose("Panna", [{ id: "y", name: "Yogurt greco", value: 500 }], { allergens: ["lattosio"], excludedFoods: [] })).toEqual([]);
  });

  it("burro → margarina con latte o lattosio dichiarati: la margarina è esclusa, resta l'olio", () => {
    expect(propose("Burro", stock, { allergens: ["latte"], excludedFoods: [] }).map((s) => s.name)).toEqual(["Olio d'oliva"]);
    expect(propose("Burro", stock, { allergens: ["lattosio"], excludedFoods: [] }).map((s) => s.name)).toEqual(["Olio d'oliva"]);
  });

  it("l'incerto esce con il suo avviso e senza frasi doppie", () => {
    const r = propose("Burro", stock, { allergens: ["glutine"], excludedFoods: [] });
    const margarine = r.find((s) => s.name === "Margarina");
    expect(margarine?.doubt).toHaveLength(1);
    expect(margarine?.doubt?.[0]).toContain("«Margarina»");
    expect(r.find((s) => s.name === "Olio d'oliva")?.doubt).toBeUndefined();
  });

  it("con latte dichiarato nessun formaggio da cuocere esce", () => {
    const r = propose("Mozzarella", [
      { id: "a", name: "Provolone", value: 200 },
      { id: "b", name: "Fontina", value: 200 },
      { id: "c", name: "Cheddar", value: 200 },
    ], { allergens: ["latte"], excludedFoods: [] });
    expect(r).toEqual([]);
  });

  it("due lotti con lo stesso nome e codici diversi: vale il caso peggiore, anche se il lotto pulito è il secondo", () => {
    const { lots } = lotsOf([
      { id: "a", name: "Olio d'oliva", value: 500, unit: "ml", expiry: "2026-11-20" },
      { id: "b", name: "Olio d'oliva", value: 500, unit: "ml", expiry: "2027-06-01" },
    ]);
    const [a, b] = lots.map((l, i) => ({ ...l, barcode: i === 0 ? "80000001" : "80000002" }));
    const product = (barcode: string, allergens: string[]) => ({ barcode, name: "Olio", allergens, fetchedAt: "x", source: "openfoodfacts" }) as Product;
    const products = new Map([["80000001", product("80000001", ["en:milk"])], ["80000002", product("80000002", [])]]);
    const foods = pantryFoods([a, b].filter((l) => l !== undefined), products);
    expect(foods).toHaveLength(2);
    const criteria = { allergens: ["latte"], excludedFoods: [] };
    for (const order of [foods, [...foods].reverse()]) {
      const screen = makeSubstituteScreen(criteria, foods);
      expect(substitutesFor(index, { name: "Burro" }, homeFoodsOf(order, noId), { screen })).toEqual([]);
    }
    // senza il lotto con latte in etichetta l'olio è proposto
    const clean = pantryFoods([b].filter((l) => l !== undefined), products);
    expect(substitutesFor(index, { name: "Burro" }, homeFoodsOf(clean, noId), { screen: makeSubstituteScreen(criteria, clean) }).map((s) => s.name)).toEqual(["Olio d'oliva"]);
  });

  it("un alimento escluso per nome non esce", () => {
    expect(propose("Spinaci", [{ id: "b", name: "Bietola", value: 300 }], { allergens: [], excludedFoods: ["bietola"] })).toEqual([]);
    expect(propose("Spinaci", [{ id: "b", name: "Bietola", value: 300 }], none).map((s) => s.name)).toEqual(["Bietola"]);
  });

  it("l'allergene in etichetta sul prodotto in dispensa esclude anche un nome innocuo", () => {
    const { lots } = lotsOf([{ id: "o", name: "Olio di girasole", value: 500, unit: "ml" }]);
    const withBarcode = lots.map((l) => ({ ...l, barcode: "80000000" }));
    const product = { barcode: "80000000", name: "Olio con burro", allergens: ["en:milk"], fetchedAt: "x", source: "openfoodfacts" } as Product;
    const foods = pantryFoods(withBarcode, new Map([["80000000", product]]));
    const screen = makeSubstituteScreen({ allergens: ["latte"], excludedFoods: [] }, foods);
    expect(substitutesFor(index, { name: "Burro" }, homeFoodsOf(foods, noId), { screen })).toEqual([]);
  });
});

describe("la ricetta cucinata con il sostituto", () => {
  const recipe: Recipe = recipeOf("torta", {
    title: "Torta",
    servings: 4,
    ingredients: [
      { name: "Farina", quantity: { value: 200, unit: "g" } },
      { name: "Burro", quantity: { value: 100, unit: "g" }, foodId: "burro" },
    ],
    steps: [{ text: "Cuoci in forno." }],
  });
  const { lots } = lotsOf([
    { id: "f", name: "Farina", value: 1000 },
    { id: "m", name: "Margarina", value: 250 },
  ]);

  it("l'ingrediente manca e la sostituzione lo copre", () => {
    const original = compareWithPantry(recipe, stockFromLots(lots));
    if (!original.ok) throw new Error("confronto");
    expect(missingIndices(original.value)).toEqual([1]);
    const effective = applySubstitutions(recipe, [{ index: 1, name: "Margarina" }]);
    const after = compareWithPantry(effective, stockFromLots(lots));
    if (!after.ok) throw new Error("confronto");
    expect(missingIndices(after.value)).toEqual([]);
    expect(after.value.shortfalls).toEqual([]);
  });

  it("alla cottura si scala il sostituto, nella stessa quantità e scalata per le porzioni, e non l'originale", () => {
    const effective = applySubstitutions(recipe, [{ index: 1, name: "Margarina" }]);
    const proposal = proposeFromRecipe(effective, lots, { servings: 8 });
    const byLot = new Map(proposal.picks.map((p) => [p.lotId, p]));
    expect(byLot.get("m")?.quantity).toEqual({ value: 200, unit: "g" });
    expect(byLot.get("m")?.ingredientName).toBe("Margarina");
    expect(proposal.unmatched).toEqual([]);
    expect(picksFromProposal(proposal).map((p) => p.lotId).sort()).toEqual(["f", "m"]);
  });

  it("senza sostituzione l'originale non ha lotti da scalare", () => {
    const proposal = proposeFromRecipe(recipe, lots, { servings: 4 });
    expect(proposal.picks.map((p) => p.lotId)).toEqual(["f"]);
    expect(proposal.unmatched.map((u) => u.name)).toEqual(["Burro"]);
  });

  it("il controllo allergeni della cottura legge il sostituto e non l'originale", () => {
    const declared = { allergens: ["latte"], excludedFoods: [] };
    expect(recipeSafety(recipe, declared).verdict).toBe("contains");
    const effective = applySubstitutions(recipe, [{ index: 1, name: "Olio d'oliva" }]);
    expect(recipeSafety(effective, declared).verdict).toBe("clear");
    // un sostituto che contiene l'allergene resta bloccato anche se arriva da un indirizzo scritto a mano
    const forged = applySubstitutions(recipe, [{ index: 1, name: "Yogurt" }]);
    expect(recipeSafety(forged, declared).verdict).toBe("contains");
  });

  it("i passi non si riscrivono: se nominano l'originale il controllo li legge così (prudenza)", () => {
    const named = recipeOf("t2", { ...recipe, ingredients: recipe.ingredients, steps: [{ text: "Sciogli il burro." }] });
    const effective = applySubstitutions(named, [{ index: 1, name: "Olio d'oliva" }]);
    expect(recipeSafety(effective, { allergens: ["latte"], excludedFoods: [] }).verdict).toBe("contains");
  });
});

describe("la scelta nell'indirizzo", () => {
  it("va e viene", () => {
    const subs = withSubstitution(withSubstitution([], 3, "Margarina: la \"buona\" & più"), 1, "Yogurt");
    const href = recipeHref("/app/ricette/cucina", "r 1", subs, 4);
    const q = new URL(href, "http://x").searchParams;
    expect(q.get("id")).toBe("r 1");
    expect(q.get("porzioni")).toBe("4");
    expect(parseSubstitutions(q.getAll("sost"), 5)).toEqual([
      { index: 1, name: "Yogurt" },
      { index: 3, name: "Margarina: la \"buona\" & più" },
    ]);
  });
  it("scarta i nomi con caratteri di controllo", () => {
    const bad = ["1:Marga" + String.fromCharCode(0) + "rina", "1:Mar" + String.fromCharCode(10) + "ga", "2:A" + String.fromCharCode(0x85), "0:Olio"];
    expect(parseSubstitutions(bad, 5)).toEqual([{ index: 0, name: "Olio" }]);
  });
  it("valgono solo le scelte tra le proposte già controllate per quell'ingrediente", () => {
    const options = new Map([[1, [{ name: "Margarina" }]]]) as unknown as Parameters<typeof validSubstitutions>[1];
    expect(
      validSubstitutions(
        [
          { index: 1, name: "Margarina" },
          { index: 1, name: "Yogurt" },
          { index: 2, name: "Margarina" },
        ],
        options,
      ),
    ).toEqual([{ index: 1, name: "Margarina" }]);
    expect(validSubstitutions([{ index: 1, name: "Margarina" }], new Map())).toEqual([]);
  });
  it("dice quali scelte non sono state applicate e perché, in parole semplici", () => {
    const chosen = [{ index: 1, name: "Margarina" }, { index: 2, name: "Bietola" }, { index: 3, name: "Lime" }];
    const valid = [{ index: 3, name: "Lime" }];
    const originalName = (i: number) => ["Farina", "Burro", "Spinaci", "Limone"][i] ?? "";
    expect(unappliedNote(chosen, valid, { missing: [2, 3], failed: false, originalName })).toBe(
      "Sostituzioni non applicate: «Margarina» al posto di «Burro»: l'ingrediente ora è in dispensa o non serve più; «Bietola» al posto di «Spinaci»: non è più tra i sostituti che puoi usare. Vale la ricetta scritta.",
    );
    expect(unappliedNote(chosen.slice(1, 2), [], { missing: [2], failed: true, originalName })).toContain("controlla la connessione");
    expect(unappliedNote(chosen.slice(2), valid, { missing: [3], failed: false, originalName })).toBeUndefined();
    expect(unappliedNote([{ index: 1, name: "Margarina" }], [], { missing: [1], failed: false, originalName })).toMatch(/^Sostituzione non applicata: /);
    expect(unappliedNote([], [], { missing: [], failed: false, originalName })).toBeUndefined();
  });
  it("scarta ciò che non è valido", () => {
    expect(parseSubstitutions(["x:Margarina", "9:Burro", "2:", "2:   ", "1000:A", "senza", "0:Ok"], 5)).toEqual([{ index: 0, name: "Ok" }]);
  });
  it("una scelta per ingrediente, l'ultima vale; si può togliere", () => {
    expect(parseSubstitutions(["1:A", "1:B"], 3)).toEqual([{ index: 1, name: "B" }]);
    expect(withSubstitution([{ index: 1, name: "A" }], 1, null)).toEqual([]);
    expect(withSubstitution([{ index: 1, name: "A" }], 1, "B")).toEqual([{ index: 1, name: "B" }]);
  });
});
