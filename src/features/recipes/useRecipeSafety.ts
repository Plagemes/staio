"use client";

// Il controllo di allergeni ed esclusioni per una ricetta aperta, con ciò che l'utente ha dichiarato nel ricettario e nel
// piano e con la dispensa e i prodotti salvati. Serve alla modalità cucina; la scheda fa lo stesso conto.
import { useMemo } from "react";
import { activeLots } from "@/core/ledger";
import type { Recipe } from "@/core/recipes";
import { usePantry, usePlan } from "@/data";
import { useProducts } from "../nutrition/useNutrition";
import { makeLinkOf, pantryFoods } from "./allergenLinks";
import { useRecipePrefs } from "./prefs";
import { hasDeclared, ingredientFlags, recipeSafety, unionDeclared, type IngredientFlag, type RecipeSafety } from "./safety";

export type RecipeSafetyState =
  | { status: "none" }
  | { status: "loading" }
  | {
      status: "ready";
      declared: { allergens: string[]; excludedFoods: string[] };
      safety: RecipeSafety;
      flags: Map<number, IngredientFlag>;
    };

/** `loading` finché dispensa, prodotti, piano e preferenze non sono letti: mai un «nessuna corrispondenza» senza etichette. */
export function useRecipeSafety(recipe: Recipe): RecipeSafetyState {
  const pantry = usePantry();
  const plan = usePlan();
  const products = useProducts();
  const { prefs, ready } = useRecipePrefs();
  const planAllergens = plan.data?.structure?.allergens;
  const planExcluded = plan.data?.structure?.excludedFoods;
  const declared = useMemo(
    () => ({
      allergens: unionDeclared(prefs.allergens, planAllergens ?? []),
      excludedFoods: unionDeclared(prefs.excludedFoods, planExcluded ?? []),
    }),
    [prefs.allergens, prefs.excludedFoods, planAllergens, planExcluded],
  );
  const loaded = ready && plan.data !== undefined && pantry.data !== undefined && products !== undefined;
  return useMemo<RecipeSafetyState>(() => {
    if (loaded && !hasDeclared(declared)) return { status: "none" };
    if (!loaded || !pantry.data) return { status: "loading" };
    const linkOf = makeLinkOf(pantryFoods(activeLots(pantry.data), products));
    const criteria = { ...declared, linkOf };
    return { status: "ready", declared, safety: recipeSafety(recipe, criteria), flags: ingredientFlags(recipe, criteria) };
  }, [loaded, declared, recipe, pantry.data, products]);
}
