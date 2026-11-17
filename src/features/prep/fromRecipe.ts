// Da una ricetta ai lotti della dispensa da consumare: per ogni ingrediente si propongono i lotti che
// corrispondono, nell'ordine «da mangiare prima», con la quantità per le porzioni scelte. Logica pura.
import type { Lot } from "@/core/ledger";
import { bestMatches, scaleRecipe, type Quantity, type RecipeIngredient, type Scalable } from "@/core/recipes";
import { convert, formatQuantity, type ConversionContext } from "@/core/units";

export interface ProposedPick {
  lotId: string;
  ingredientIndex: number;
  ingredientName: string;
  /** Nell'unità del lotto. */
  quantity: { value: number; unit: Lot["unit"] };
}

export type UnmatchedReason =
  /** Nessun lotto con questo nome. */
  | "no_stock"
  /** C'è, ma l'unità non si converte (pezzi contro grammi senza peso del pezzo). */
  | "unit"
  /** Ce n'è meno del necessario. */
  | "short"
  /** L'ingrediente non ha una quantità («q.b.»): non si scala niente. */
  | "no_quantity";

export interface Unmatched {
  index: number;
  name: string;
  reason: UnmatchedReason;
  /** Per `short`: quanto manca, nell'unità dell'ingrediente. */
  shortfall?: { value: number; unit: string };
}

export interface RecipeProposal {
  picks: ProposedPick[];
  unmatched: Unmatched[];
}

const EPS = 1e-9;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface ProposeOptions {
  servings?: number;
  /** Densità e peso del pezzo di un ingrediente, per le unità diverse. */
  contextFor?: (ingredient: RecipeIngredient, index: number) => ConversionContext;
}

/**
 * Propone cosa prendere dalla dispensa per cucinare la ricetta. `lots` è già nell'ordine in cui conviene usarli
 * (prima ciò che scade). Un lotto non si propone oltre ciò che resta, nemmeno se serve a più ingredienti.
 */
export function proposeFromRecipe(recipe: Scalable, lots: readonly Lot[], options: ProposeOptions = {}): RecipeProposal {
  const servings = options.servings ?? recipe.servings;
  const scaled = scaleRecipe(recipe, servings, { round: false });
  if (!scaled.ok) return { picks: [], unmatched: recipe.ingredients.map((i, index) => ({ index, name: i.name, reason: "no_stock" as const })) };

  const left = new Map(lots.filter((l) => l.status === "active" && l.remaining > 0).map((l) => [l.lotId, l.remaining]));
  const usable = lots.filter((l) => left.has(l.lotId));
  const picks: ProposedPick[] = [];
  const unmatched: Unmatched[] = [];

  scaled.value.ingredients.forEach((ing, index) => {
    const needed = ing.quantity;
    const candidates = bestMatches({ name: ing.name, ...(ing.foodId ? { foodId: ing.foodId } : {}) }, usable, (l) => ({
      name: l.productRef,
      ...(/^[a-z0-9-]+$/.test(l.productRef) ? { foodId: l.productRef } : {}),
    }));
    if (candidates.length === 0) {
      unmatched.push({ index, name: ing.name, reason: needed ? "no_stock" : "no_quantity" });
      return;
    }
    if (!needed) {
      unmatched.push({ index, name: ing.name, reason: "no_quantity" });
      return;
    }
    const ctx = options.contextFor?.(ing, index) ?? {};
    // quantità ancora da coprire, nell'unità dell'ingrediente
    let need = needed.value;
    let convertible = 0;
    for (const lot of candidates) {
      if (need <= EPS) break;
      const available = left.get(lot.lotId) ?? 0;
      // quanto vale una unità del lotto nell'unità dell'ingrediente
      const perLotUnit = convert({ value: 1, unit: lot.unit }, needed.unit, ctx);
      if (!perLotUnit.ok || !(perLotUnit.value.value > 0)) continue;
      convertible++;
      const inIngredientUnit = available * perLotUnit.value.value;
      const takeIng = Math.min(inIngredientUnit, need);
      const takeLot = takeIng >= inIngredientUnit - EPS ? available : round3(takeIng / perLotUnit.value.value);
      if (takeLot <= EPS) continue;
      left.set(lot.lotId, Math.max(0, round3(available - takeLot)));
      need = round3(need - takeIng);
      picks.push({ lotId: lot.lotId, ingredientIndex: index, ingredientName: ing.name, quantity: { value: takeLot, unit: lot.unit } });
    }
    if (convertible === 0) unmatched.push({ index, name: ing.name, reason: "unit" });
    else if (need > EPS) unmatched.push({ index, name: ing.name, reason: "short", shortfall: { value: need, unit: needed.unit } });
  });
  return { picks, unmatched };
}

/** Una riga per lotto, con le quantità di più ingredienti sommate: è ciò che si mostra e si consuma. */
export function picksFromProposal(proposal: RecipeProposal): { lotId: string; quantityText: string }[] {
  const sums = new Map<string, { value: number; unit: Lot["unit"] }>();
  for (const p of proposal.picks) {
    const cur = sums.get(p.lotId);
    sums.set(p.lotId, { value: round3((cur?.value ?? 0) + p.quantity.value), unit: p.quantity.unit });
  }
  return [...sums.entries()].map(([lotId, q]) => ({ lotId, quantityText: formatQuantity(q) }));
}

/** Perché un ingrediente non è tra le proposte, in una frase. */
export function unmatchedText(u: Unmatched): string {
  const name = u.name.toLowerCase();
  switch (u.reason) {
    case "no_stock":
      return `${name}: non è in dispensa`;
    case "unit":
      return `${name}: in dispensa c'è, ma non so convertire l'unità: scegli tu la quantità`;
    case "short":
      return `${name}: ne hai meno del necessario${u.shortfall ? ` (mancano ${formatQuantity(u.shortfall as { value: number; unit: Quantity["unit"] })})` : ""}`;
    case "no_quantity":
      return `${name}: senza quantità, aggiungilo tu se serve`;
  }
}
