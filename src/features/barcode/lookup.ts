import { isStoredProduct, type Product } from "@/core/catalog";
import { getProductRecord, putProductRecord } from "@/data";
import { fetchProduct, type LookupFailure, type OffClientOptions } from "./offClient";

export type LookupOutcome =
  /** `from` dice se la scheda viene dalla memoria del telefono o dal servizio. */
  | { status: "found"; product: Product; from: "memory" | "service" }
  | { status: "not_found" }
  | { status: "failed"; reason: LookupFailure };

/**
 * Prima la memoria del telefono, così un prodotto già letto si ritrova senza rete;
 * poi Open Food Facts. Un prodotto trovato viene ricordato; un "non trovato" no, perché potrebbe comparire dopo.
 */
export async function lookupProduct(barcode: string, options: OffClientOptions = {}): Promise<LookupOutcome> {
  try {
    const record = await getProductRecord(barcode);
    if (record && isStoredProduct(record.data)) return { status: "found", product: record.data, from: "memory" };
  } catch {
    // archivio non disponibile (per esempio finestra privata): si prosegue con la rete
  }

  const result = await fetchProduct(barcode, options);
  if (result.status === "found") {
    try {
      await putProductRecord({ barcode: result.product.barcode, fetchedAt: result.product.fetchedAt, data: result.product });
    } catch {
      // non poter ricordare il prodotto non toglie nulla alla scheda
    }
    return { status: "found", product: result.product, from: "service" };
  }
  return result;
}
