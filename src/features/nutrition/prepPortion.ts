// Nutrienti di una porzione di preparazione: si calcolano dagli ingredienti, risolti con lo stesso risolutore.
// Il lotto di porzioni ha il titolo del piatto come nome: la tabella non lo conosce, ma gli ingredienti sì.
import {
  DEFAULT_STATE_PREFERENCE,
  NUTRIENT_KEYS,
  nutrientsOfQuantity,
  type CompositionResolver,
  type NutrientAmounts,
  type NutrientKey,
  type ResolvedComposition,
  type ResolverResult,
} from "@/core/nutrition";
import { prepNutrients, type NutrientIngredient, type PrepRecord } from "@/core/prep";

export type PrepForNutrients = Pick<PrepRecord, "prepId" | "title" | "portions" | "ingredients" | "cookedPerRaw">;

/** Che cosa si sa di una porzione: da dire accanto al valore, perché è una stima e può essere parziale. */
export interface PrepPortionInfo {
  /** `prep:<prepId>`: è il `ref` della composizione, così si ritrova dalle righe del giorno. */
  ref: string;
  title: string;
  ingredientCount: number;
  /** Nomi degli ingredienti senza dato (o con quantità non convertibile). */
  unresolved: string[];
  /** Nutrienti il cui valore è parziale (un minimo), con la quota mancante. */
  partial: { key: NutrientKey; missingShare: number }[];
  /** Nessun ingrediente porta alcun dato: la porzione non ha alcun valore. */
  empty: boolean;
}

export const PREP_REF_PREFIX = "prep:";
export const isPrepRef = (ref: string | undefined): ref is string => ref !== undefined && ref.startsWith(PREP_REF_PREFIX);

const isComposition = (r: ResolverResult): r is ResolvedComposition => r !== undefined && "per100" in r;

/**
 * Composizione di una porzione: il valore per porzione di ogni nutriente di cui almeno un ingrediente ha il dato.
 * Un nutriente parziale (manca il dato in qualche ingrediente) è un minimo: lo dice `info.partial`, con la quota
 * mancante, e `markPrepPartials` lo segna come parziale nei totali del giorno e dei confronti.
 * Un pezzo vale 100 «g» virtuali, così i valori per 100 g sono i valori per porzione.
 * Origine `derived`: la certezza è al meglio una stima.
 */
export function composePrepPortion(
  prep: PrepForNutrients,
  resolve: CompositionResolver,
): { composition?: ResolvedComposition; info: PrepPortionInfo } {
  const ingredients: NutrientIngredient[] = prep.ingredients.map((i) => ({ lotId: i.lotId, productRef: i.productRef, quantity: i.quantity }));
  const result = prepNutrients(
    ingredients,
    prep.portions,
    (ing) => {
      const found = resolve({ kind: "pantry", productRef: ing.productRef, lotId: ing.lotId, preferStates: DEFAULT_STATE_PREFERENCE.pantry });
      if (!isComposition(found)) return { ok: false, reason: "no_composition" };
      const r = nutrientsOfQuantity(found, ing.quantity, "estimated");
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true, nutrients: r.value.nutrients, certainty: r.value.certainty, weight: r.value.amount };
    },
    prep.cookedPerRaw !== undefined ? { cookedPerRaw: prep.cookedPerRaw } : {},
  );

  const per100: NutrientAmounts = {};
  const partial: PrepPortionInfo["partial"] = [];
  for (const key of NUTRIENT_KEYS) {
    const t = result.perPortion[key];
    if (!t) continue;
    per100[key] = t.value;
    if (t.partial) partial.push({ key, missingShare: t.missingShare });
  }
  const byLot = new Map(prep.ingredients.map((i) => [i.lotId, i.productRef]));
  const info: PrepPortionInfo = {
    ref: `${PREP_REF_PREFIX}${prep.prepId}`,
    title: prep.title,
    ingredientCount: prep.ingredients.length,
    unresolved: result.notComputable.map((id) => byLot.get(id) ?? id),
    partial,
    empty: Object.keys(per100).length === 0,
  };
  if (info.empty) return { info };
  return {
    composition: { name: prep.title, ref: info.ref, origin: "derived", basis: "g", per100, unitWeightG: 100 },
    info,
  };
}
