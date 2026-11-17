// Dal lotto del libro mastro alla voce di scadenza. È l'unica mappatura: Oggi, Dispensa, avvisi e
// interrogazioni dell'assistente la usano tutti, così la stessa data non può uscire diversa in due posti.
import { DEFAULT_TIME_ZONE, toCalendarDate } from "./dates";
import { effectiveExpiry } from "./effectiveExpiry";
import { SHELF_LIFE } from "./shelfLife";
import type { EffectiveExpiry, ExpiryItem, FoodCategory, LabelDateType, StorageLocation } from "./types";

/** Ciò che serve di un lotto: `Lot` del libro mastro lo soddisfa, ma qui non lo si importa. */
export interface LotLike {
  lotId: string;
  category?: string;
  expiry?: { date: string; kind: Exclude<LabelDateType, "none"> };
  createdAt: string;
  openedAt?: string;
  location: StorageLocation;
  frozenAt?: string;
  thawedAt?: string;
  /** Durata dopo l'apertura dall'etichetta del prodotto, se il lotto la porta. */
  daysAfterOpening?: number;
}

export function isFoodCategory(value: unknown): value is FoodCategory {
  return typeof value === "string" && Object.hasOwn(SHELF_LIFE, value);
}

/**
 * Voce per il motore delle scadenze, o null se il lotto non ha una categoria nota o ha date non leggibili.
 * Un lotto dichiarato («già in casa») conta come entrato il giorno della dichiarazione:
 * il libro mastro non conosce la vera data d'acquisto.
 */
export function lotToExpiryItem(lot: LotLike, timeZone: string = DEFAULT_TIME_ZONE): ExpiryItem | null {
  if (!isFoodCategory(lot.category)) return null;
  try {
    const day = (instant: string | undefined) => (instant ? toCalendarDate(instant, timeZone) : null);
    return {
      id: lot.lotId,
      labelDateType: lot.expiry ? lot.expiry.kind : "none",
      labelDate: lot.expiry?.date ?? null,
      purchaseDate: toCalendarDate(lot.createdAt, timeZone),
      openedDate: day(lot.openedAt),
      daysAfterOpening: lot.daysAfterOpening ?? null,
      location: lot.location,
      frozenDate: day(lot.frozenAt),
      thawedDate: day(lot.thawedAt),
      category: lot.category,
    };
  } catch {
    return null;
  }
}

/** La sola data in etichetta del lotto, come scadenza; undefined se non ne ha. */
export function labelOnlyExpiry(lot: Pick<LotLike, "expiry">): EffectiveExpiry | undefined {
  if (!lot.expiry) return undefined;
  return {
    date: lot.expiry.date,
    basis: "label",
    nature: lot.expiry.kind === "best_before" ? "quality" : "safety",
    certainty: lot.expiry.kind === "estimated" ? "estimated" : "label",
  };
}

/** Scadenza che conta per un lotto: la stima del motore se la categoria è nota, altrimenti la sola data in etichetta. */
export function lotExpiry(lot: LotLike, now: string | Date, timeZone: string = DEFAULT_TIME_ZONE): EffectiveExpiry | undefined {
  const item = lotToExpiryItem(lot, timeZone);
  if (item) {
    try {
      return effectiveExpiry(item, now);
    } catch {
      // si ripiega sulla data in etichetta
    }
  }
  return labelOnlyExpiry(lot);
}
