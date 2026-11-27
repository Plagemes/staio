// Gruppi che una ricetta porta in una porzione. Solo nome e id della tabella degli ingredienti: niente ricerca
// per somiglianza, che resta al calcolo dei nutrienti.

import { worseCertainty, type Certainty } from "../ledger";
import type { Recipe } from "../recipes/types";
import { convert, type Quantity } from "../units";
import { DIET_GROUPS, type ClassPart, type Classifier, type DietGroup, type PortionTable, type RecipeDietFacts } from "./types";

/**
 * Un gruppo conta in una porzione di ricetta se gli ingredienti di quel gruppo arrivano almeno a questa quota
 * della porzione standard (scelta dell'app, FONTI.md): mezzo cucchiaio d'olio o un pizzico di formaggio no.
 */
export const MIN_SHARE_OF_PORTION = 0.5;

const isDietGroup = (g: string): g is DietGroup => (DIET_GROUPS as readonly string[]).includes(g);

/**
 * Porzioni standard di una quantità per la parte data. Un pezzo vale una porzione (stima); tra massa e volume,
 * senza densità, 1 g = 1 ml (stima). `undefined` se la parte non ha porzione o la quantità non si converte.
 */
export function servingsOfQuantity(
  quantity: Quantity,
  part: Pick<ClassPart, "portionKey">,
  portions: PortionTable,
): { servings: number; certainty: Certainty } | undefined {
  const portion = part.portionKey !== undefined ? portions[part.portionKey] : undefined;
  if (!portion || !(portion.amount > 0) || !Number.isFinite(quantity.value) || quantity.value < 0) return undefined;
  if (quantity.unit === "pz") return { servings: quantity.value, certainty: "estimated" };
  const direct = convert(quantity, portion.unit);
  if (direct.ok) return { servings: direct.value.value / portion.amount, certainty: "label" };
  const other = convert(quantity, portion.unit === "g" ? "ml" : "g");
  if (other.ok) return { servings: other.value.value / portion.amount, certainty: "estimated" };
  return undefined;
}

export interface IngredientServing {
  part: ClassPart;
  quantity?: Quantity;
}

/** Porzioni per gruppo di un insieme di ingredienti, divise per `servings`; solo i gruppi sopra la soglia. */
export function groupServings(
  ingredients: readonly IngredientServing[],
  servings: number,
  portions: PortionTable,
): { groups: DietGroup[]; servingsByGroup: Partial<Record<DietGroup, number>>; certainty: Certainty } {
  const per = servings > 0 ? servings : 1;
  const sums = new Map<DietGroup, { servings: number; certainty: Certainty }>();
  for (const { part, quantity } of ingredients) {
    if (!quantity || !isDietGroup(part.group)) continue;
    const s = servingsOfQuantity(quantity, part, portions);
    if (!s) continue;
    const prev = sums.get(part.group);
    sums.set(part.group, {
      servings: (prev?.servings ?? 0) + s.servings / per,
      certainty: worseCertainty(prev?.certainty ?? "label", worseCertainty(part.certainty, s.certainty)),
    });
  }
  const groups: DietGroup[] = [];
  const servingsByGroup: Partial<Record<DietGroup, number>> = {};
  let certainty: Certainty | undefined;
  for (const g of DIET_GROUPS) {
    const s = sums.get(g);
    if (!s || s.servings < MIN_SHARE_OF_PORTION) continue;
    groups.push(g);
    servingsByGroup[g] = Math.round(s.servings * 100) / 100;
    certainty = certainty === undefined ? s.certainty : worseCertainty(certainty, s.certainty);
  }
  return { groups, servingsByGroup, certainty: certainty ?? "estimated" };
}

/** Gruppi di una porzione della ricetta. Un ingrediente senza quantità («q.b.») non porta il gruppo. */
export function recipeDietFacts(
  recipe: Pick<Recipe, "recipeId" | "servings" | "ingredients">,
  classifier: Pick<Classifier, "name">,
  portions: PortionTable,
): RecipeDietFacts {
  const ingredients: IngredientServing[] = recipe.ingredients.map((ing) => ({
    part: classifier.name(ing.name, ing.foodId !== undefined && ing.foodId !== "" ? ing.foodId : undefined),
    ...(ing.quantity !== undefined ? { quantity: ing.quantity } : {}),
  }));
  const { groups, servingsByGroup, certainty } = groupServings(ingredients, recipe.servings, portions);
  return { recipeId: recipe.recipeId, groups, servingsByGroup, certainty };
}
