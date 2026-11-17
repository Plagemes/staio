// L'ingrediente principale di una ricetta, per la riga «Con cosa sta bene». Logica pura.
import type { RecipeIngredient } from "@/core/recipes";
import { fold } from "./common";

/** Ingredienti di base che quasi mai sono «il piatto»: si saltano, a meno che non resti altro. */
const STAPLES = new Set(["acqua", "sale", "pepe", "olio", "aceto", "zucchero", "farina", "lievito", "vino", "brodo", "dado", "spezie", "erbe"]);

const isStaple = (name: string): boolean => STAPLES.has(fold(name).split(" ")[0] ?? "");

/**
 * Gli indici da provare, in ordine: gli ingredienti della ricetta nell'ordine in cui sono scritti, senza quelli di base.
 * Se sono tutti di base, tutti. Il primo che l'elenco degli abbinamenti conosce è l'ingrediente principale.
 */
export function mainCandidates(ingredients: readonly Pick<RecipeIngredient, "name">[]): number[] {
  const all = ingredients.map((_, i) => i);
  const dishes = all.filter((i) => !isStaple(ingredients[i]?.name ?? ""));
  return dishes.length > 0 ? dishes : all;
}
