// Nutrienti e costo di una ricetta, per porzione, con la quota di dato mancante dichiarata. Logica pura:
// la tabella degli alimenti e lo storico dei prezzi arrivano come parametri.
import {
  DEFAULT_STATE_PREFERENCE,
  compositionFromFood,
  type FoodComposition,
  type NutrientKey,
  type NutrientTotals,
  type ResolvedComposition,
} from "@/core/nutrition";
import {
  bestMatches,
  recipeCost,
  recipeNutrition,
  type CompositionLookup,
  type Coverage,
  type MissingReason,
  type PriceLookup,
  type Recipe,
  type RecipeCost,
  type RecipeIngredient,
  type RecipeNutrition,
} from "@/core/recipes";
import type { PriceBook } from "@/core/shopping";
import { convert, type ConversionContext } from "@/core/units";
import { formatPrice } from "../format";
import { formatNutrient, nutrientLabel } from "../nutrition/labels";
import { missingPercentText } from "../nutrition/prepare";
import { buildResolver, type FoodOverrides } from "../nutrition/resolver";

/**
 * Composizione di un ingrediente: l'alimento scelto dall'utente se c'è, altrimenti per nome. Gli ingredienti di una
 * ricetta si cercano nello stato crudo o secco (pasta e riso si pesano asciutti): è un'ipotesi, e la schermata la dice.
 */
export function makeLookup(foods: readonly FoodComposition[], overrides: FoodOverrides = {}): CompositionLookup {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const resolve = buildResolver({ foods, products: new Map(), barcodes: new Map(), overrides });
  return (ing: RecipeIngredient): ResolvedComposition | null => {
    if (ing.foodId) {
      const food = byId.get(ing.foodId);
      return food ? compositionFromFood(food, undefined, "explicit") : null;
    }
    const result = resolve({ kind: "mealItem", name: ing.name, mealId: "recipe", preferStates: DEFAULT_STATE_PREFERENCE.pantry });
    return result && !("failure" in result) ? result : null;
  };
}

/** Densità e peso del pezzo dell'alimento riconosciuto, per confrontare unità diverse (un uovo contro 4 pezzi). */
export function makeContextFor(lookup: CompositionLookup): (ing: RecipeIngredient, index: number) => ConversionContext {
  return (ing, index) => {
    const c = lookup(ing, index);
    return {
      ...(c?.densityGPerMl !== undefined ? { density: c.densityGPerMl } : {}),
      ...(c?.unitWeightG !== undefined ? { unitWeight: c.unitWeightG } : {}),
    };
  };
}

/** Prezzo dell'ingrediente dall'ultimo acquisto osservato dello stesso prodotto. Senza acquisti: nessun prezzo. */
export function priceLookupFrom(book: PriceBook, contextFor?: (ing: RecipeIngredient, index: number) => ConversionContext): PriceLookup {
  const series = book.series.filter((s) => s.scope === "name" && s.storeKey === null);
  return (ing, index) => {
    if (!ing.quantity) return null;
    const matches = bestMatches({ name: ing.name, ...(ing.foodId ? { foodId: ing.foodId } : {}) }, series, (s) => ({ name: s.name }));
    const ctx = contextFor?.(ing, index) ?? {};
    for (const s of matches) {
      const c = convert(ing.quantity, s.unit, ctx);
      if (c.ok) return { cents: s.last.centsPerBase * c.value.value, certainty: s.certainty };
    }
    return null;
  };
}

export interface RecipeFacts {
  nutrition?: RecipeNutrition;
  cost?: RecipeCost;
}

export interface FactsInput {
  lookup?: CompositionLookup;
  book?: PriceBook;
}

/** Nutrienti e costo per porzione di una ricetta. Ciò che non si può calcolare resta assente: non vale zero. */
export function computeFacts(recipe: Pick<Recipe, "servings" | "ingredients" | "certainty">, input: FactsInput): RecipeFacts {
  const out: RecipeFacts = {};
  const computable = { servings: recipe.servings, ingredients: recipe.ingredients, certainty: recipe.certainty };
  if (input.lookup) {
    const n = recipeNutrition(computable, input.lookup);
    if (n.ok) out.nutrition = n.value;
  }
  if (input.book) {
    const contextFor = input.lookup ? makeContextFor(input.lookup) : undefined;
    const c = recipeCost(computable, priceLookupFrom(input.book, contextFor));
    if (c.ok) out.cost = c.value;
  }
  return out;
}

const REASON_TEXT: Record<MissingReason, string> = {
  no_quantity: "senza quantità",
  no_composition: "alimento non riconosciuto",
  no_price: "nessun prezzo",
  invalid_quantity: "quantità non valida",
  missing_density: "manca la densità",
  missing_unit_weight: "manca il peso del pezzo",
  invalid_composition: "dati non validi",
  not_convertible: "unità non convertibile",
};

/** "Mancano i dati di 2 ingredienti su 7 (circa il 18% del peso): pomodori (alimento non riconosciuto), sale (senza quantità)." */
export function coverageText(c: Coverage, what: "dati" | "prezzi" = "dati"): string | undefined {
  if (c.unresolved.length === 0) return undefined;
  const n = c.unresolved.length;
  const head = `${n === 1 ? "Manca" : "Mancano"} i ${what === "dati" ? "dati" : "prezzi"} di ${n} ingredient${n === 1 ? "e" : "i"} su ${c.ingredients}`;
  const share = c.shareBy === "weight" ? ` (circa il ${missingPercentText(c.unresolvedShare)} del peso)` : "";
  const list = c.unresolved
    .slice(0, 4)
    .map((u) => `${u.name.toLowerCase()} (${REASON_TEXT[u.reason]})`)
    .join(", ");
  const more = c.unresolved.length > 4 ? ` e altri ${c.unresolved.length - 4}` : "";
  return `${head}${share}: ${list}${more}.`;
}

export interface NutrientLine {
  key: NutrientKey;
  label: string;
  /** "412 kcal". */
  text: string;
  /** "almeno " se il valore è un minimo per dato mancante. */
  prefix: string;
  partial: boolean;
  /** "manca il 12% del dato", se parziale. */
  missing?: string;
}

const SHOWN: readonly NutrientKey[] = ["energyKcal", "proteinG", "carbsG", "fatG", "fiberG", "saltG"];

/** Righe per porzione dei nutrienti principali; un nutriente senza alcun dato non compare. */
export function nutrientLines(n: Pick<RecipeNutrition, "perServing">): NutrientLine[] {
  return nutrientLinesOf(n.perServing);
}

export function nutrientLinesOf(perServing: NutrientTotals): NutrientLine[] {
  const out: NutrientLine[] = [];
  for (const key of SHOWN) {
    const t = perServing[key];
    if (!t) continue;
    out.push({
      key,
      label: nutrientLabel(key),
      text: formatNutrient(key, t.value),
      prefix: t.partial ? "almeno " : "",
      partial: t.partial,
      ...(t.partial ? { missing: `manca il ${missingPercentText(t.missingShare)} del dato` } : {}),
    });
  }
  return out;
}

/** "2,40 €" oppure "almeno 2,40 €" se manca il prezzo di qualche ingrediente. */
export function costText(c: RecipeCost): { prefix: string; text: string } {
  return { prefix: c.partial ? "almeno " : "", text: formatPrice(c.perServingCents) };
}
