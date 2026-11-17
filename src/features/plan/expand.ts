// Dagli identificativi di ricette e preparazioni agli ingredienti: è ciò che il piano chiede a chi lo usa.
// Gli ingredienti senza quantità o con unità non contabili (pizzico, confezione) non entrano: si dichiarano.
import type { ExpandRef, ExpandedIngredient, ItemRef } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import type { Recipe } from "@/core/recipes";
import { normalize } from "@/core/units";

export interface ExpandSources {
  recipes: readonly Recipe[];
  preps: readonly PrepRecord[];
}

/** Un ingrediente espanso con la sua nota: il piano non la usa per i conti, il controllo degli allergeni sì. */
type NotedIngredient = ExpandedIngredient & { note?: string };

export interface Expansion {
  ingredients: NotedIngredient[];
  /** Nomi degli ingredienti che non si sono potuti contare. */
  skipped: string[];
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function expandRef(src: ExpandSources, ref: ItemRef, servings: number): Expansion | undefined {
  if (!(servings > 0)) return undefined;
  if (ref.kind === "recipe") {
    const recipe = src.recipes.find((r) => r.recipeId === ref.id);
    if (!recipe || !(recipe.servings > 0)) return undefined;
    const factor = servings / recipe.servings;
    const out: Expansion = { ingredients: [], skipped: [] };
    for (const ing of recipe.ingredients) {
      if (!ing.quantity) {
        out.skipped.push(ing.name);
        continue;
      }
      const base = normalize({ value: ing.quantity.value * factor, unit: ing.quantity.unit });
      const unit = base.ok ? base.value.unit : undefined;
      if (!base.ok || (unit !== "g" && unit !== "ml" && unit !== "pz")) {
        out.skipped.push(ing.name);
        continue;
      }
      out.ingredients.push({
        name: ing.name,
        ...(ing.foodId ? { foodId: ing.foodId } : {}),
        ...(ing.note ? { note: ing.note } : {}),
        quantity: { value: round(base.value.value), unit },
      });
    }
    return out;
  }
  const prep = src.preps.find((p) => p.prepId === ref.id);
  if (!prep || !(prep.portions > 0)) return undefined;
  // le porzioni già pronte le sottrae il calcolo dei fabbisogni (`existingPortions`): qui sono gli ingredienti per `servings`
  const factor = servings / prep.portions;
  return {
    ingredients: prep.ingredients.map((i) => ({
      name: i.productRef,
      quantity: { value: round(i.quantity.value * factor), unit: i.quantity.unit },
    })),
    skipped: [],
  };
}

export function makeExpand(src: ExpandSources): ExpandRef {
  return (ref, servings) => expandRef(src, ref, servings)?.ingredients;
}

/**
 * Tutti gli ingredienti, anche quelli senza quantità («q.b.») o con unità non contabili: per i nutrienti si saltano, per
 * allergeni ed esclusioni no, perché «dado q.b.» può contenere glutine quanto «100 g di dado». La quantità è un segnaposto.
 */
export function makeExpandForChecks(src: ExpandSources): ExpandRef {
  return (ref, servings) => {
    const counted = expandRef(src, ref, servings);
    if (!counted) return undefined;
    if (ref.kind !== "recipe" || counted.skipped.length === 0) return counted.ingredients;
    const recipe = src.recipes.find((r) => r.recipeId === ref.id);
    const named = new Set(counted.ingredients.map((i) => i.name));
    const left = (recipe?.ingredients ?? [])
      .filter((i) => counted.skipped.includes(i.name) && !named.has(i.name))
      .map((i) => ({ name: i.name, ...(i.foodId ? { foodId: i.foodId } : {}), ...(i.note ? { note: i.note } : {}), quantity: { value: 0, unit: "g" as const } }));
    return [...counted.ingredients, ...left];
  };
}
