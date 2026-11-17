import { canonicalStringify, type ValidationError } from "../ledger";
import type { Recipe, RecipeEvent } from "./types";
import { isRecipeEvent, validateRecipeEvent } from "./validate";

export type RecipeAnomalyCode =
  /** Voce non valida: scartata. */
  | "invalid_event"
  /** Stesso id con contenuti diversi (ne è stato scelto uno, sempre lo stesso). */
  | "id_conflict"
  | "void_cycle";

export interface RecipeAnomaly {
  code: RecipeAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  errors?: ValidationError[];
}

export interface RecipesState {
  /** Ricette in vigore, per titolo e poi per `recipeId`. */
  recipes: Recipe[];
  /** Ricette ritirate (ultima versione con `archived`), stesso ordine. */
  archived: Recipe[];
  anomalies: RecipeAnomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

export interface VoidRef {
  id: string;
  targetEventId: string;
}

/**
 * Un evento annullato non conta; un annullamento annullato a sua volta ripristina l'originale.
 * Il risultato dipende solo dall'insieme dei `void`, non dal loro ordine.
 */
export function resolveVoids(refs: readonly VoidRef[], anomalies: RecipeAnomaly[]): Set<string> {
  const voids = new Map<string, VoidRef>();
  for (const v of refs) voids.set(v.id, v);

  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const start of voids.keys()) {
    const position = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && voids.has(cur) && !done.has(cur)) {
      const seen = position.get(cur);
      if (seen !== undefined) {
        for (const id of path.slice(seen)) cyclic.add(id);
        break;
      }
      position.set(cur, path.length);
      path.push(cur);
      cur = voids.get(cur)?.targetEventId;
    }
    for (const id of path) done.add(id);
  }

  const effective: VoidRef[] = [];
  for (const v of voids.values()) {
    if (cyclic.has(v.id)) {
      anomalies.push({ code: "void_cycle", eventId: v.id, targetEventId: v.targetEventId });
    } else effective.push(v);
  }

  // Un void è attivo se nessun void attivo lo annulla: si risolve dalle foglie verso l'alto.
  const incoming = new Map<string, VoidRef[]>();
  for (const v of effective) {
    const list = incoming.get(v.targetEventId);
    if (list) list.push(v);
    else incoming.set(v.targetEventId, [v]);
  }
  const pending = new Map<string, number>();
  const queue: VoidRef[] = [];
  for (const v of effective) {
    const n = incoming.get(v.id)?.length ?? 0;
    pending.set(v.id, n);
    if (n === 0) queue.push(v);
  }
  const active = new Map<string, boolean>();
  const voided = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i] as VoidRef;
    const isActive = !(incoming.get(v.id) ?? []).some((s) => active.get(s.id));
    active.set(v.id, isActive);
    if (isActive) voided.add(v.targetEventId);
    const left = pending.get(v.targetEventId);
    const target = voids.get(v.targetEventId);
    if (left !== undefined && target) {
      pending.set(v.targetEventId, left - 1);
      if (left - 1 === 0) queue.push(target);
    }
  }
  return voided;
}

const ms = (iso: string): number => Date.parse(iso);

/** Vince l'evento con `recordedAt` maggiore, a parità quello con `id` maggiore. */
function isNewer(a: RecipeEvent, b: RecipeEvent): boolean {
  const ta = ms(a.recordedAt);
  const tb = ms(b.recordedAt);
  return ta > tb || (ta === tb && a.id > b.id);
}

const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toRecipe(winner: RecipeEvent, createdAt: string): Recipe {
  return {
    recipeId: winner.recipeId,
    title: winner.title,
    servings: winner.servings,
    ingredients: winner.ingredients.map((i) => ({
      name: i.name,
      ...(i.quantity ? { quantity: { value: i.quantity.value, unit: i.quantity.unit } } : {}),
      ...(i.foodId ? { foodId: i.foodId } : {}),
      ...(i.note ? { note: i.note } : {}),
    })),
    steps: winner.steps.map((s) => ({
      text: s.text,
      ...(s.durationMinutes !== undefined ? { durationMinutes: s.durationMinutes } : {}),
    })),
    ...(winner.times ? { times: { ...winner.times } } : {}),
    equipment: [...(winner.equipment ?? [])],
    tags: [...(winner.tags ?? [])],
    ...(winner.origin ? { origin: { ...winner.origin } } : {}),
    ...(winner.rating !== undefined ? { rating: winner.rating } : {}),
    certainty: winner.certainty,
    updatedAt: winner.recordedAt,
    createdAt,
    eventId: winner.id,
  };
}

/**
 * Ricette in vigore dagli eventi del registro (anche misti ad altri tipi, che sono ignorati).
 * Non dipende dall'ordine degli eventi e non lancia mai.
 */
export function deriveRecipes(events: readonly unknown[]): RecipesState {
  const anomalies: RecipeAnomaly[] = [];
  const byId = new Map<string, { event: Rec; key: string }>();

  for (const raw of Array.isArray(events) ? events : []) {
    try {
      if (!isRecord(raw)) continue;
      const isVoid = raw.type === "void";
      if (!isVoid && !isRecipeEvent(raw)) continue;
      const errors = validateRecipeEvent(raw);
      if (errors.length > 0) {
        anomalies.push({
          code: "invalid_event",
          ...(typeof raw.id === "string" ? { eventId: raw.id } : {}),
          errors,
        });
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

  const voidRefs: VoidRef[] = [];
  const recipeEvents: RecipeEvent[] = [];
  for (const { event } of byId.values()) {
    if (event.type === "void") {
      voidRefs.push({ id: event.id as string, targetEventId: event.targetEventId as string });
    } else recipeEvents.push(event as unknown as RecipeEvent);
  }

  // Un bersaglio sconosciuto non è un'anomalia: nel registro comune può essere di un altro modulo.
  const voided = resolveVoids(voidRefs, anomalies);

  const winners = new Map<string, RecipeEvent>();
  const created = new Map<string, string>();
  for (const e of recipeEvents) {
    if (voided.has(e.id)) continue;
    const first = created.get(e.recipeId);
    if (first === undefined || ms(e.recordedAt) < ms(first)) created.set(e.recipeId, e.recordedAt);
    const cur = winners.get(e.recipeId);
    if (!cur || isNewer(e, cur)) winners.set(e.recipeId, e);
  }

  const active: Recipe[] = [];
  const archived: Recipe[] = [];
  for (const w of winners.values()) {
    const r = toRecipe(w, created.get(w.recipeId) ?? w.recordedAt);
    (w.archived === true ? archived : active).push(r);
  }
  const order = (a: Recipe, b: Recipe): number =>
    cmpText(a.title.toLowerCase(), b.title.toLowerCase()) ||
    cmpText(a.title, b.title) ||
    cmpText(a.recipeId, b.recipeId);
  active.sort(order);
  archived.sort(order);

  anomalies.sort(
    (a, b) =>
      cmpText(a.code, b.code) ||
      cmpText(a.eventId ?? "", b.eventId ?? "") ||
      cmpText(a.targetEventId ?? "", b.targetEventId ?? ""),
  );

  return {
    recipes: active,
    archived,
    anomalies,
    voidedEventIds: [...voided].sort(cmpText),
  };
}
