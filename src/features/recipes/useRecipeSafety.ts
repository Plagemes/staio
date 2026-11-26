"use client";

// Il controllo di allergeni ed esclusioni per una ricetta aperta, con ciò che l'utente ha dichiarato (lettura unica di
// `features/allergens`), con la dispensa e i prodotti salvati e con le conferme dell'utente sugli ingredienti non
// verificabili. Serve alla modalità cucina e alla scheda.
import { useMemo } from "react";
import { activeLots } from "@/core/ledger";
import type { Recipe } from "@/core/recipes";
import { usePantry } from "@/data";
import { declaredLists, useDietDeclarations } from "../allergens";
import { useProducts } from "../nutrition/useNutrition";
import { makeLinkOf, pantryFoods } from "./allergenLinks";
import { useConfirmations } from "./useConfirmations";
import { hasDeclared, ingredientFlags, recipeSafety, type IngredientFlag, type RecipeSafety } from "./safety";

export type RecipeSafetyState =
  | { status: "none" }
  | { status: "loading" }
  | {
      status: "ready";
      declared: { allergens: string[]; excludedFoods: string[] };
      safety: RecipeSafety;
      flags: Map<number, IngredientFlag>;
      /** Un posto delle dichiarazioni non si legge: il controllo usa ciò che si legge e il pannello lo dice sempre. */
      incomplete: boolean;
    };

const NOTHING = { allergens: [] as string[], excludedFoods: [] as string[] };

/**
 * Ciò che l'utente ha dichiarato (allergeni ed esclusioni, da tutti i posti). `ready` solo quando è letto; `incomplete`
 * se un posto non si legge: chi mostra un elenco filtrato deve dirlo accanto.
 */
export function useDeclared(): { declared: { allergens: string[]; excludedFoods: string[] }; ready: boolean; incomplete: boolean } {
  const { state } = useDietDeclarations();
  const declared = useMemo(() => (state ? declaredLists(state) : NOTHING), [state]);
  return { declared, ready: state !== undefined, incomplete: state !== undefined && !state.complete };
}

/** `loading` finché dispensa, prodotti, piano, preferenze e conferme non sono letti: mai un «nessuna corrispondenza» senza etichette. */
export function useRecipeSafety(recipe: Recipe): RecipeSafetyState {
  const pantry = usePantry();
  const products = useProducts();
  const { state: declarations } = useDietDeclarations();
  const { declared, ready: declaredReady } = useDeclared();
  const incomplete = declarations !== undefined && !declarations.complete;
  const { byKey: confirmations } = useConfirmations();
  const loaded = declaredReady && pantry.data !== undefined && products !== undefined && confirmations !== undefined;
  return useMemo<RecipeSafetyState>(() => {
    // con un posto illeggibile il pannello resta, anche senza voci lette: deve dire che il controllo è incompleto
    if (loaded && !hasDeclared(declared) && !incomplete) return { status: "none" };
    if (!loaded || !pantry.data) return { status: "loading" };
    const linkOf = makeLinkOf(pantryFoods(activeLots(pantry.data), products));
    const criteria = { ...declared, linkOf, ...(confirmations ? { confirmations } : {}) };
    return { status: "ready", declared, safety: recipeSafety(recipe, criteria), flags: ingredientFlags(recipe, criteria), incomplete };
  }, [loaded, declared, incomplete, recipe, pantry.data, products, confirmations]);
}
