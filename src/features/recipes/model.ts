// Eventi `recipe`: nuova ricetta, modifica, voto, ritiro. Ogni versione sostituisce la precedente
// (stesso `recipeId`), quindi «Annulla» è l'annullamento dell'ultimo evento.
import { SCHEMA_VERSION, generateId, type Certainty } from "@/core/ledger";
import {
  validateRecipeEvent,
  type Recipe,
  type RecipeEvent,
  type RecipeEventFields,
} from "@/core/recipes";
import type { EventCtx } from "./common";

export type SaveResult = { ok: true; event: RecipeEvent } | { ok: false; error: string };

function envelope(ctx: EventCtx, certainty: Certainty) {
  return {
    id: (ctx.idGenerator ?? generateId)(),
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty,
    source: "manual" as const,
  };
}

/** Evita `undefined` espliciti: i campi assenti non devono comparire nell'evento. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function check(event: RecipeEvent): SaveResult {
  return validateRecipeEvent(event).length > 0
    ? { ok: false, error: "Non riesco a scrivere questa ricetta: controlla i campi." }
    : { ok: true, event };
}

export interface NewRecipeOptions {
  recipeId?: string;
  /** Scritta a mano: `measured`. Letta da una pagina o da un testo: `estimated`. */
  certainty: Certainty;
  rating?: number;
}

/** Nuova ricetta, o nuova versione se si passa `recipeId`. */
export function recipeEventFromFields(fields: RecipeEventFields, ctx: EventCtx, options: NewRecipeOptions): SaveResult {
  const idGen = ctx.idGenerator ?? generateId;
  const event: RecipeEvent = compact({
    ...envelope(ctx, options.certainty),
    type: "recipe" as const,
    recipeId: options.recipeId ?? idGen(),
    title: fields.title,
    servings: fields.servings,
    ingredients: fields.ingredients,
    steps: fields.steps,
    times: fields.times,
    equipment: fields.equipment,
    tags: fields.tags,
    origin: fields.origin,
    rating: options.rating,
  });
  return check(event);
}

/** I campi di una ricetta in vigore, come servono a una nuova versione. */
export function fieldsOfRecipe(recipe: Recipe): RecipeEventFields {
  return compact({
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    times: recipe.times,
    equipment: recipe.equipment.length > 0 ? recipe.equipment : undefined,
    tags: recipe.tags.length > 0 ? recipe.tags : undefined,
    origin: recipe.origin,
  });
}

/** Nuova versione con un altro voto (`undefined` toglie il voto). */
export function rateRecipe(recipe: Recipe, rating: number | undefined, ctx: EventCtx): SaveResult {
  return recipeEventFromFields(fieldsOfRecipe(recipe), ctx, {
    recipeId: recipe.recipeId,
    certainty: recipe.certainty,
    rating,
  });
}

/** Ritira la ricetta: resta nel registro, sparisce dall'elenco. Annullando l'evento torna com'era. */
export function retireRecipe(recipe: Recipe, ctx: EventCtx): SaveResult {
  const base = recipeEventFromFields(fieldsOfRecipe(recipe), ctx, {
    recipeId: recipe.recipeId,
    certainty: recipe.certainty,
    rating: recipe.rating,
  });
  if (!base.ok) return base;
  return check({ ...base.event, archived: true });
}
