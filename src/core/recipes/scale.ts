import { convert, type ConversionContext, type Quantity, type Unit, type Result } from "../units";
import type { RecipeError, RecipeIngredient } from "./types";
import { RECIPE_LIMITS } from "./types";

export interface Scalable {
  servings: number;
  ingredients: readonly RecipeIngredient[];
}

export interface ScaledIngredient extends RecipeIngredient {
  /** Quantità non arrotondata, presente solo se l'arrotondamento l'ha cambiata. */
  exactQuantity?: Quantity;
}

export interface ScaledRecipe {
  servings: number;
  /** Porzioni richieste diviso porzioni della ricetta. */
  factor: number;
  ingredients: ScaledIngredient[];
}

const fail = (code: RecipeError["code"], message: string): Result<never, RecipeError> => ({
  ok: false,
  error: { code, message },
});

const clean = (n: number): number => Number(n.toPrecision(12));

/** Passo di arrotondamento "da cucina" per unità e ordine di grandezza. */
function step(unit: Unit, v: number): number {
  switch (unit) {
    case "g":
    case "ml":
      return v < 5 ? 0.5 : v < 50 ? 1 : v < 1000 ? 5 : 10;
    case "mg":
      return v < 10 ? 0.5 : 5;
    case "hg":
      return 0.5;
    case "kg":
    case "l":
      return v < 1 ? 0.05 : 0.1;
    case "cl":
      return 1;
    case "dl":
      return 0.5;
    case "pz":
      return v < 5 ? 0.5 : 1;
    case "cucchiaio":
    case "cucchiaino":
    case "tazza":
    case "bicchiere":
      return v < 3 ? 0.25 : 0.5;
    case "pizzico":
      return 0.5;
    case "confezione":
      return 0.25;
  }
}

/** Arrotonda una quantità a un valore comodo da misurare, mai a zero. */
export function roundQuantity(q: Quantity): Quantity {
  const s = step(q.unit, q.value);
  const r = clean(Math.round(q.value / s) * s);
  return { value: r > 0 ? r : s, unit: q.unit };
}

/**
 * Scala gli ingredienti per un altro numero di porzioni. Le quantità sono arrotondate in modo
 * sensato per unità (5 g sopra i 50 g, mezzo pezzo, quarti di cucchiaio); con lo stesso numero di
 * porzioni non cambia nulla. Gli ingredienti senza quantità restano senza.
 */
export function scaleRecipe(
  recipe: Scalable,
  servings: number,
  options: { round?: boolean } = {},
): Result<ScaledRecipe, RecipeError> {
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) {
    return fail("invalid_servings", "Le porzioni della ricetta non sono valide.");
  }
  if (!Number.isFinite(servings) || servings <= 0 || servings > RECIPE_LIMITS.servingsMax) {
    return fail("invalid_servings", "Le porzioni richieste non sono valide.");
  }
  const factor = clean(servings / recipe.servings);
  const round = options.round !== false;
  const ingredients = recipe.ingredients.map((ing): ScaledIngredient => {
    const { quantity, ...rest } = ing;
    if (!quantity) return { ...rest };
    if (factor === 1) return { ...rest, quantity: { ...quantity } };
    const exact: Quantity = { value: clean(quantity.value * factor), unit: quantity.unit };
    if (!round) return { ...rest, quantity: exact };
    const rounded = roundQuantity(exact);
    return {
      ...rest,
      quantity: rounded,
      ...(rounded.value !== exact.value ? { exactQuantity: exact } : {}),
    };
  });
  return { ok: true, value: { servings, factor, ingredients } };
}

export interface PackageUse {
  /** Formato come dato dal chiamante. */
  size: Quantity;
  count: number;
}

export interface WholePackages {
  servings: number;
  factor: number;
  /** Tutte le quantità sono nell'unità dell'ingrediente. */
  needed: Quantity;
  provided: Quantity;
  leftover: Quantity;
  /** Avanzo diviso quantità nelle confezioni, da 0 a 1. */
  leftoverShare: number;
  packs: PackageUse[];
  /** Vero se le confezioni intere coprono la quantità senza avanzo. */
  exact: boolean;
}

export interface WholePackagesOptions {
  /** Intervallo di porzioni da considerare. Predefinito: da metà al doppio delle porzioni della ricetta. */
  minServings?: number;
  maxServings?: number;
  /** Passo tra un numero di porzioni e il successivo. Predefinito 1. */
  servingsStep?: number;
  /** Densità e peso unitario, se i formati sono in un'altra dimensione dell'ingrediente. */
  context?: ConversionContext;
}

const EPS = 1e-9;
const MAX_PACKS = 24;
const NODE_BUDGET = 20_000;
const MAX_CANDIDATES = 500;

interface Cover {
  total: number;
  packs: number;
  counts: number[];
}

/** Combinazione di confezioni intere con totale minimo non inferiore al fabbisogno. */
function cheapestCover(need: number, sizes: readonly number[]): Cover | null {
  const found: { best: Cover | null } = { best: null };
  const counts = new Array<number>(sizes.length).fill(0);
  let budget = NODE_BUDGET;
  const dfs = (i: number, total: number, packs: number): void => {
    if (budget-- <= 0) return;
    const best = found.best;
    if (best && best.total - need <= EPS) return;
    if (total >= need - EPS) {
      if (
        !best ||
        total < best.total - EPS ||
        (Math.abs(total - best.total) <= EPS && packs < best.packs)
      ) {
        found.best = { total, packs, counts: [...counts] };
      }
      return;
    }
    if (i >= sizes.length || packs >= MAX_PACKS) return;
    const s = sizes[i] as number;
    const maxCount = Math.min(Math.ceil((need - total) / s - EPS), MAX_PACKS - packs);
    for (let c = maxCount; c >= 0; c--) {
      counts[i] = c;
      dfs(i + 1, total + c * s, packs + c);
    }
    counts[i] = 0;
  };
  dfs(0, 0, 0);
  return found.best;
}

/**
 * Numero di porzioni che usa confezioni intere di un ingrediente con il minimo avanzo, dati i
 * formati disponibili (anche più di uno, per esempio 250 g e 500 g). Non scende mai sotto il
 * fabbisogno. A parità di avanzo vince il numero di porzioni più vicino a quello della ricetta, poi
 * il minor numero di confezioni.
 */
export function scaleToWholePackages(
  recipe: Scalable,
  ingredientIndex: number,
  formats: readonly Quantity[],
  options: WholePackagesOptions = {},
): Result<WholePackages, RecipeError> {
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) {
    return fail("invalid_servings", "Le porzioni della ricetta non sono valide.");
  }
  const ing = recipe.ingredients[ingredientIndex];
  if (!ing?.quantity) return fail("invalid_quantity", "L'ingrediente non ha una quantità.");
  const unit = ing.quantity.unit;
  const ctx = options.context ?? {};

  const sizes: { orig: Quantity; value: number }[] = [];
  let convertible = 0;
  for (const f of formats) {
    if (!(f.value > 0) || !Number.isFinite(f.value)) continue;
    const c = convert(f, unit, ctx);
    if (!c.ok) continue;
    convertible++;
    if (c.value.value > 0 && !sizes.some((s) => Math.abs(s.value - c.value.value) <= EPS)) {
      sizes.push({ orig: f, value: c.value.value });
    }
  }
  if (sizes.length === 0) {
    return formats.length === 0 || convertible === 0
      ? fail(
          formats.length === 0 ? "no_packages" : "not_convertible",
          formats.length === 0
            ? "Nessun formato di confezione indicato."
            : "I formati non si convertono nell'unità dell'ingrediente.",
        )
      : fail("no_packages", "Nessun formato di confezione valido.");
  }
  sizes.sort((a, b) => b.value - a.value);

  const minS = options.minServings ?? Math.max(1, Math.ceil(recipe.servings / 2));
  const maxS = options.maxServings ?? recipe.servings * 2;
  const stepS = options.servingsStep ?? 1;
  if (!(stepS > 0) || !Number.isFinite(minS) || !Number.isFinite(maxS) || minS <= 0 || maxS < minS) {
    return fail("invalid_range", "L'intervallo di porzioni non è valido.");
  }

  const perServing = ing.quantity.value / recipe.servings;
  let best:
    | { n: number; need: number; cover: Cover; distance: number }
    | undefined;
  for (let k = 0, n = minS; n <= maxS + EPS && k < MAX_CANDIDATES; k++, n = clean(minS + k * stepS)) {
    const need = perServing * n;
    const cover = cheapestCover(
      need,
      sizes.map((s) => s.value),
    );
    if (!cover) continue;
    const leftover = cover.total - need;
    const distance = Math.abs(n - recipe.servings);
    if (
      !best ||
      leftover < best.cover.total - best.need - EPS ||
      (Math.abs(leftover - (best.cover.total - best.need)) <= EPS &&
        (distance < best.distance - EPS ||
          (Math.abs(distance - best.distance) <= EPS && cover.packs < best.cover.packs)))
    ) {
      best = { n, need, cover, distance };
    }
  }
  if (!best) return fail("no_packages", "Nessuna combinazione di confezioni copre il fabbisogno.");

  const leftover = Math.max(0, clean(best.cover.total - best.need));
  const packs: PackageUse[] = [];
  best.cover.counts.forEach((count, i) => {
    if (count > 0) packs.push({ size: { ...(sizes[i] as { orig: Quantity }).orig }, count });
  });
  return {
    ok: true,
    value: {
      servings: best.n,
      factor: clean(best.n / recipe.servings),
      needed: { value: clean(best.need), unit },
      provided: { value: clean(best.cover.total), unit },
      leftover: { value: leftover, unit },
      leftoverShare: best.cover.total > 0 ? clean(leftover / best.cover.total) : 0,
      packs,
      exact: leftover <= 1e-6 * Math.max(1, best.cover.total),
    },
  };
}
