// Riferimenti a ricette e preparazioni: il piano non le conosce, le espande chi chiama.

import type { Quantity } from "../ledger";
import { normalizeName } from "../nutrition";
import type { PlannedItem } from "./types";

export type RefKind = "recipe" | "prep";

export interface ItemRef {
  kind: RefKind;
  id: string;
}

/** Ingrediente di una ricetta o di una preparazione, per le porzioni richieste. */
export interface ExpandedIngredient {
  name: string;
  foodId?: string;
  /** Quantità totale per le porzioni richieste, in unità base. */
  quantity: Quantity;
}

/**
 * Espande una ricetta o una preparazione negli ingredienti per `servings` porzioni.
 * `undefined` = non si sa come espanderla (ricetta o preparazione sconosciuta).
 */
export type ExpandRef = (
  ref: ItemRef,
  servings: number,
) => readonly ExpandedIngredient[] | undefined;

export function refOf(item: PlannedItem): ItemRef | undefined {
  if (item.kind === "recipe") return { kind: "recipe", id: item.recipeId };
  if (item.kind === "prep") return { kind: "prep", id: item.prepId };
  return undefined;
}

/** Chiavi di confronto di un alimento: identificativo di tabella e nome normalizzato. */
export function foodKeys(source: { name?: string; foodId?: string }): string[] {
  const keys: string[] = [];
  if (source.foodId !== undefined && source.foodId.trim() !== "") {
    keys.push(`id:${source.foodId.trim().toLowerCase()}`);
  }
  if (source.name !== undefined) {
    const n = normalizeName(source.name);
    if (n !== "") keys.push(`name:${n}`);
  }
  return keys;
}

/** Chiave principale di un alimento, per raggruppare. */
export function foodKey(source: { name?: string; foodId?: string }): string {
  return foodKeys(source)[0] ?? `name:${(source.name ?? "").trim().toLowerCase()}`;
}

export const roundQty = (n: number): number => Math.round(n * 1e6) / 1e6;
