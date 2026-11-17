// Aggiunta diretta dalla scheda del prodotto: dal prodotto letto al modulo di cattura, senza passare dal modulo.
import { expiryCategoryMatch, quantityText, type Product } from "@/core/catalog";
import { effectiveExpiry, type FoodCategory } from "@/core/expiry";
import type { LedgerEvent, Location } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { cleanName, readQuantity, type CaptureInput } from "../capture";
import { formatCalendarDate } from "../format";
import { LOCATION_LABELS, type ChosenExpiryKind } from "../labels";
import { defaultLocation } from "../quickAdd";

/** Dati del prodotto già pronti per il registro; ciò che manca resta `undefined`. */
export interface ProductDraft {
  name?: string;
  quantityText?: string;
  category?: FoodCategory;
  barcode: string;
  brand?: string;
}

export type MissingField = "name" | "quantity" | "category";

/** Ordine in cui si chiedono i dati mancanti sulla scheda. */
const MISSING_ORDER: readonly MissingField[] = ["name", "quantity", "category"];

export function draftFromProduct(product: Product): ProductDraft {
  const name = cleanName(product.name ?? "");
  // prima il valore già in unità base, poi il testo dell'etichetta; se nessuno dei due si legge, la quantità si chiede
  const text = [quantityText(product.quantity), product.quantity?.text].find((t) => t !== undefined && readQuantity(t).ok);
  const match = expiryCategoryMatch(product);
  return {
    barcode: product.barcode,
    ...(name !== "" ? { name } : {}),
    // la quantità vale solo se il registro la sa leggere: non se ne inventa una
    ...(text ? { quantityText: text } : {}),
    ...(match.matched ? { category: match.category } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
  };
}

export function missingFields(draft: ProductDraft): MissingField[] {
  const missing = new Set<MissingField>();
  if (!draft.name) missing.add("name");
  if (!draft.quantityText) missing.add("quantity");
  if (!draft.category) missing.add("category");
  return MISSING_ORDER.filter((f) => missing.has(f));
}

export interface DirectAnswers {
  name?: string;
  quantityText?: string;
  category?: string;
  expiryKind?: ChosenExpiryKind | "none";
  expiryDate?: string;
  priceText?: string;
}

/** Il dato scritto sulla scheda vale più di quello del prodotto, ma solo se non è vuoto. */
export function inputFromDraft(draft: ProductDraft, location: Location, answers: DirectAnswers = {}): CaptureInput {
  return {
    name: answers.name?.trim() || draft.name || "",
    quantityText: answers.quantityText?.trim() || draft.quantityText || "",
    location,
    category: answers.category || draft.category || "",
    expiryKind: answers.expiryKind ?? "none",
    expiryDate: answers.expiryKind && answers.expiryKind !== "none" ? (answers.expiryDate ?? "") : "",
    priceText: answers.priceText ?? "",
    alreadyHave: false,
    barcode: draft.barcode,
    brand: draft.brand,
  };
}

/** Luogo proposto per la categoria; senza categoria il frigo, che è la scelta più prudente. */
export function locationFor(category: string | undefined): Location {
  return category ? defaultLocation(category as FoodCategory) : "frigo";
}

/** Scadenza stimata dalla categoria e dal luogo, per il giorno `today` (`YYYY-MM-DD`); null se la categoria manca. */
export function estimatedExpiryDate(category: string | undefined, location: Location, today: string): string | null {
  if (!category) return null;
  try {
    return effectiveExpiry({ id: "estimate", labelDateType: "none", purchaseDate: today, location, category: category as FoodCategory }, today).date;
  } catch {
    return null;
  }
}

export function estimatedExpiryText(category: string | undefined, location: Location, today: string): string {
  const date = estimatedExpiryDate(category, location, today);
  return date ? `Scadenza stimata: ${formatCalendarDate(date)}.` : "Senza data, la scadenza sarà una stima dalla categoria.";
}

/** «Aggiunto alla dispensa: Farfalle, 500 g, in credenza. Scadenza stimata: 10 nov 2028.» */
export function confirmationText(event: LedgerEvent, today: string): string {
  if (event.type !== "purchase" && event.type !== "declare") return "Aggiunto alla dispensa.";
  const place = LOCATION_LABELS[event.location].toLowerCase();
  const head = `Aggiunto alla dispensa: ${event.productRef}, ${formatQuantity(event.quantity)}, in ${place}.`;
  if (event.expiry) return `${head} Scadenza: ${formatCalendarDate(event.expiry.date)}.`;
  return `${head} ${estimatedExpiryText(event.category, event.location, today)}`;
}
