// Nutrienti e costo per porzione. Composizioni e prezzi arrivano da funzioni passate come parametro:
// la quota di dato mancante è sempre dichiarata, un ingrediente senza dato non vale zero.

import { worseCertainty, type Certainty } from "../ledger";
import {
  nutrientsOfQuantity,
  sumNutrients,
  type NotComputableReason,
  type NutrientTotals,
  type ResolvedComposition,
  type SumPart,
} from "../nutrition";
import { convert, type ConversionContext, type Quantity, type Result } from "../units";
import type { RecipeError, RecipeIngredient } from "./types";

export interface Computable {
  servings: number;
  ingredients: readonly RecipeIngredient[];
  /** Certezza delle quantità scritte. Predefinito `estimated`. */
  certainty?: Certainty;
}

export type MissingReason = "no_quantity" | "no_composition" | "no_price" | NotComputableReason;

export interface MissingIngredient {
  index: number;
  name: string;
  reason: MissingReason;
}

export interface Coverage {
  ingredients: number;
  resolved: number;
  unresolved: MissingIngredient[];
  /** Quota di ingredienti senza dato, da 0 a 1. */
  unresolvedShare: number;
  /** Calcolata sul peso degli ingredienti se è noto per tutti, altrimenti sul numero. */
  shareBy: "weight" | "count";
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function coverageOf(
  rows: readonly { index: number; name: string; weight?: number; reason?: MissingReason }[],
): Coverage {
  const unresolved: MissingIngredient[] = rows
    .filter((r) => r.reason !== undefined)
    .map((r) => ({ index: r.index, name: r.name, reason: r.reason as MissingReason }));
  const weighted = rows.length > 0 && rows.every((r) => r.weight !== undefined && r.weight >= 0);
  const total = weighted ? rows.reduce((s, r) => s + (r.weight as number), 0) : 0;
  const byWeight = weighted && total > 0;
  const missing = byWeight
    ? rows.filter((r) => r.reason !== undefined).reduce((s, r) => s + (r.weight as number), 0) / total
    : rows.length === 0
      ? 0
      : unresolved.length / rows.length;
  return {
    ingredients: rows.length,
    resolved: rows.length - unresolved.length,
    unresolved,
    unresolvedShare: round6(Math.min(1, Math.max(0, missing))),
    shareBy: byWeight ? "weight" : "count",
  };
}

/** Peso approssimato in grammi (1 ml = 1 g, come nelle somme dei nutrienti), se si può dire. */
function weightOf(q: Quantity | undefined, ctx: ConversionContext): number | undefined {
  if (!q) return undefined;
  const g = convert(q, "g", ctx);
  if (g.ok) return g.value.value;
  const ml = convert(q, "ml", ctx);
  return ml.ok ? ml.value.value : undefined;
}

const invalidServings = (): Result<never, RecipeError> => ({
  ok: false,
  error: { code: "invalid_servings", message: "Le porzioni della ricetta non sono valide." },
});

export type CompositionLookup = (
  ingredient: RecipeIngredient,
  index: number,
) => ResolvedComposition | null | undefined;

export interface RecipeNutrition {
  servings: number;
  /** Totali per tutta la ricetta e per porzione. Un nutriente senza alcun dato non compare. */
  total: NutrientTotals;
  perServing: NutrientTotals;
  certainty?: Certainty;
  coverage: Coverage;
}

/**
 * Nutrienti della ricetta e per porzione. `resolve` dà la composizione di un ingrediente (per
 * `foodId` o per nome): se la restituisce, la quantità è convertita nella base della composizione
 * (peso del pezzo e densità compresi); altrimenti l'ingrediente è un dato mancante, dichiarato in
 * `coverage` e nella quota `missingShare` di ogni nutriente.
 */
export function recipeNutrition(
  recipe: Computable,
  resolve: CompositionLookup,
): Result<RecipeNutrition, RecipeError> {
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) return invalidServings();
  const quantityCertainty = recipe.certainty ?? "estimated";
  const parts: SumPart[] = [];
  const rows: { index: number; name: string; weight?: number; reason?: MissingReason }[] = [];

  recipe.ingredients.forEach((ing, index) => {
    const comp = ing.quantity ? resolve(ing, index) : undefined;
    const ctx: ConversionContext = {
      ...(comp?.densityGPerMl !== undefined ? { density: comp.densityGPerMl } : {}),
      ...(comp?.unitWeightG !== undefined ? { unitWeight: comp.unitWeightG } : {}),
    };
    const weight = weightOf(ing.quantity, ctx);
    const row = { index, name: ing.name, ...(weight !== undefined ? { weight } : {}) };
    if (!ing.quantity) {
      rows.push({ ...row, reason: "no_quantity" });
      parts.push({ nutrients: {} });
      return;
    }
    if (!comp) {
      rows.push({ ...row, reason: "no_composition" });
      parts.push({ nutrients: {}, ...(weight !== undefined ? { weight } : {}) });
      return;
    }
    const converted = convert(ing.quantity, comp.basis, ctx);
    if (!converted.ok) {
      const code = converted.error.code;
      const reason: NotComputableReason =
        code === "missing_density" || code === "missing_unit_weight"
          ? code
          : code === "invalid_value"
            ? "invalid_composition"
            : "not_convertible";
      rows.push({ ...row, reason });
      parts.push({ nutrients: {}, ...(weight !== undefined ? { weight } : {}) });
      return;
    }
    const r = nutrientsOfQuantity(comp, { value: converted.value.value, unit: comp.basis }, quantityCertainty);
    if (!r.ok) {
      rows.push({ ...row, reason: r.reason });
      parts.push({ nutrients: {}, ...(weight !== undefined ? { weight } : {}) });
      return;
    }
    rows.push({ ...row, weight: r.value.amount });
    parts.push({ nutrients: r.value.nutrients, certainty: r.value.certainty, weight: r.value.amount });
  });

  const sum = sumNutrients(parts);
  const perServing: NutrientTotals = {};
  for (const [key, t] of Object.entries(sum.totals) as [keyof NutrientTotals, NutrientTotals[keyof NutrientTotals]][]) {
    if (t) perServing[key] = { ...t, value: round6(t.value / recipe.servings) };
  }
  return {
    ok: true,
    value: {
      servings: recipe.servings,
      total: sum.totals,
      perServing,
      ...(sum.certainty !== undefined ? { certainty: sum.certainty } : {}),
      coverage: coverageOf(rows),
    },
  };
}

export interface Price {
  /** Prezzo, in centesimi, della quantità indicata (non per unità). Può avere decimali. */
  cents: number;
  certainty?: Certainty;
}

export type PriceLookup = (
  ingredient: RecipeIngredient,
  index: number,
) => Price | null | undefined;

export interface RecipeCost {
  servings: number;
  /** Somma dei prezzi noti, in centesimi interi: è un minimo se `partial`. */
  totalCents: number;
  perServingCents: number;
  partial: boolean;
  certainty?: Certainty;
  coverage: Coverage;
}

/**
 * Costo della ricetta e per porzione. `priceOf` dà il prezzo dell'intera quantità richiesta
 * dall'ingrediente; chi non ha prezzo non vale zero: è dichiarato in `coverage`.
 */
export function recipeCost(
  recipe: Computable,
  priceOf: PriceLookup,
): Result<RecipeCost, RecipeError> {
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) return invalidServings();
  let sum = 0;
  let certainty: Certainty | undefined;
  const rows: { index: number; name: string; weight?: number; reason?: MissingReason }[] = [];
  recipe.ingredients.forEach((ing, index) => {
    const weight = weightOf(ing.quantity, {});
    const row = { index, name: ing.name, ...(weight !== undefined ? { weight } : {}) };
    const price = priceOf(ing, index);
    if (!price || !Number.isFinite(price.cents) || price.cents < 0) {
      rows.push({ ...row, reason: "no_price" });
      return;
    }
    sum += price.cents;
    const c = price.certainty ?? "estimated";
    certainty = certainty === undefined ? c : worseCertainty(certainty, c);
    rows.push(row);
  });
  const coverage = coverageOf(rows);
  return {
    ok: true,
    value: {
      servings: recipe.servings,
      totalCents: Math.round(sum),
      perServingCents: Math.round(sum / recipe.servings),
      partial: coverage.unresolved.length > 0,
      ...(certainty !== undefined ? { certainty } : {}),
      coverage,
    },
  };
}
