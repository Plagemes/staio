// Come si dice da dove vengono i valori d'etichetta di un lotto. Logica pura.
import { isLocalProduct, isRestrictedCode } from "@/core/catalog";

/**
 * Il codice si cita solo se è un vero codice a barre. Una scheda creata dal nome (`localFromName`) non ne ha uno; per un
 * codice interno del negozio si avverte che la scheda può non corrispondere. Senza la scheda un 299… vale come codice interno.
 */
export function labelSourceText(barcode?: string, product?: { localFromName?: true }): string {
  if (!barcode) return "Dall'etichetta del prodotto.";
  if (isLocalProduct(product)) return "Valori inseriti da te.";
  if (isRestrictedCode(barcode)) return `Dall'etichetta del prodotto (codice interno del negozio ${barcode}): il prodotto può non corrispondere.`;
  return `Dall'etichetta del prodotto (codice a barre ${barcode}).`;
}
