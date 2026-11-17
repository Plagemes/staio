import { OFF_FIELDS, productFromOpenFoodFacts, toGtin13, validateBarcode, type Product } from "@/core/catalog";

const ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";

export const DEFAULT_TIMEOUT_MS = 8000;

export type LookupFailure =
  /** Il dispositivo dichiara di non avere rete. */
  | "offline"
  /** La richiesta non è arrivata: rete assente, instabile o bloccata. */
  | "network"
  | "timeout"
  /** Il servizio ha risposto con un errore o con dati illeggibili. */
  | "service"
  | "invalid_code"
  /** La richiesta è stata annullata da chi l'aveva avviata. */
  | "aborted";

export type OffResult = { status: "found"; product: Product } | { status: "not_found" } | { status: "failed"; reason: LookupFailure };

export interface OffClientOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Sostituibile nei test. */
  fetchImpl?: typeof fetch;
  /** Istante della lettura, ISO 8601 UTC; di norma l'ora attuale. */
  now?: () => string;
}

export function productUrl(code: string): string {
  const query = new URLSearchParams({ fields: OFF_FIELDS.join(",") });
  // Per un UPC-A Open Food Facts conserva la forma a 13 cifre con lo zero davanti.
  return `${ENDPOINT}/${toGtin13(code)}.json?${query.toString()}`;
}

const failed = (reason: LookupFailure): OffResult => ({ status: "failed", reason });

/**
 * Cerca un prodotto su Open Food Facts. Non lancia mai: ogni esito è un valore.
 * Il codice viaggia verso il servizio: nessun altro dato dell'utente.
 */
export async function fetchProduct(barcode: string, options: OffClientOptions = {}): Promise<OffResult> {
  const check = validateBarcode(barcode);
  if (!check.ok) return failed("invalid_code");
  if (options.signal?.aborted) return failed("aborted");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return failed("offline");

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await doFetch(productUrl(check.code), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Una 404 senza corpo leggibile vale comunque "non trovato".
      return response.status === 404 ? { status: "not_found" } : failed("service");
    }

    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return failed("service");

    const now = options.now ?? (() => new Date().toISOString());
    const product = productFromOpenFoodFacts(body, { barcode: check.code, fetchedAt: now() });
    if (!product) return { status: "not_found" };
    // Il codice richiesto resta la chiave: un UPC-A torna a 13 cifre dall'API.
    return { status: "found", product: { ...product, barcode: check.code } };
  } catch {
    if (timedOut) return failed("timeout");
    if (options.signal?.aborted) return failed("aborted");
    return failed("network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
