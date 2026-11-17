// «Com'era?»: gli eventi `dishRating` e i testi dello storico di una ricetta. Logica pura.
import { SCHEMA_VERSION, generateId } from "@/core/ledger";
import {
  validateRecipeEvent,
  type Cooking,
  type DishRating,
  type DishRatingEvent,
  type RecipeHistory,
} from "@/core/recipes";
import type { EventCtx } from "./common";

export const RATING_LABELS: Record<DishRating, string> = { poor: "Non buono", good: "Buono", great: "Ottimo" };
export const RATING_ORDER: readonly DishRating[] = ["poor", "good", "great"];

/** Come si dice dell'ultima volta: «l'ultima ottima». */
const LAST_WORD: Record<DishRating, string> = { poor: "non buona", good: "buona", great: "ottima" };

export interface DishVote {
  rating?: DishRating;
  again?: boolean;
}

export type DishResult = { ok: true; event: DishRatingEvent } | { ok: false; error: string };

/**
 * L'evento che lega un pasto a una ricetta, con l'eventuale voto. Il primo per un pasto lo segna come cucinata;
 * uno successivo (stesso `mealId`) corregge il voto. Senza `rating` il voto è tolto; «lo rifarei» senza voto resta.
 */
export function dishRatingEvent(mealId: string, recipeId: string, vote: DishVote, ctx: EventCtx): DishResult {
  const event: DishRatingEvent = {
    id: (ctx.idGenerator ?? generateId)(),
    type: "dishRating",
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: "measured",
    source: "manual",
    mealId,
    recipeId,
    ...(vote.rating ? { rating: vote.rating } : {}),
    ...(vote.again ? { again: true } : {}),
  };
  return validateRecipeEvent(event).length > 0
    ? { ok: false, error: "Non riesco a salvare il voto." }
    : { ok: true, event };
}

/** «Cucinata 4 volte, l'ultima ottima». Vuoto se non è mai stata cucinata. */
export function historyText(h: RecipeHistory | undefined): string | undefined {
  if (!h || h.times === 0) return undefined;
  const times = h.times === 1 ? "Cucinata una volta" : `Cucinata ${h.times} volte`;
  const last = h.last.rating ? `, ${h.times === 1 ? "è venuta" : "l'ultima"} ${LAST_WORD[h.last.rating]}` : "";
  return `${times}${last}${h.last.again ? ": la rifaresti" : ""}`;
}

/** Il dettaglio dei voti, per chi vuole vedere i conteggi: «2 ottime, 1 buona, 1 non buona». */
export function countsText(h: RecipeHistory): string | undefined {
  if (h.rated === 0) return undefined;
  const parts: string[] = [];
  if (h.counts.great > 0) parts.push(h.counts.great === 1 ? "1 ottima" : `${h.counts.great} ottime`);
  if (h.counts.good > 0) parts.push(h.counts.good === 1 ? "1 buona" : `${h.counts.good} buone`);
  if (h.counts.poor > 0) parts.push(`${h.counts.poor} non ${h.counts.poor === 1 ? "buona" : "buone"}`);
  const unrated = h.times - h.rated;
  if (unrated > 0) parts.push(unrated === 1 ? "1 senza voto" : `${unrated} senza voto`);
  return parts.join(", ");
}

/** Le cotture di una ricetta, dall'ultima. */
export function cookingsOf(cookings: readonly Cooking[], recipeId: string): Cooking[] {
  return cookings.filter((c) => c.recipeId === recipeId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.mealId < a.mealId ? -1 : 1));
}

export const SORT_FAVORITES_HINT =
  "In cima ciò che hai votato meglio dopo averlo cucinato (media dei voti; a parità prima ciò che rifaresti e che cucini più spesso). Le ricette mai votate seguono, per nome.";
