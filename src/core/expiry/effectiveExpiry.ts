import { addDays, addMonths, parseDate } from "./dates";
import { SHELF_LIFE, type ShelfLife } from "./shelfLife";
import type { EffectiveExpiry, ExpiryItem } from "./types";

/** Lancia se la voce ha date non valide o una categoria sconosciuta. */
function validate(item: ExpiryItem): ShelfLife {
  const life = SHELF_LIFE[item.category] as ShelfLife | undefined;
  if (!life) throw new Error(`Categoria sconosciuta: ${String(item.category)}`);
  parseDate(item.purchaseDate);
  if (item.labelDateType !== "none" && item.labelDate) parseDate(item.labelDate);
  for (const d of [item.openedDate, item.frozenDate, item.thawedDate]) {
    if (d) parseDate(d);
  }
  return life;
}

/** Giorni dopo l'apertura usabili: interi da 1 a 3650; qualunque altro valore si ignora e vale la stima per categoria. */
export function usableDaysAfterOpening(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650 ? value : undefined;
}

function labelExpiry(item: ExpiryItem): EffectiveExpiry | null {
  if (!item.labelDate || item.labelDateType === "none") return null;
  return {
    date: item.labelDate,
    basis: "label",
    nature: item.labelDateType === "best_before" ? "quality" : "safety",
    certainty: item.labelDateType === "estimated" ? "estimated" : "label",
  };
}

/**
 * Scadenza effettiva di una voce. `now` non serve al calcolo (le regole dipendono solo dalle date
 * della voce) ma resta nella firma per coerenza con le altre funzioni.
 */
export function effectiveExpiry(item: ExpiryItem, now: string | Date): EffectiveExpiry {
  void now;
  const life = validate(item);

  // In freezer vale l'ultimo congelamento, anche se la voce è stata scongelata e ricongelata.
  if (item.location === "freezer") {
    const start = item.frozenDate ?? item.purchaseDate;
    return {
      date: addMonths(start, life.freezerMonths),
      basis: "frozen",
      nature: "quality",
      certainty: "estimated",
    };
  }

  if (item.thawedDate) {
    return {
      date: addDays(item.thawedDate, life.afterThawDays),
      basis: "thawed",
      nature: "safety",
      certainty: "estimated",
    };
  }

  const label = labelExpiry(item);
  const estimated: EffectiveExpiry = {
    date: addDays(item.purchaseDate, item.location === "frigo" ? life.fridgeDays : life.pantryDays),
    basis: "estimated",
    nature: life.perishable || item.location === "frigo" ? "safety" : "quality",
    certainty: "estimated",
  };
  const base = label ?? estimated;

  if (!item.openedDate) return base;

  // Aperta: il limite dopo l'apertura è sempre di sicurezza e non lo sostituisce una data di qualità.
  // Il dato del prodotto (scritto da volontari su Open Food Facts) può solo accorciare la durata della categoria,
  // mai allungarla: conta solo se è più breve, e la certezza resta una stima.
  const productDays = usableDaysAfterOpening(item.daysAfterOpening);
  const shorter = productDays !== undefined && productDays < life.afterOpeningDays;
  const opened: EffectiveExpiry = {
    date: addDays(item.openedDate, shorter ? productDays : life.afterOpeningDays),
    basis: "opened",
    nature: "safety",
    certainty: "estimated",
    ...(shorter ? { openedFrom: "product" as const } : {}),
  };

  const safety = base.nature === "safety" ? [base, opened] : [opened];
  // A parità vince il primo (l'etichetta, più affidabile).
  const winner = safety.reduce((best, c) => (c.date < best.date ? c : best));
  if (base.nature === "quality" && base.date !== winner.date) {
    return { ...winner, qualityDate: base.date };
  }
  return winner;
}
