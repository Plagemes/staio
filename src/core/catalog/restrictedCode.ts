// Codici a circolazione ristretta (GS1): i prefissi 02, 04 e da 20 a 29 non identificano un prodotto in tutto il mondo.
// Ogni negozio li assegna ai suoi articoli, spesso a peso variabile (il prezzo o il peso stanno dentro il codice): lo
// stesso numero è un prodotto in un negozio e un altro altrove. Un archivio come Open Food Facts può avere una scheda per
// quel numero, ma non è detto che sia il prodotto che si ha in mano.
import { toGtin13 } from "./barcode";

export function isRestrictedCode(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const gtin = code.length === 8 ? code : toGtin13(code);
  return /^(02|04|2\d)/.test(gtin);
}

/** Prefisso dei codici locali che l'app ricava dal nome di un alimento senza codice a barre: mai cercati in rete. */
export const LOCAL_CODE_PREFIX = "299";

/**
 * Solo la FORMA di un codice locale (13 cifre, prefisso 299): serve a generarli. Non prova che un codice lo sia, perché un
 * negozio può assegnare a un suo articolo un codice uguale. Per saperlo davvero: `isLocalProduct`, sulla scheda salvata.
 */
export function isLocalCode(code: string): boolean {
  return /^\d{13}$/.test(code) && code.startsWith(LOCAL_CODE_PREFIX);
}

/** La scheda è stata creata dal nome di un alimento senza codice a barre: il suo codice è locale. */
export function isLocalProduct(product: { localFromName?: true } | undefined): boolean {
  return product?.localFromName === true;
}

/**
 * Codice interno di un negozio con una scheda scritta dall'utente: ogni negozio lo assegna a prodotti suoi, quindi la scheda
 * dell'ultima volta va confermata a ogni lettura («è ancora questo prodotto?»). Le schede create dal nome non sono di un negozio.
 */
export function needsStoreCodeConfirmation(product: { barcode: string; source: string; localFromName?: true }): boolean {
  return isRestrictedCode(product.barcode) && product.source !== "openfoodfacts" && product.localFromName !== true;
}
