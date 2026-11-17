// Riepiloghi in una riga delle sezioni richiuse della scheda del codice a barre.
import type { Product } from "@/core/catalog";
import type { FoodCategory } from "@/core/expiry";
import type { Quantity } from "@/core/ledger";
import { compositionFromProduct } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { formatPrice, parsePriceCents } from "../format";
import { EXPIRY_KIND_LABELS, FOOD_CATEGORY_LABELS, type ChosenExpiryKind } from "../labels";
import { pluralIt } from "../pieces";
import { allergenLabel } from "./messages";

export interface DetailsSummaryInput {
  category?: string;
  /** La categoria è già un campo in vista sopra: il riepilogo non la ripete. */
  categoryInView?: boolean;
  expiryKind: ChosenExpiryKind;
  pieces?: { count: number; each: number; name?: string };
  /** Unità della confezione, per dire quanto pesa un pezzo. */
  unit?: Quantity["unit"];
  priceText?: string;
}

/** «Yogurt · da consumare entro · senza pezzi · senza prezzo» */
export function detailsSummary(input: DetailsSummaryInput): string {
  const parts: string[] = [];
  if (!input.categoryInView) {
    const category = input.category?.trim();
    parts.push(category ? (FOOD_CATEGORY_LABELS[category as FoodCategory] ?? category) : "senza categoria");
  }
  parts.push(EXPIRY_KIND_LABELS[input.expiryKind].toLowerCase());
  parts.push(piecesText(input.pieces, input.unit));
  parts.push(priceText(input.priceText));
  return parts.join(" · ");
}

function piecesText(pieces: DetailsSummaryInput["pieces"], unit: Quantity["unit"] | undefined): string {
  if (!pieces || pieces.count < 2) return "senza pezzi";
  const name = pieces.name ?? "pezzo";
  const noun = name === "pezzo" ? "pezzi" : pluralIt(name);
  return unit ? `${pieces.count} ${noun} da ${formatQuantity({ value: pieces.each, unit })}` : `${pieces.count} ${noun}`;
}

function priceText(text: string | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return "senza prezzo";
  const price = parsePriceCents(trimmed);
  return price.ok ? formatPrice(price.cents) : "prezzo da correggere";
}

/**
 * Allergeni e tracce dichiarati dalla scheda, in una riga sempre in vista: «Contiene: latte, soia · Tracce: frutta a guscio».
 * Se la scheda non li indica lo dice, perché vuoto non vuol dire «senza».
 */
export function declaredAllergensLine(product: Pick<Product, "allergens" | "traces">): string {
  const traces = product.traces && product.traces.length > 0 ? `Tracce: ${product.traces.map(allergenLabel).join(", ")}` : null;
  if (!product.allergens) {
    return traces ? `Allergeni non indicati · ${traces}` : "Allergeni non indicati: controlla sulla confezione.";
  }
  const contains = product.allergens.length > 0 ? `Contiene: ${product.allergens.map(allergenLabel).join(", ")}` : "Contiene: nessun allergene dichiarato";
  return traces ? `${contains} · ${traces}` : contains;
}

/** Per le schede scritte dall'utente: l'invito a controllare la confezione, sempre in vista. Null per Open Food Facts. */
export function checkPackLine(source: Product["source"]): string | null {
  if (source === "manual") return "Non è su Open Food Facts: i dati li hai scritti tu. Controlla sulla confezione.";
  if (source === "label_photo")
    return "Non è su Open Food Facts: i dati li hai letti tu dalla foto dell'etichetta, con l'intelligenza artificiale, e li hai confermati. Controlla sulla confezione.";
  return null;
}

/** Dopo un'aggiunta il lettore riparte: lo stesso codice, ancora inquadrato, si ignora per qualche secondo. */
export const RESCAN_PAUSE_MS = 3000;

export interface RecentAdd {
  code: string;
  /** Millisecondi (Date.now()) dell'aggiunta. */
  at: number;
}

export function ignoresRescan(recent: RecentAdd | null, code: string, now: number): boolean {
  return recent !== null && recent.code === code && now >= recent.at && now - recent.at < RESCAN_PAUSE_MS;
}

/** «76 kcal per 100 g · da etichetta», oppure «valori mancanti». La fonte segue quella della tabella mostrata. */
export function valuesSummary(product: Product): string {
  const composition = compositionFromProduct(product);
  if (!composition) return "valori mancanti";
  const source = product.labelPhoto?.nutrients
    ? product.labelPhoto.by === "manual"
      ? "inseriti da te"
      : "letti dalla foto"
    : "da etichetta";
  const kcal = composition.per100.energyKcal;
  const head =
    kcal !== undefined
      ? `${Math.round(kcal).toLocaleString("it-IT")} kcal per 100 ${composition.basis}`
      : `valori per 100 ${composition.basis}`;
  return `${head} · ${source}`;
}
