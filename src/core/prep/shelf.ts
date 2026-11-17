// Scadenza e durata delle porzioni, dal motore delle scadenze.

import type { Expiry, Location } from "../ledger";
import { addDays, diffDays, effectiveExpiry, type FoodCategory } from "../expiry";

/** Categorie del motore delle scadenze adatte a una preparazione casalinga. */
export const PREP_CATEGORIES = ["leftovers_cooked", "ready_meals"] as const satisfies readonly FoodCategory[];
export type PrepCategory = (typeof PREP_CATEGORIES)[number];

/** Avanzi cucinati: è la categoria di un piatto cotto in casa. */
export const DEFAULT_PREP_CATEGORY: PrepCategory = "leftovers_cooked";

export interface PortionShelfInput {
  category?: PrepCategory;
  location: Location;
  /** Giorno di cottura, `YYYY-MM-DD`. */
  cookedOn: string;
  /** Durata scelta dall'utente, in giorni interi dalla cottura: prevale sul motore. */
  shelfDays?: number;
}

/** Scadenza stimata delle porzioni (sempre `estimated`). Lancia se la data non è valida. */
export function portionsExpiry(input: PortionShelfInput): Expiry {
  if (input.shelfDays !== undefined) {
    if (!Number.isInteger(input.shelfDays) || input.shelfDays < 0) {
      throw new RangeError("shelfDays must be a non-negative integer");
    }
    return { date: addDays(input.cookedOn, input.shelfDays), kind: "estimated" };
  }
  const eff = effectiveExpiry(
    {
      id: "prep",
      labelDateType: "none",
      purchaseDate: input.cookedOn,
      location: input.location,
      frozenDate: input.location === "freezer" ? input.cookedOn : null,
      category: input.category ?? DEFAULT_PREP_CATEGORY,
    },
    input.cookedOn,
  );
  return { date: eff.date, kind: "estimated" };
}

/** Giorni di durata delle porzioni dal giorno di cottura (0 = da mangiare lo stesso giorno). */
export function portionLifeDays(input: PortionShelfInput): number {
  return diffDays(portionsExpiry(input).date, input.cookedOn);
}
