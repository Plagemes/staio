export const QUALITY_PATH = "/app/qualita";
export const QUALITY_PRODUCT_PATH = "/app/qualita/prodotto";
export const SHELF_PATH = "/app/qualita/scaffale";
export const KNOWN_PRODUCTS_PATH = "/app/qualita/prodotti";

/** Scheda di qualità di un prodotto, per codice a barre. */
export function qualityHref(barcode: string): string {
  return `${QUALITY_PRODUCT_PATH}?${new URLSearchParams({ codice: barcode }).toString()}`;
}
