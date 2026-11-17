import type { ParsedIngredient } from "./ingredient";
import type { RecipeEvent, RecipeSource, RecipeStep, RecipeTimes } from "./types";

export interface RecipeDraft {
  title?: string;
  servings?: number;
  ingredients: readonly ParsedIngredient[];
  steps: readonly RecipeStep[];
  times?: RecipeTimes;
  equipment?: readonly string[];
  tags?: readonly string[];
  origin?: RecipeSource;
}

export type RecipeEventFields = Pick<
  RecipeEvent,
  "title" | "servings" | "ingredients" | "steps" | "times" | "equipment" | "tags" | "origin"
>;

/**
 * Campi di un evento `recipe` da una bozza (testo incollato o pagina). Le porzioni mancanti prendono
 * `defaultServings` e il titolo mancante `defaultTitle`: sono scelte dichiarate, da rivedere.
 */
export function recipeFieldsFromDraft(
  draft: RecipeDraft,
  defaults: { servings?: number; title?: string } = {},
): RecipeEventFields {
  return {
    title: draft.title?.trim() || defaults.title || "Ricetta senza titolo",
    servings: draft.servings ?? defaults.servings ?? 4,
    ingredients: draft.ingredients.map((i) => ({
      name: i.name,
      ...(i.quantity ? { quantity: { ...i.quantity } } : {}),
      ...(i.note ? { note: i.note } : {}),
    })),
    steps: draft.steps.map((s) => ({ ...s })),
    ...(draft.times ? { times: { ...draft.times } } : {}),
    ...(draft.equipment && draft.equipment.length > 0 ? { equipment: [...draft.equipment] } : {}),
    ...(draft.tags && draft.tags.length > 0 ? { tags: [...draft.tags] } : {}),
    ...(draft.origin && Object.keys(draft.origin).length > 0 ? { origin: { ...draft.origin } } : {}),
  };
}
