// Ponte verso la lista della spesa: «Aggiungi ciò che manca».
// Chiave, forma e somma delle quantità stanno in `@/features/shopping`: qui si preparano solo le voci.
import type { RecipeIngredient } from "@/core/recipes";
import { addManualEntries, type AddToListResult, type ManualInput } from "../shopping";

export interface ShoppingProposal {
  /** Tutti gli ingredienti mancanti. Quelli senza quantità («q.b.») entrano come voci senza quantità. */
  entries: ManualInput[];
  /** Sempre vuoto: nessun ingrediente viene più saltato. Resta perché il campo c'era. */
  withoutQuantity: string[];
}

/** Dalle quantità che mancano alle voci della lista. */
export function proposalFromShortfalls(shortfalls: readonly RecipeIngredient[]): ShoppingProposal {
  return {
    entries: shortfalls.map((s) => ({ product: s.name, ...(s.quantity ? { quantity: s.quantity } : {}) })),
    withoutQuantity: [],
  };
}

/** Scrive le voci nella lista della spesa. Restituisce quante voci ha aggiunto. */
export async function addToShoppingList(added: readonly ManualInput[]): Promise<number> {
  return (await addManualEntries(added)).added;
}

/** Come `addToShoppingList`, ma restituisce anche ciò che serve per «Annulla». */
export function addToShoppingListWithUndo(added: readonly ManualInput[]): Promise<AddToListResult> {
  return addManualEntries(added);
}
