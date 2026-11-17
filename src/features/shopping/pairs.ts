// Ingredienti che completano un alimento in scadenza: da una ricetta che lo usa e a cui mancano altri ingredienti.
import { diffDays } from "@/core/expiry";
import type { Lot } from "@/core/ledger";
import { compareWithPantry, rankByExpiring, stockFromLots, type Recipe } from "@/core/recipes";
import type { ExpiringPair } from "@/core/shopping";
import { normalize } from "@/core/units";

export interface PairOptions {
  /** Alimenti che scadono entro tanti giorni. Default 3. */
  withinDays?: number;
  /** Ricette considerate per ciascun alimento in scadenza. Default 1. */
  recipesPerFood?: number;
}

export function expiringPairs(recipes: readonly Recipe[], lots: readonly Lot[], today: string, options: PairOptions = {}): ExpiringPair[] {
  const within = options.withinDays ?? 3;
  const perFood = options.recipesPerFood ?? 1;
  const active = lots.filter((l) => l.status === "active" && l.remaining > 0 && l.expiry !== undefined);
  const expiring = active
    .map((l) => ({ lot: l, daysLeft: diffDays((l.expiry as { date: string }).date, today) }))
    .filter((x) => x.daysLeft >= 0 && x.daysLeft <= within);
  if (expiring.length === 0 || recipes.length === 0) return [];

  const stock = stockFromLots(lots);
  const out = new Map<string, ExpiringPair>();
  for (const { lot, daysLeft } of expiring.sort((a, b) => a.daysLeft - b.daysLeft)) {
    const ranked = rankByExpiring(recipes, [{ name: lot.productRef, daysLeft }])
      .filter((r) => r.score > 0)
      .slice(0, perFood);
    for (const { recipe } of ranked) {
      const cmp = compareWithPantry(recipe, stock);
      if (!cmp.ok) continue;
      for (const s of cmp.value.shortfalls) {
        if (!s.quantity) continue;
        const base = normalize(s.quantity);
        if (!base.ok) continue;
        const key = s.name.trim().toLowerCase();
        if (!out.has(key)) {
          out.set(key, {
            ingredient: s.name,
            forProduct: lot.productRef,
            expiresOn: (lot.expiry as { date: string }).date,
            quantity: base.value,
          });
        }
      }
    }
  }
  return [...out.values()];
}
