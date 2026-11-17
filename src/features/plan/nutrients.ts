// Nutrienti di una voce pianificata, per la verifica del piano. Riusa il risolutore delle voci senza toccarlo.
// Un valore parziale (manca il dato in qualche ingrediente) non si spaccia per completo: resta fuori, e la voce
// conta come dato mancante per quel nutriente.
import type { Certainty } from "@/core/ledger";
import {
  NUTRIENT_KEYS,
  nutrientsOfQuantity,
  type CompositionResolver,
  type NutrientAmounts,
  type NutrientTotals,
  type ResolvedComposition,
  type ResolverResult,
} from "@/core/nutrition";
import type { EntryNutrients, NutrientsOfEntry } from "@/core/plan";
import { prepNutrients, type PrepRecord } from "@/core/prep";
import { recipeNutrition, type Recipe } from "@/core/recipes";
import { PREP_REF_PREFIX, type PrepPortionInfo } from "../nutrition/prepPortion";

export interface NutrientSources {
  resolver: CompositionResolver;
  /** Che cosa si sa delle porzioni di preparazione risolte (`buildResolverWithInfo`): i nutrienti parziali restano fuori. */
  prepInfo?: ReadonlyMap<string, PrepPortionInfo>;
  recipes: readonly Recipe[];
  preps: readonly PrepRecord[];
  /** Categoria dei lotti, per riconoscere gli ingredienti di una preparazione. */
  lotCategory?: (lotId: string) => string | undefined;
}

const isComposition = (r: ResolverResult): r is ResolvedComposition => r !== undefined && "per100" in r;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function fromTotals(totals: NutrientTotals, servings: number, certainty: Certainty | undefined): EntryNutrients {
  const nutrients: NutrientAmounts = {};
  for (const key of NUTRIENT_KEYS) {
    const t = totals[key];
    if (t && !t.partial) nutrients[key] = round(t.value * servings);
  }
  if (Object.keys(nutrients).length === 0) return { ok: false, reason: "no_complete_nutrient" };
  return { ok: true, nutrients, ...(certainty !== undefined ? { certainty } : {}) };
}

export function makeNutrientsOf(src: NutrientSources): NutrientsOfEntry {
  return (entry) => {
    const item = entry.item;
    if (item.kind === "food") {
      const comp = src.resolver({
        kind: "mealItem",
        name: item.name,
        mealId: "plan",
        ...(item.foodId ? { foodId: item.foodId } : {}),
      });
      if (!isComposition(comp)) return { ok: false, reason: "unresolved_food" };
      const r = nutrientsOfQuantity(comp, item.quantity, "estimated");
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true, nutrients: r.value.nutrients, certainty: r.value.certainty, weight: r.value.amount };
    }
    if (item.kind === "recipe") {
      const recipe = src.recipes.find((r) => r.recipeId === item.recipeId);
      if (!recipe) return { ok: false, reason: "unknown_recipe" };
      const r = recipeNutrition({ servings: recipe.servings, ingredients: recipe.ingredients }, (ing) => {
        const comp = src.resolver({
          kind: "mealItem",
          name: ing.name,
          mealId: "plan",
          ...(ing.foodId ? { foodId: ing.foodId } : {}),
        });
        return isComposition(comp) ? comp : null;
      });
      if (!r.ok) return { ok: false, reason: "invalid_recipe" };
      return fromTotals(r.value.perServing, item.servings, r.value.certainty);
    }
    const prep = src.preps.find((p) => p.prepId === item.prepId);
    if (!prep) return { ok: false, reason: "unknown_prep" };
    // prima il risolutore: il lotto di porzioni ha già la sua composizione per porzione, calcolata dagli ingredienti
    const portion = src.resolver({ kind: "pantry", productRef: prep.title, lotId: prep.batchLotId });
    if (isComposition(portion) && portion.ref?.startsWith(PREP_REF_PREFIX)) {
      const partial = new Set((src.prepInfo?.get(portion.ref)?.partial ?? []).map((x) => x.key));
      const r = nutrientsOfQuantity(portion, { value: item.servings, unit: "pz" }, "estimated");
      if (r.ok) {
        const nutrients: NutrientAmounts = {};
        for (const key of NUTRIENT_KEYS) {
          const v = r.value.nutrients[key];
          if (v !== undefined && !partial.has(key)) nutrients[key] = v;
        }
        if (Object.keys(nutrients).length === 0) return { ok: false, reason: "no_complete_nutrient" };
        return { ok: true, nutrients, certainty: r.value.certainty };
      }
    }
    const p = prepNutrients(prep.ingredients, prep.portions, (ing) => {
      const comp = src.resolver({
        kind: "pantry",
        productRef: ing.productRef,
        lotId: ing.lotId,
        ...(src.lotCategory?.(ing.lotId) ? { category: src.lotCategory(ing.lotId) } : {}),
      });
      if (!isComposition(comp)) return { ok: false, reason: "unresolved_food" };
      const r = nutrientsOfQuantity(comp, ing.quantity, "estimated");
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true, nutrients: r.value.nutrients, certainty: r.value.certainty, weight: r.value.amount };
    });
    return fromTotals(p.perPortion, item.servings, p.certainty);
  };
}
