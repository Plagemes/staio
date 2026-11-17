import { usableDaysAfterOpening } from "@/core/expiry";
import { expiryCategoryMatch, quantityText, type Product } from "@/core/catalog";

export const CAPTURE_PATH = "/app/cattura";

/** Indirizzo del modulo di cattura precompilato. Solo i dati presenti: niente parametri vuoti. */
export function captureHref(product: Product): string {
  const params = new URLSearchParams();
  if (product.name) params.set("nome", product.name);
  const quantity = quantityText(product.quantity);
  if (quantity) params.set("quantita", quantity);
  // La categoria passa solo se riconosciuta: il ripiego prudente non deve sostituire la proposta dal nome.
  const match = expiryCategoryMatch(product);
  if (match.matched) params.set("categoria", match.category);
  // il codice locale non è un codice a barre: il modulo lo ricava di nuovo dal nome
  if (!product.localFromName) params.set("barcode", product.barcode);
  if (product.brand) params.set("marca", product.brand);
  if (usableDaysAfterOpening(product.daysAfterOpening) !== undefined) params.set("apertura", String(product.daysAfterOpening));
  return `${CAPTURE_PATH}?${params.toString()}`;
}

/** Prodotto non trovato: solo il codice, il resto si scrive a mano. */
export function captureHrefForCode(barcode: string): string {
  return `${CAPTURE_PATH}?${new URLSearchParams({ barcode }).toString()}`;
}
