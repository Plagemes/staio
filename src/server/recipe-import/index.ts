// Importazione di una ricetta da un indirizzo web. Codice solo server: non importarlo dal browser.
import { createFetch, createImportHandler } from "./handler";
import { createRateLimiter } from "./rate-limit";
import { httpsTransport, systemResolver } from "./transport";

export { fetchPage, DEFAULT_LIMITS, OUTGOING_HEADERS } from "./fetch-page";
export type { FetchDeps, FetchErrorCode, FetchLimits, FetchResult, Resolver, Transport } from "./fetch-page";
export { checkUrl } from "./url";
export { isPublicAddress } from "./ip";
export { createRateLimiter } from "./rate-limit";
export { callerKey, createImportHandler, errorResponse, parseOrigins, MAX_BODY_BYTES } from "./handler";
export type { ApiErrorCode, ImportHandlerDeps } from "./handler";
export { createHttpsTransport, httpsTransport, systemResolver } from "./transport";

/**
 * Gestore predefinito della rotta. I limiti stanno nella memoria dell'istanza: su un servizio senza
 * stato sono solo una prima difesa (ogni istanza ha i suoi contatori e si azzerano a ogni avvio).
 */
export const handleImportRequest = createImportHandler({
  fetch: createFetch({ resolve: systemResolver, transport: httpsTransport }),
  perCaller: createRateLimiter({ limit: 10, windowMs: 60_000 }),
  global: createRateLimiter({ limit: 120, windowMs: 60_000 }),
  maxConcurrent: 6,
});
