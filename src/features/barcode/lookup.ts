import { isLocalCode, isRestrictedCode, isStoredProduct, keepLabelValues, type Product } from "@/core/catalog";
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
 * Una scheda salvata prima che si chiedessero ingredienti e tracce non permette il controllo degli allergeni: si prova a
 * rileggerla, e se la rete non risponde si usa quella salvata.
 */
export async function lookupProduct(barcode: string, options: OffClientOptions = {}): Promise<LookupOutcome> {
  let stored: Product | undefined;
  let storeUnreadable = false;
  try {
    const record = await getProductRecord(barcode);
    if (record && isStoredProduct(record.data)) stored = record.data;
  } catch {
    // archivio non disponibile (per esempio finestra privata): si prosegue con la rete, tranne che per i codici locali
    storeUnreadable = true;
  }
  // una scheda creata dal nome (codice locale) esiste solo sul telefono: mai in rete, né per cercarla né per rileggerla.
  // Lo dice la scheda salvata, non il prefisso: un codice 299 letto in negozio è di quel negozio e si tratta come ogni codice interno.
  if (stored?.localFromName) return { status: "found", product: stored, from: "memory" };
  if (stored?.safetyFields) return { status: "found", product: stored, from: "memory" };
  // un codice interno del negozio con una scheda scritta dall'utente: la scheda di Open Food Facts non la sostituisce né la mescola
  if (stored && stored.source !== "openfoodfacts" && isRestrictedCode(barcode)) return { status: "found", product: stored, from: "memory" };

  // senza poter leggere l'archivio non si sa se è un codice ricavato dal nome: con la forma dei locali non va in rete
  if (storeUnreadable && isLocalCode(barcode)) return { status: "not_found" };

  const result = await fetchProduct(barcode, options);
  if (stored && result.status !== "found") return { status: "found", product: stored, from: "memory" };
  if (result.status === "found") {
    // ciò che l'utente ha confermato da una foto dell'etichetta non si perde con una rilettura dal servizio
    const product = keepLabelValues(result.product, stored);
    try {
      await putProductRecord({ barcode: product.barcode, fetchedAt: product.fetchedAt, data: product });
    } catch {
      // non poter ricordare il prodotto non toglie nulla alla scheda
    }
    return { status: "found", product, from: "service" };
  }
  return result;
}
