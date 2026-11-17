// Nutrienti per porzione di una preparazione. Le composizioni degli ingredienti le dà chi chiama.
// Un nutriente di cui manca il dato in qualche ingrediente è parziale, con la quota mancante dichiarata.

import type { Certainty, Quantity } from "../ledger";
import {
  NUTRIENT_KEYS,
  isValidYieldFactor,
  sumNutrients,
  type NutrientAmounts,
  type NutrientKey,
  type NutrientTotal,
  type NutrientTotals,
  type SumPart,
} from "../nutrition";
import type { EntryNutrients } from "../plan";

/** Ingrediente di una preparazione, come lo vede la funzione dei nutrienti. */
export interface NutrientIngredient {
  lotId: string;
  productRef: string;
  /** Quantità consumata, nell'unità del lotto. */
  quantity: Quantity;
}

/** Nutrienti dell'intera quantità dell'ingrediente. `ok: false` = non calcolabile. */
export type IngredientNutrients = EntryNutrients;

export interface PrepNutrientsOptions {
  /**
   * Peso cotto diviso peso crudo (come `YieldRule.cookedPerRaw`). Ipotesi dichiarata: la variazione
   * di peso è solo acqua, gli altri nutrienti si conservano. Serve al peso della porzione e ai
   * valori per 100 g; non cambia i nutrienti per porzione, tranne l'acqua.
   */
  cookedPerRaw?: number;
}

export interface PrepNutrients {
  /** Per porzione. Un nutriente senza alcun dato non compare: è sconosciuto, non zero. */
  perPortion: NutrientTotals;
  /** Per l'intera preparazione. */
  total: NutrientTotals;
  /** La peggiore certezza tra gli ingredienti che portano dati. */
  certainty?: Certainty;
  /** Ingredienti che la funzione non ha saputo calcolare. */
  notComputable: string[];
  /** Con una resa valida e tutti i pesi crudi noti: peso della porzione cotta, in grammi. */
  portionWeightG?: number;
  /** Per 100 g di preparazione cotta, solo per i nutrienti con dato completo. Richiede `portionWeightG`. */
  per100g?: NutrientAmounts;
  /** Vero se la resa ha corretto l'acqua (solo con il dato dell'acqua completo). */
  waterAdjusted: boolean;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

function weightOf(ing: NutrientIngredient, r: IngredientNutrients): number | undefined {
  if (r.weight !== undefined) return r.weight;
  return ing.quantity.unit === "g" ? ing.quantity.value : undefined;
}

export function prepNutrients(
  ingredients: readonly NutrientIngredient[],
  portions: number,
  nutrientsOf: (ingredient: NutrientIngredient) => IngredientNutrients,
  options: PrepNutrientsOptions = {},
): PrepNutrients {
  const parts: SumPart[] = [];
  const notComputable: string[] = [];
  const weights: (number | undefined)[] = [];
  for (const ing of ingredients) {
    const r = nutrientsOf(ing);
    const weight = weightOf(ing, r);
    weights.push(weight);
    if (!r.ok) {
      notComputable.push(ing.lotId);
      parts.push({ nutrients: {}, ...(weight !== undefined ? { weight } : {}) });
    } else {
      parts.push({
        nutrients: r.nutrients,
        ...(r.certainty !== undefined ? { certainty: r.certainty } : {}),
        ...(weight !== undefined ? { weight } : {}),
      });
    }
  }
  const sum = sumNutrients(parts);
  const total: NutrientTotals = { ...sum.totals };

  const validPortions = Number.isFinite(portions) && portions > 0;
  const yieldOk = options.cookedPerRaw !== undefined && isValidYieldFactor(options.cookedPerRaw);
  const rawWeight = weights.every((w) => w !== undefined)
    ? (weights as number[]).reduce((s, w) => s + w, 0)
    : undefined;
  const cookedWeight =
    yieldOk && rawWeight !== undefined && rawWeight > 0
      ? rawWeight * (options.cookedPerRaw as number)
      : undefined;

  let waterAdjusted = false;
  const water = total.waterG;
  if (cookedWeight !== undefined && water && !water.partial && rawWeight !== undefined) {
    total.waterG = { ...water, value: round(Math.max(0, water.value + (cookedWeight - rawWeight))) };
    waterAdjusted = true;
  }

  const perPortion: NutrientTotals = {};
  if (validPortions) {
    for (const key of Object.keys(total) as NutrientKey[]) {
      const t = total[key] as NutrientTotal;
      perPortion[key] = { ...t, value: round(t.value / portions) };
    }
  }

  let portionWeightG: number | undefined;
  let per100g: NutrientAmounts | undefined;
  if (cookedWeight !== undefined && validPortions) {
    portionWeightG = round(cookedWeight / portions);
    per100g = {};
    for (const key of NUTRIENT_KEYS) {
      const t = total[key];
      if (t && !t.partial) per100g[key] = round((t.value / cookedWeight) * 100);
    }
  }

  return {
    perPortion,
    total,
    ...(sum.certainty !== undefined ? { certainty: sum.certainty } : {}),
    notComputable,
    ...(portionWeightG !== undefined ? { portionWeightG } : {}),
    ...(per100g !== undefined ? { per100g } : {}),
    waterAdjusted,
  };
}
