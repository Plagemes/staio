// Fabbisogni di una settimana di piano: cosa serve e quando. È l'ingresso della lista della spesa
// (che toglie ciò che c'è già in dispensa).

import type { Quantity } from "../ledger";
import type { MealKind } from "../diary";
import { batchPrepUses, coverPrepUses, type ExistingPortions, type PrepCoverage } from "./batching";
import type { PlanWeekState } from "./derive";
import { foodKey, roundQty, type ExpandRef, type ExpandedIngredient } from "./refs";

export interface NeedSource {
  /** Data del pasto pianificato. */
  mealDate: string;
  meal: MealKind;
  kind: "food" | "recipe" | "prep";
  /** Identificativo della ricetta o della preparazione. */
  refId?: string;
}

export interface NeedLine {
  /** Nome del prodotto, come scritto nel piano o nella ricetta. */
  product: string;
  foodId?: string;
  /** Somma delle quantità con la stessa unità, per lo stesso prodotto e la stessa data. */
  quantity: Quantity;
  /**
   * Data entro cui serve. Per un alimento o una ricetta è il giorno del pasto; per una
   * preparazione è il giorno in cui va cucinata (vedi `prepDateBasis`).
   */
  date: string;
  sources: NeedSource[];
}

export interface UnresolvedNeed {
  date: string;
  meal: MealKind;
  kind: "recipe" | "prep";
  refId: string;
  servings: number;
}

export interface NeedsOptions {
  /** Espande ricette e preparazioni negli ingredienti. Senza, restano tutte non risolte. */
  expand?: ExpandRef;
  /**
   * Durata delle porzioni di una preparazione, in giorni. Con essa gli ingredienti si datano al
   * giorno di cottura di ogni lotto; senza, un solo lotto per preparazione, cotto il primo giorno
   * in cui serve.
   */
  portionLifeDays?: (prepId: string) => number | undefined;
  /**
   * Porzioni già pronte (lotti di porzioni con le porzioni rimaste e l'ultimo giorno buono, vedi
   * `existingPortionsOf` in `core/prep`). Si usano prima, solo nei giorni in cui sono ancora buone;
   * gli ingredienti si chiedono solo per le porzioni mancanti.
   */
  existingPortions?: readonly ExistingPortions[];
}

export interface NeedsResult {
  weekStart: string;
  /** In ordine di data, nome e unità. */
  lines: NeedLine[];
  /** Ricette e preparazioni che `expand` non ha saputo espandere: i loro ingredienti mancano. */
  unresolved: UnresolvedNeed[];
  /** Per ogni preparazione del piano: porzioni richieste, coperte da quelle già pronte e da cucinare. */
  coveredPortions: PrepCoverage[];
}

export function computeNeeds(
  week: PlanWeekState | undefined,
  options: NeedsOptions = {},
): NeedsResult {
  const result: NeedsResult = { weekStart: week?.weekStart ?? "", lines: [], unresolved: [], coveredPortions: [] };
  if (!week) return result;
  const groups = new Map<string, NeedLine>();
  const add = (ing: ExpandedIngredient, date: string, source: NeedSource): void => {
    const key = [date, foodKey(ing), ing.quantity.unit].join("\u0000");
    const cur = groups.get(key);
    if (cur) {
      cur.quantity = { unit: cur.quantity.unit, value: roundQty(cur.quantity.value + ing.quantity.value) };
      cur.sources.push(source);
      return;
    }
    groups.set(key, {
      product: ing.name,
      ...(ing.foodId !== undefined ? { foodId: ing.foodId } : {}),
      quantity: { value: roundQty(ing.quantity.value), unit: ing.quantity.unit },
      date,
      sources: [source],
    });
  };

  for (const entry of week.entries) {
    const item = entry.item;
    const base = { mealDate: entry.date, meal: entry.meal };
    if (item.kind === "food") {
      add(
        { name: item.name, ...(item.foodId !== undefined ? { foodId: item.foodId } : {}), quantity: item.quantity },
        entry.date,
        { ...base, kind: "food" },
      );
    } else if (item.kind === "recipe") {
      const ingredients = options.expand?.({ kind: "recipe", id: item.recipeId }, item.servings);
      if (!ingredients) {
        result.unresolved.push({
          date: entry.date,
          meal: entry.meal,
          kind: "recipe",
          refId: item.recipeId,
          servings: item.servings,
        });
        continue;
      }
      for (const ing of ingredients) {
        add(ing, entry.date, { ...base, kind: "recipe", refId: item.recipeId });
      }
    }
  }

  result.coveredPortions = coverPrepUses(week, options.existingPortions);
  for (const batch of batchPrepUses(week, options.portionLifeDays, options.existingPortions)) {
    const ingredients = options.expand?.({ kind: "prep", id: batch.prepId }, batch.servings);
    if (!ingredients) {
      for (const use of batch.uses) {
        result.unresolved.push({
          date: use.date,
          meal: use.meal,
          kind: "prep",
          refId: batch.prepId,
          servings: use.servings,
        });
      }
      continue;
    }
    const first = batch.uses[0];
    for (const ing of ingredients) {
      add(ing, batch.cookBy, {
        mealDate: first.date,
        meal: first.meal,
        kind: "prep",
        refId: batch.prepId,
      });
    }
  }

  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  result.lines = [...groups.values()].sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      cmp(a.product.toLowerCase(), b.product.toLowerCase()) ||
      cmp(a.quantity.unit, b.quantity.unit),
  );
  for (const line of result.lines) {
    line.sources.sort(
      (a, b) => cmp(a.mealDate, b.mealDate) || cmp(a.meal, b.meal) || cmp(a.refId ?? "", b.refId ?? ""),
    );
  }
  result.unresolved.sort(
    (a, b) => cmp(a.date, b.date) || cmp(a.meal, b.meal) || cmp(a.refId, b.refId),
  );
  return result;
}
