// Quali voci della spesa in corso portano il segno «qualità: vedi»: solo quelle con un codice a barre, un prodotto già
// in cache e almeno un punto a sfavore. Le altre restano com'erano, così la lista non diventa rumorosa. Logica pura.
import type { Product } from "@/core/catalog";
import { qualityGlance } from "../quality/glance";

/** Voce della spesa → codice a barre, per le sole voci da segnalare. Senza prodotti in cache non ce ne sono. */
export function qualityFlags(items: ReadonlyArray<{ id: string; barcode?: string }>, products: ReadonlyMap<string, Product> | undefined): Map<string, string> {
  const flags = new Map<string, string>();
  if (!products) return flags;
  for (const { id, barcode } of items) {
    if (!barcode) continue;
    const product = products.get(barcode);
    if (!product) continue;
    if (qualityGlance(product)?.chips.some((c) => c.outcome === "unfavorable")) flags.set(id, barcode);
  }
  return flags;
}
