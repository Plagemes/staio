// Scarico sicuro di una pagina web. Codice solo server, esposto a Internet: la sicurezza viene prima.
//
// Regole: solo https; il nome è risolto prima della richiesta e TUTTI gli indirizzi risolti devono
// essere pubblici (la connessione poi va proprio a quell'indirizzo, così una seconda risoluzione
// non può dare un risultato diverso); nessun reindirizzamento seguito da solo: ogni salto è
// ricontrollato da capo, al massimo tre; tempo massimo complessivo; dimensione massima letta a
// flusso; solo contenuti HTML; nessuna intestazione dell'utente inoltrata.

import { isPublicAddress } from "./ip";
import { checkUrl, type UrlRejection } from "./url";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** Indirizzo già controllato a cui collegarsi. */
  address: ResolvedAddress;
  /** Le sole intestazioni da inviare. */
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Nomi in minuscolo. */
  headers: Readonly<Record<string, string | undefined>>;
  /** Corpo già decompresso. */
  body: AsyncIterable<Uint8Array>;
  /** Chiude la connessione senza leggere altro. */
  close(): void;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface FetchDeps {
  resolve: Resolver;
  transport: Transport;
}

export interface FetchLimits {
  /** Tempo massimo complessivo (risoluzioni, connessioni e lettura di tutti i salti). */
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

export const DEFAULT_LIMITS: FetchLimits = {
  timeoutMs: 8000,
  maxBytes: 3 * 1024 * 1024,
  maxRedirects: 3,
};

/** Le uniche intestazioni inviate: niente cookie, credenziali né altro dall'utente. */
export const OUTGOING_HEADERS: Readonly<Record<string, string>> = {
  "user-agent": "RecipeImporter/1.0 (lettura di una sola pagina su richiesta dell'utente)",
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "accept-language": "it,en;q=0.5",
  "accept-encoding": "gzip, deflate, br",
};

export type FetchErrorCode =
  | UrlRejection
  | "dns_failed"
  | "blocked_address"
  | "too_many_redirects"
  | "bad_redirect"
  | "upstream_status"
  | "not_html"
  | "too_large"
  | "unsupported_encoding"
  | "timeout"
  | "network";

export type FetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; code: FetchErrorCode };

class Failure extends Error {
  constructor(readonly code: FetchErrorCode) {
    super(code);
  }
}

/** Errore che un `Transport` può lanciare per una codifica del contenuto non gestita. */
export class UnsupportedEncodingError extends Error {}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Failure("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Failure("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function isHtml(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

function charsetOf(contentType: string | undefined, head: Uint8Array): string {
  const fromHeader = /charset\s*=\s*["']?([a-z0-9_\-:.]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader;
  const ascii = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return /<meta[^>]+charset\s*=\s*["']?([a-z0-9_\-:.]+)/i.exec(ascii)?.[1] ?? "utf-8";
}

function decode(bytes: Uint8Array, contentType: string | undefined): string {
  let label = charsetOf(contentType, bytes);
  let text: string;
  try {
    text = new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    label = "utf-8";
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readCapped(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await raceAbort(iterator.next(), signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Failure("too_large");
      chunks.push(next.value);
    }
  } finally {
    // Interrompe il flusso se ci si ferma prima della fine.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Scarica una pagina HTML. Non salva né registra nulla. Il risultato porta solo un codice d'errore,
 * mai dettagli interni (nomi, indirizzi risolti, messaggi di sistema).
 */
export async function fetchPage(
  rawUrl: string,
  deps: FetchDeps,
  limits: Partial<FetchLimits> = {},
): Promise<FetchResult> {
  const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULT_LIMITS, ...limits };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal } = controller;
  let current = rawUrl;
  let open: TransportResponse | undefined;

  try {
    for (let hop = 0; ; hop++) {
      const checked = checkUrl(current);
      if (!checked.ok) throw new Failure(hop === 0 ? checked.code : "bad_redirect");

      let addresses: readonly ResolvedAddress[];
      try {
        addresses = await raceAbort(deps.resolve(checked.hostname), signal);
      } catch (e) {
        if (e instanceof Failure) throw e;
        throw new Failure("dns_failed");
      }
      if (addresses.length === 0) throw new Failure("dns_failed");
      // Un solo indirizzo non pubblico tra quelli risolti basta a rifiutare il nome.
      if (!addresses.every((a) => isPublicAddress(a.address))) throw new Failure("blocked_address");
      const address = addresses[0] as ResolvedAddress;

      let response: TransportResponse;
      try {
        response = await raceAbort(
          deps.transport({ url: checked.url, address, headers: OUTGOING_HEADERS, signal }),
          signal,
        );
      } catch (e) {
        if (e instanceof Failure) throw e;
        if (e instanceof UnsupportedEncodingError) throw new Failure("unsupported_encoding");
        throw new Failure(signal.aborted ? "timeout" : "network");
      }
      open = response;

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.location;
        response.close();
        open = undefined;
        if (!location) throw new Failure("bad_redirect");
        if (hop >= maxRedirects) throw new Failure("too_many_redirects");
        try {
          current = new URL(location, checked.url).toString();
        } catch {
          throw new Failure("bad_redirect");
        }
        continue;
      }
      if (response.status < 200 || response.status > 299) throw new Failure("upstream_status");

      const contentType = response.headers["content-type"];
      if (!isHtml(contentType)) throw new Failure("not_html");
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) throw new Failure("too_large");

      let bytes: Uint8Array;
      try {
        bytes = await readCapped(response.body, maxBytes, signal);
      } catch (e) {
        if (e instanceof Failure) throw e;
        if (e instanceof UnsupportedEncodingError) throw new Failure("unsupported_encoding");
        throw new Failure(signal.aborted ? "timeout" : "network");
      }
      return { ok: true, html: decode(bytes, contentType), finalUrl: checked.url.toString() };
    }
  } catch (e) {
    return { ok: false, code: e instanceof Failure ? e.code : signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    try {
      open?.close();
    } catch {
      // già chiusa
    }
  }
}
