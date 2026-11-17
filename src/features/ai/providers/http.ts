// Chiamata HTTP dal browser e traduzione degli errori. La chiave passa solo nelle intestazioni e non esce mai da qui:
// ogni testo che arriva dal fornitore è ripulito prima di finire in un errore.
import { AiError, redactSecrets, type AiErrorKind } from "@/core/ai";
import type { CallOptions } from "./types";

export const DEFAULT_TIMEOUT_MS = 120_000;

export interface HttpResult {
  status: number;
  ok: boolean;
  headers: Headers;
  json: unknown;
}

export interface PostArgs {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  options?: CallOptions;
}

export async function postJson({ url, headers, body, options = {} }: PostArgs): Promise<HttpResult> {
  // già annullata prima di partire: non è mai uscito nulla dal telefono
  if (options.signal?.aborted) throw new AiError("aborted");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { status: response.status, ok: response.ok, headers: response.headers, json };
  } catch (error) {
    // la richiesta era partita: il fornitore può averla già addebitata
    if (timedOut) throw new AiError("timeout", { afterSend: true });
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new AiError("aborted", { afterSend: true });
    }
    // un fetch che fallisce non dice perché (rete assente, servizio spento, blocco del browser): non si cita il testo
    throw new AiError("network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Il messaggio che il fornitore dà con l'errore, se c'è. */
export function providerMessage(json: unknown): string | undefined {
  if (!isObj(json)) return undefined;
  const error = json.error;
  if (isObj(error) && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  if (typeof json.message === "string") return json.message;
  return undefined;
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

const BILLING = /credit balance|insufficient[_ ]quota|exceeded your current quota|billing|payment required/i;

/** Errore per una risposta non riuscita. Il dettaglio è sempre ripulito dai `secrets` (la chiave in uso). */
export function errorFromResponse(result: HttpResult, secrets: readonly string[]): AiError {
  const message = providerMessage(result.json) ?? "";
  const detail = message === "" ? undefined : redactSecrets(message, secrets);
  const { status } = result;
  let kind: AiErrorKind;
  if (status === 401) {
    kind = /^CORS requests are not allowed/i.test(message) ? "browser_not_allowed" : "rejected_key";
    // il testo di un 401 può ripetere la chiave: non lo si conserva
    return new AiError(kind, { status });
  }
  if (status === 403) kind = "forbidden";
  else if (status === 402) kind = "billing";
  else if (status === 404) kind = "model_not_found";
  else if (status === 413) kind = "request_too_large";
  else if (status === 429) kind = BILLING.test(message) ? "billing" : "rate_limited";
  else if (status === 529) kind = "overloaded";
  else if (status >= 500) kind = "server";
  else if (status === 400 && BILLING.test(message)) kind = "billing";
  else kind = "bad_request";
  return new AiError(kind, { status, detail, retryAfterSeconds: kind === "rate_limited" ? retryAfter(result.headers) : undefined });
}
