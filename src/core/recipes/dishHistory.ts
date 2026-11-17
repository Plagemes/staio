// Storico delle cotture dagli eventi `dishRating`: quante volte, com'è andata, quanto la ricetta piace.
import { canonicalStringify } from "../ledger";
import { resolveVoids, type RecipeAnomaly, type VoidRef } from "./derive";
import type { DishRating, DishRatingEvent } from "./types";
import { isDishRatingEvent, validateRecipeEvent } from "./validate";

/** Valore di un voto per le medie: non buono 0, buono 1, ottimo 2. */
export const DISH_RATING_VALUE: Record<DishRating, number> = { poor: 0, good: 1, great: 2 };

/** Una cottura: un pasto di una ricetta, con l'ultimo voto dato. */
export interface Cooking {
  mealId: string;
  recipeId: string;
  /** Istante della prima registrazione di questa cottura. */
  at: string;
  rating?: DishRating;
  again?: boolean;
  /** Id dell'evento che ha stabilito lo stato attuale (per annullarlo o correggerlo). */
  eventId: string;
}

export interface DishHistory {
  /** Cotture in ordine di tempo (poi `mealId`). */
  cookings: Cooking[];
  anomalies: RecipeAnomaly[];
}

export interface RecipeHistory {
  recipeId: string;
  /** Quante volte è stata cucinata. */
  times: number;
  /** Quante di queste hanno un voto. */
  rated: number;
  counts: Record<DishRating, number>;
  /** Quante volte c'è «lo rifarei» (tra le cotture votate o no). */
  again: number;
  /** L'ultima cottura. */
  last: Cooking;
  /** Media dei voti (0 = non buono, 2 = ottimo); assente se nessuna cottura è votata. */
  average?: number;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const ms = (iso: string): number => Date.parse(iso);

function isNewer(a: DishRatingEvent, b: DishRatingEvent): boolean {
  const ta = ms(a.recordedAt);
  const tb = ms(b.recordedAt);
  return ta > tb || (ta === tb && a.id > b.id);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Le cotture dal registro (anche misto ad altri tipi). Per ogni pasto vale l'ultimo evento non annullato: una
 * correzione è un nuovo evento, annullarla riporta il voto di prima. Un pasto assente o annullato non è una cottura.
 * Non dipende dall'ordine degli eventi e non lancia mai.
 */
export function deriveDishHistory(events: readonly unknown[]): DishHistory {
  const anomalies: RecipeAnomaly[] = [];
  const byId = new Map<string, { event: Rec; key: string }>();
  const mealEvents = new Map<string, string[]>();

  for (const raw of Array.isArray(events) ? events : []) {
    try {
      if (!isRecord(raw)) continue;
      if (raw.type === "meal" && typeof raw.id === "string" && typeof raw.mealId === "string") {
        const list = mealEvents.get(raw.mealId) ?? [];
        list.push(raw.id);
        mealEvents.set(raw.mealId, list);
        continue;
      }
      const isVoid = raw.type === "void";
      if (!isVoid && !isDishRatingEvent(raw)) continue;
      const errors = validateRecipeEvent(raw);
      if (errors.length > 0) {
        if (!isVoid) anomalies.push({ code: "invalid_event", ...(typeof raw.id === "string" ? { eventId: raw.id } : {}), errors });
        continue;
      }
      const id = raw.id as string;
      const key = canonicalStringify(raw);
      const cur = byId.get(id);
      if (!cur) byId.set(id, { event: raw, key });
      else if (cur.key !== key) {
        anomalies.push({ code: "id_conflict", eventId: id });
        if (key > cur.key) byId.set(id, { event: raw, key });
      }
    } catch {
      anomalies.push({ code: "invalid_event" });
    }
  }

  const refs: VoidRef[] = [];
  const ratings: DishRatingEvent[] = [];
  for (const { event } of byId.values()) {
    if (event.type === "void") refs.push({ id: event.id as string, targetEventId: event.targetEventId as string });
    else ratings.push(event as unknown as DishRatingEvent);
  }
  const voided = resolveVoids(refs, anomalies);

  const winners = new Map<string, DishRatingEvent>();
  const first = new Map<string, string>();
  for (const e of ratings) {
    if (voided.has(e.id)) continue;
    const f = first.get(e.mealId);
    if (f === undefined || ms(e.at) < ms(f)) first.set(e.mealId, e.at);
    const cur = winners.get(e.mealId);
    if (!cur || isNewer(e, cur)) winners.set(e.mealId, e);
  }

  const cookings: Cooking[] = [];
  for (const [mealId, w] of winners) {
    const meals = mealEvents.get(mealId);
    // conta solo un pasto presente nel registro e non annullato (almeno una riga attiva)
    if (!meals || meals.every((id) => voided.has(id))) continue;
    cookings.push({
      mealId,
      recipeId: w.recipeId,
      at: first.get(mealId) ?? w.at,
      ...(w.rating !== undefined ? { rating: w.rating } : {}),
      ...(w.again === true ? { again: true } : {}),
      eventId: w.id,
    });
  }
  cookings.sort((a, b) => ms(a.at) - ms(b.at) || cmp(a.mealId, b.mealId));
  anomalies.sort((a, b) => cmp(a.code, b.code) || cmp(a.eventId ?? "", b.eventId ?? ""));
  return { cookings, anomalies };
}

/** Lo storico di ogni ricetta cucinata, per `recipeId`. */
export function summarizeCookings(cookings: readonly Cooking[]): Map<string, RecipeHistory> {
  const out = new Map<string, RecipeHistory>();
  const sums = new Map<string, number>();
  for (const c of cookings) {
    let h = out.get(c.recipeId);
    if (!h) {
      h = { recipeId: c.recipeId, times: 0, rated: 0, counts: { poor: 0, good: 0, great: 0 }, again: 0, last: c };
      out.set(c.recipeId, h);
    }
    h.times++;
    if (c.again) h.again++;
    if (c.rating) {
      h.rated++;
      h.counts[c.rating]++;
      sums.set(c.recipeId, (sums.get(c.recipeId) ?? 0) + DISH_RATING_VALUE[c.rating]);
    }
    if (ms(c.at) > ms(h.last.at) || (c.at === h.last.at && c.mealId > h.last.mealId)) h.last = c;
  }
  for (const [id, h] of out) if (h.rated > 0) h.average = (sums.get(id) ?? 0) / h.rated;
  return out;
}

/** Punteggio per «Le tue preferite»: la media dei voti; `undefined` se mai votata. */
export function favoriteScore(h: RecipeHistory | undefined): number | undefined {
  return h?.average;
}

/**
 * Confronto per «Le tue preferite»: prima chi ha un voto, dalla media più alta; a parità chi hai rifatto o
 * rifaresti più volte, poi chi hai cucinato più spesso. Nessun voto: in coda (l'ordine tra loro lo decide chi chiama).
 */
export function compareByFavorite(a: RecipeHistory | undefined, b: RecipeHistory | undefined): number {
  const sa = favoriteScore(a);
  const sb = favoriteScore(b);
  if (sa === undefined && sb === undefined) return 0;
  if (sa === undefined) return 1;
  if (sb === undefined) return -1;
  return sb - sa || (b?.again ?? 0) - (a?.again ?? 0) || (b?.times ?? 0) - (a?.times ?? 0);
}
