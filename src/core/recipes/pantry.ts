import type { Lot } from "../ledger";
import { convert, type ConversionContext, type Quantity } from "../units";
import { classifyMatches, matchKind } from "./match";
import { scaleRecipe, type Scalable } from "./scale";
import type { RecipeError, RecipeIngredient } from "./types";

/** Giacenza di un alimento in dispensa, come serve al confronto. */
export interface PantryStock {
  /** Riferimento del prodotto (id di catalogo o nome libero). */
  ref: string;
  name?: string;
  foodId?: string;
  quantity: Quantity;
  /** Prima scadenza tra i lotti, `YYYY-MM-DD`. */
  earliestExpiry?: string;
}

const FOOD_ID_RE = /^[a-z0-9-]+$/;

/** Somma i lotti attivi per prodotto e unità. Lo stato della dispensa resta un parametro: qui si legge soltanto. */
export function stockFromLots(lots: readonly Lot[]): PantryStock[] {
  const map = new Map<string, PantryStock>();
  for (const lot of lots) {
    if (lot.status !== "active" || !(lot.remaining > 0)) continue;
    const key = `${lot.productRef}\u0000${lot.unit}`;
    const cur = map.get(key);
    const date = lot.expiry?.date;
    if (cur) {
      cur.quantity = { value: cur.quantity.value + lot.remaining, unit: cur.quantity.unit };
      if (date && (!cur.earliestExpiry || date < cur.earliestExpiry)) cur.earliestExpiry = date;
    } else {
      map.set(key, {
        ref: lot.productRef,
        name: lot.productRef,
        ...(FOOD_ID_RE.test(lot.productRef) ? { foodId: lot.productRef } : {}),
        quantity: { value: lot.remaining, unit: lot.unit },
        ...(date ? { earliestExpiry: date } : {}),
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/**
 * - `available`: c'è, con la stessa identità dell'alimento, in quantità sufficiente (o l'ingrediente
 *   non ha quantità, come "sale q.b."; allora `check` è `presence`).
 * - `partial`: c'è ma non basta (`shortfall` è ciò che manca, calcolato sulle giacenze convertibili).
 * - `missing`: non c'è.
 * - `unquantified`: c'è, ma nessuna giacenza si converte nell'unità richiesta (per esempio
 *   "1 confezione" contro 500 g senza dimensione della confezione): la presenza è nota, la
 *   quantità no. Non vale mai come disponibile.
 * - `to_confirm`: c'è qualcosa di simile ma non lo stesso alimento ("uova" contro "pasta all'uovo",
 *   "latte" contro "latte di cocco"): l'utente deve confermare. Non vale mai come disponibile.
 */
export type Availability = "available" | "partial" | "missing" | "unquantified" | "to_confirm";

export interface IngredientAvailability {
  index: number;
  ingredient: RecipeIngredient;
  status: Availability;
  /** Quantità necessaria per le porzioni richieste (assente se l'ingrediente non ha quantità). */
  needed?: Quantity;
  /** Quantità in dispensa nell'unità dell'ingrediente, sommando le sole giacenze convertibili. */
  available?: Quantity;
  /** Ciò che manca, per `partial` e `missing`. */
  shortfall?: Quantity;
  /** `quantity`: confronto di quantità; `presence`: si è verificata solo la presenza. */
  check: "quantity" | "presence";
  /** Giacenze associate all'ingrediente. */
  matched: string[];
  /** Giacenze associate che non si convertono nell'unità richiesta (non sommate in `available`). */
  unquantified?: string[];
}

export interface PantryComparison {
  servings: number;
  items: IngredientAvailability[];
  counts: Record<Availability, number>;
  /** Ingredienti da comprare: per `partial` la parte che manca, per `missing` tutta la quantità. */
  shortfalls: RecipeIngredient[];
  /** Quota di ingredienti `available`, da 0 a 1 (1 per una ricetta senza ingredienti). `unquantified` e `to_confirm` non contano. */
  coverage: number;
}

export interface CompareOptions {
  /** Porzioni da preparare. Predefinito: quelle della ricetta. */
  servings?: number;
  /** Densità e peso unitario per le conversioni tra dimensioni, per ingrediente. */
  contextFor?: (ingredient: RecipeIngredient, index: number) => ConversionContext;
}

/**
 * Confronta gli ingredienti (per le porzioni richieste, senza arrotondare) con la dispensa:
 * disponibile, parziale, mancante, di quantità non nota o da confermare (vedi `Availability`).
 * Prudenza: un alimento simile ma non uguale ("uova" e "pasta all'uovo") è sempre "da confermare";
 * una giacenza che non si converte nell'unità richiesta non vale mai come disponibile.
 */
export function compareWithPantry(
  recipe: Scalable,
  stock: readonly PantryStock[],
  options: CompareOptions = {},
): { ok: true; value: PantryComparison } | { ok: false; error: RecipeError } {
  const servings = options.servings ?? recipe.servings;
  const scaled = scaleRecipe(recipe, servings, { round: false });
  if (!scaled.ok) return scaled;

  const items: IngredientAvailability[] = [];
  const shortfalls: RecipeIngredient[] = [];
  const counts: Record<Availability, number> = {
    available: 0,
    partial: 0,
    missing: 0,
    unquantified: 0,
    to_confirm: 0,
  };

  scaled.value.ingredients.forEach((ing, index) => {
    const { kind, matches } = classifyMatches(
      { name: ing.name, ...(ing.foodId ? { foodId: ing.foodId } : {}) },
      stock.filter((s) => s.quantity.value > 0),
      (s) => ({ ...(s.name ? { name: s.name } : { name: s.ref }), ...(s.foodId ? { foodId: s.foodId } : {}) }),
    );
    const base = { index, ingredient: ing as RecipeIngredient, matched: matches.map((m) => m.ref) };
    const needed = ing.quantity;
    const shortRow = (q: Quantity | undefined): RecipeIngredient => ({
      name: ing.name,
      ...(q ? { quantity: q } : {}),
      ...(ing.foodId ? { foodId: ing.foodId } : {}),
      ...(ing.note ? { note: ing.note } : {}),
    });

    let item: IngredientAvailability;
    if (matches.length === 0) {
      item = {
        ...base,
        status: "missing",
        ...(needed ? { needed, shortfall: needed } : {}),
        check: needed ? "quantity" : "presence",
      };
    } else if (!needed) {
      item = { ...base, status: kind === "exact" ? "available" : "to_confirm", check: "presence" };
    } else {
      const ctx = options.contextFor?.(ing, index) ?? {};
      let sum = 0;
      const unconvertible: string[] = [];
      for (const m of matches) {
        const c = convert(m.quantity, needed.unit, ctx);
        if (c.ok) sum += c.value.value;
        else unconvertible.push(m.ref);
      }
      const have = Math.round(sum * 1e9) / 1e9;
      const quantified = have > 0 ? { available: { value: have, unit: needed.unit } } : {};
      const withUnconvertible = unconvertible.length > 0 ? { unquantified: unconvertible } : {};
      if (kind === "partial") {
        // Non è sicuro che sia lo stesso alimento: le quantità, se note, sono solo informative.
        item = {
          ...base,
          status: "to_confirm",
          needed,
          ...quantified,
          ...withUnconvertible,
          check: have > 0 ? "quantity" : "presence",
        };
      } else if (have >= needed.value * (1 - 1e-9)) {
        item = { ...base, status: "available", needed, ...quantified, ...withUnconvertible, check: "quantity" };
      } else if (have > 0) {
        // Una giacenza non convertibile non colma la differenza: resta parziale.
        item = {
          ...base,
          status: "partial",
          needed,
          ...quantified,
          ...withUnconvertible,
          shortfall: { value: Math.round((needed.value - have) * 1e9) / 1e9, unit: needed.unit },
          check: "quantity",
        };
      } else if (unconvertible.length > 0) {
        item = { ...base, status: "unquantified", needed, ...withUnconvertible, check: "presence" };
      } else {
        item = { ...base, status: "missing", needed, shortfall: needed, check: "quantity" };
      }
    }
    counts[item.status]++;
    if (item.status === "partial" || item.status === "missing") shortfalls.push(shortRow(item.shortfall));
    items.push(item);
  });

  return {
    ok: true,
    value: {
      servings,
      items,
      counts,
      shortfalls,
      coverage: items.length === 0 ? 1 : counts.available / items.length,
    },
  };
}

export interface ExpiringFood {
  name?: string;
  foodId?: string;
  /** Giorni alla scadenza; zero o negativo se scade oggi o è già scaduto. */
  daysLeft: number;
}

export interface ExpiringUse {
  food: ExpiringFood;
  ingredientIndex: number;
  weight: number;
  /** `partial`: l'ingrediente somiglia soltanto all'alimento ("pasta all'uovo" per "uova"); pesa la metà. */
  match: "exact" | "partial";
}

export interface ExpiringRank<T> {
  recipe: T;
  score: number;
  uses: ExpiringUse[];
}

/** Peso di un alimento in scadenza: 1 se scade oggi o è scaduto, poi decresce. */
export function expiryWeight(daysLeft: number): number {
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return 1;
  return Math.round((1 / (1 + daysLeft / 2)) * 1e6) / 1e6;
}

/**
 * Ordina le ricette per "usa ciò che sta scadendo": somma dei pesi degli alimenti in scadenza che la
 * ricetta usa (ciascuno una volta), poi numero di alimenti usati, poi titolo. Le ricette che non
 * usano nulla restano in coda, in ordine di titolo.
 */
export function rankByExpiring<T extends { title?: string; ingredients: readonly RecipeIngredient[] }>(
  recipes: readonly T[],
  expiring: readonly ExpiringFood[],
): ExpiringRank<T>[] {
  const ranked = recipes.map((recipe, order) => {
    const uses: ExpiringUse[] = [];
    for (const food of expiring) {
      const ref = { ...(food.name ? { name: food.name } : {}), ...(food.foodId ? { foodId: food.foodId } : {}) };
      let best: { index: number; kind: "exact" | "partial" } | undefined;
      recipe.ingredients.forEach((ing, i) => {
        const kind = matchKind(ref, { name: ing.name, ...(ing.foodId ? { foodId: ing.foodId } : {}) });
        if (kind === "none") return;
        if (!best || (kind === "exact" && best.kind === "partial")) best = { index: i, kind };
      });
      if (best) {
        const found: { index: number; kind: "exact" | "partial" } = best;
        const weight = expiryWeight(food.daysLeft) * (found.kind === "exact" ? 1 : 0.5);
        uses.push({ food, ingredientIndex: found.index, weight: Math.round(weight * 1e6) / 1e6, match: found.kind });
      }
    }
    const score = Math.round(uses.reduce((s, u) => s + u.weight, 0) * 1e6) / 1e6;
    return { recipe, score, uses, order };
  });
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.uses.length - a.uses.length ||
      (a.recipe.title ?? "").toLowerCase().localeCompare((b.recipe.title ?? "").toLowerCase(), "it") ||
      a.order - b.order,
  );
  return ranked.map(({ recipe, score, uses }) => ({ recipe, score, uses }));
}
