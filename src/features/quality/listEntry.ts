// Voce della lista della spesa per un prodotto di cui si è letta la scheda. Logica pura.

import type { Product } from "@/core/catalog";
import { isLocalProduct } from "@/core/catalog";
import type { ManualInput } from "../shopping";

/** Nome come lo si scrive in lista: nome e marca; senza nome, il codice. Una confezione. */
export function listEntryFor(product: Product): ManualInput {
  const name = product.name?.trim();
  const brand = product.brand?.trim();
  const label = name ? (brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} ${brand}` : name) : (isLocalProduct(product) ? "Prodotto senza nome" : `Prodotto ${product.barcode}`);
  return { product: label, quantity: { value: 1, unit: "pz" } };
}
