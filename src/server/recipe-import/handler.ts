// Gestione della richiesta `POST /api/ricetta`. Codice solo server.
// Non salva nulla e non registra gli indirizzi richiesti (nessun log). Le risposte d'errore hanno
// un codice e un messaggio fissi: mai nomi interni, indirizzi risolti o messaggi di sistema.

import { isIP } from "node:net";
import { extractRecipeFromHtml } from "@/core/recipes";
import { fetchPage, type FetchDeps, type FetchErrorCode, type FetchLimits, type FetchResult } from "./fetch-page";
import type { RateLimiter } from "./rate-limit";

export type ApiErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "payload_too_large"
  | "forbidden_origin"
  | "rate_limited"
  | "busy"
  | "invalid_url"
  | "not_https"
  | "address_not_allowed"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "not_html"
  | "upstream_error"
  | "too_many_redirects"
  | "internal";

const ERRORS: Readonly<Record<ApiErrorCode, { status: number; message: string }>> = {
  invalid_request: { status: 400, message: "Richiesta non valida." },
  unsupported_media_type: { status: 415, message: "Il contenuto deve essere JSON." },
  payload_too_large: { status: 413, message: "Richiesta troppo grande." },
  forbidden_origin: { status: 403, message: "Richiesta non consentita da questa origine." },
  rate_limited: { status: 429, message: "Troppe richieste: riprova tra poco." },
  busy: { status: 503, message: "Il servizio è occupato: riprova tra poco." },
  invalid_url: { status: 400, message: "L'indirizzo non è valido." },
  not_https: { status: 400, message: "Sono ammessi solo indirizzi che iniziano con https." },
  address_not_allowed: { status: 400, message: "Questo indirizzo non è ammesso." },
  unreachable: { status: 502, message: "Non riesco a raggiungere il sito." },
  timeout: { status: 504, message: "Il sito ha impiegato troppo tempo a rispondere." },
  too_large: { status: 422, message: "La pagina è troppo grande." },
  not_html: { status: 422, message: "L'indirizzo non punta a una pagina web." },
  upstream_error: { status: 502, message: "Il sito ha risposto con un errore." },
  too_many_redirects: { status: 502, message: "Il sito rimanda ad altri indirizzi troppe volte." },
  internal: { status: 500, message: "Errore interno." },
};

const FETCH_TO_API: Readonly<Record<FetchErrorCode, ApiErrorCode>> = {
  invalid_url: "invalid_url",
  not_https: "not_https",
  credentials: "address_not_allowed",
  bad_port: "address_not_allowed",
  blocked_host: "address_not_allowed",
  blocked_address: "address_not_allowed",
  bad_redirect: "too_many_redirects",
  too_many_redirects: "too_many_redirects",
  dns_failed: "unreachable",
  network: "unreachable",
  unsupported_encoding: "unreachable",
  upstream_status: "upstream_error",
  not_html: "not_html",
  too_large: "too_large",
  timeout: "timeout",
};

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-type": "application/json; charset=utf-8",
} as const;

export function errorResponse(code: ApiErrorCode, extraHeaders: Record<string, string> = {}): Response {
  const { status, message } = ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export const MAX_BODY_BYTES = 4096;

export interface ImportHandlerDeps {
  fetch: (url: string) => Promise<FetchResult>;
  /** Limite per chiamante. */
  perCaller: RateLimiter;
  /** Limite complessivo dell'istanza, contro chi cambia indirizzo a ogni richiesta. */
  global?: RateLimiter;
  /** Scarichi contemporanei ammessi per istanza. */
  maxConcurrent?: number;
  /** Altre origini ammesse oltre a quella dell'app. Predefinito: `RECIPE_IMPORT_ALLOWED_ORIGINS`. */
  allowedOrigins?: readonly string[];
}

/**
 * Chiave del chiamante per il limite di richieste.
 *
 * Su Vercel (variabile `VERCEL` presente) si usa SOLO `x-vercel-forwarded-for`: la documentazione
 * della piattaforma (https://vercel.com/docs/headers/request-headers) dice che Vercel sovrascrive
 * `x-forwarded-for` e non inoltra gli indirizzi forniti dal cliente, e che `x-vercel-forwarded-for`
 * è identico ma resta affidabile anche con un proxy davanti a Vercel. Fuori da Vercel non c'è una
 * fonte certa: si usa la voce PIÙ A DESTRA di `x-forwarded-for` (aggiunta dall'ultimo proxy; le voci
 * a sinistra le sceglie il cliente) e mai `x-real-ip`. Senza un indirizzo valido la chiave è
 * "unknown": quei chiamanti condividono lo stesso contatore.
 */
export function callerKey(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string {
  const candidate = env.VERCEL
    ? (headers.get("x-vercel-forwarded-for") ?? "").split(",")[0]
    : (headers.get("x-forwarded-for") ?? "").split(",").pop();
  const v = candidate?.trim();
  if (v && v.length <= 45 && isIP(v) !== 0) return v;
  return "unknown";
}

/** Origini ammesse in più, da `RECIPE_IMPORT_ALLOWED_ORIGINS` (separate da virgole); le voci non valide sono ignorate. */
export function parseOrigins(list: string | undefined): string[] {
  const out: string[] = [];
  for (const item of (list ?? "").split(",")) {
    try {
      const o = new URL(item.trim()).origin;
      if (o !== "null") out.push(o);
    } catch {
      // voce non valida
    }
  }
  return out;
}

/**
 * La richiesta deve portare un'intestazione `Origin` uguale all'origine dell'app (ricavata
 * dall'indirizzo della richiesta stessa) o a una di quelle elencate in `extra`. I browser la
 * aggiungono a ogni POST, quindi un altro sito non può usare la rotta con il browser dei suoi
 * visitatori, e uno strumento semplice (curl senza intestazione) è rifiutato. È una difesa contro
 * l'uso da altri siti e da strumenti semplici, NON un'autenticazione: chi costruisce a mano
 * l'intestazione la supera, e per questo restano i limiti di richieste, dimensione e tempo.
 */
function originAllowed(request: Request, extra: readonly string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "" || origin === "null") return false;
  let requested: string;
  try {
    requested = new URL(origin).origin;
  } catch {
    return false;
  }
  if (requested === "null") return false;
  const allowed = new Set(extra);
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // senza un indirizzo leggibile resta solo l'elenco esplicito
  }
  return allowed.has(requested);
}

/** Legge il corpo a flusso fino a `max` byte; `null` se lo supera. */
async function readBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) return null;
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function createImportHandler(deps: ImportHandlerDeps): (request: Request) => Promise<Response> {
  const maxConcurrent = deps.maxConcurrent ?? 6;
  let inFlight = 0;

  return async (request: Request): Promise<Response> => {
    try {
      const extraOrigins = deps.allowedOrigins ?? parseOrigins(process.env.RECIPE_IMPORT_ALLOWED_ORIGINS);
      if (!originAllowed(request, extraOrigins)) return errorResponse("forbidden_origin");

      const key = callerKey(request.headers);
      const decision = deps.perCaller.check(key);
      const globalDecision = deps.global?.check("global");
      if (!decision.allowed || (globalDecision && !globalDecision.allowed)) {
        const wait = Math.max(decision.retryAfterSeconds, globalDecision?.retryAfterSeconds ?? 0);
        return errorResponse("rate_limited", { "retry-after": String(wait) });
      }

      const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") return errorResponse("unsupported_media_type");

      const text = await readBody(request, MAX_BODY_BYTES);
      if (text === null) return errorResponse("payload_too_large");
      let url: unknown;
      try {
        const parsed: unknown = JSON.parse(text);
        url = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as { url?: unknown }).url : undefined;
      } catch {
        return errorResponse("invalid_request");
      }
      if (typeof url !== "string" || url.trim() === "") return errorResponse("invalid_request");

      if (inFlight >= maxConcurrent) return errorResponse("busy", { "retry-after": "5" });
      inFlight++;
      let result: FetchResult;
      try {
        result = await deps.fetch(url);
      } finally {
        inFlight--;
      }
      if (!result.ok) return errorResponse(FETCH_TO_API[result.code] ?? "internal");

      const extracted = extractRecipeFromHtml(result.html, { url: result.finalUrl });
      return new Response(JSON.stringify({ ok: true, ...extracted }), { status: 200, headers: BASE_HEADERS });
    } catch {
      // Nessun dettaglio: né il messaggio né lo stack escono dal server.
      return errorResponse("internal");
    }
  };
}

export function createFetch(deps: FetchDeps, limits?: Partial<FetchLimits>): (url: string) => Promise<FetchResult> {
  return (url) => fetchPage(url, deps, limits);
}
