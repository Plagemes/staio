// Regole sui codici nelle schermate di qualità. Un codice è «locale» solo se lo dice la scheda salvata (`localFromName`):
// un 299… senza quella scheda è un codice interno di un negozio, come ogni 20–29, 02 e 04. Su un codice interno la scheda
// (di Open Food Facts o scritta dall'utente) può essere di un altro prodotto: non si valuta e non si confronta. Logica pura.
import { isLocalProduct, isRestrictedCode, type Product } from "@/core/catalog";

export { displayProductCode } from "../barcode/messages";

/** Scheda per un codice interno del negozio, che non vale come certa né entra nei confronti. */
export function isDoubtfulProduct(product: Pick<Product, "barcode" | "localFromName">): boolean {
  return isRestrictedCode(product.barcode) && !isLocalProduct(product);
}

export { isLocalProduct };
