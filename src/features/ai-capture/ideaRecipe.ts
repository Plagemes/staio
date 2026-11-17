// Da un'idea di ricetta controllata all'evento `recipe` da salvare nel ricettario. Marcata come generata, con la fonte dichiarata.
import type { CheckedIdea } from "@/core/ai/recipeIdeasCheck";
import type { RecipeEventFields } from "@/core/recipes";
import type { EventCtx } from "../recipes/common";
import { recipeEventFromFields, type SaveResult } from "../recipes/model";

/** Etichetta che marca nel ricettario le ricette generate. */
export const GENERATED_TAG = "generata";

export interface IdeaSource {
  /** Nome del fornitore, come lo vede l'utente. */
  provider: string;
  model: string;
}

/** La dichiarazione di fonte: chi l'ha generata e che va letta con giudizio. */
export function generatedAuthor(source: IdeaSource): string {
  return `idea generata da ${source.provider}, modello ${source.model}: da rivedere`;
}

/** I campi del ricettario. Le note di cottura e conservazione del modello diventano un ultimo passo, dichiarato tale. */
export function fieldsFromIdea(checked: Pick<CheckedIdea, "idea">, source: IdeaSource): RecipeEventFields {
  const { idea } = checked;
  const steps = idea.steps.map((s) => ({ ...s }));
  if (idea.notes) steps.push({ text: `Note del modello su cottura e conservazione (da verificare): ${idea.notes}` });
  return {
    title: idea.title,
    servings: idea.servings,
    ingredients: idea.ingredients.map((i) => ({ name: i.name, ...(i.quantity ? { quantity: { ...i.quantity } } : {}), ...(i.note ? { note: i.note } : {}) })),
    steps,
    ...(idea.times ? { times: { ...idea.times } } : {}),
    ...(idea.equipment.length > 0 ? { equipment: [...idea.equipment] } : {}),
    tags: [GENERATED_TAG],
    origin: { author: generatedAuthor(source) },
  };
}

export interface SaveIdeaOptions {
  /** L'utente ha confermato di aver controllato le etichette degli ingredienti incerti. */
  confirmedUncertain?: boolean;
}

export const UNCERTAIN_NOT_CONFIRMED =
  "Alcuni ingredienti potrebbero contenere i tuoi allergeni: conferma di aver controllato le etichette prima di salvare.";

/**
 * L'evento da scrivere dopo la conferma. Certezza `estimated`: il contenuto non è verificato. Una ricetta con
 * ingredienti incerti per gli allergeni dichiarati non si salva senza `confirmedUncertain`.
 */
export function recipeEventFromIdea(
  checked: Pick<CheckedIdea, "idea"> & Partial<Pick<CheckedIdea, "uncertain">>,
  source: IdeaSource,
  ctx: EventCtx,
  options: SaveIdeaOptions = {},
): SaveResult {
  if ((checked.uncertain?.length ?? 0) > 0 && options.confirmedUncertain !== true) {
    return { ok: false, error: UNCERTAIN_NOT_CONFIRMED };
  }
  return recipeEventFromFields(fieldsFromIdea(checked, source), ctx, { certainty: "estimated" });
}
