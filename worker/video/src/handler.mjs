// Gestione delle richieste HTTP. Ordine dei controlli: percorso e metodo, origine, limite di richieste, token,
// corpo, indirizzo, posto libero, estrazione. Niente link né contenuti nei log né nelle risposte d'errore.
import { isAuthorized } from "./auth.mjs";
import { corsHeaders, originAllowed } from "./cors.mjs";
import { extractVideo } from "./extract.mjs";
import { HARD_LIMITS, ServiceError, errorFor } from "./limits.mjs";
import { logEvent } from "./logger.mjs";
import { createRateLimiter, createSlots } from "./rateLimit.mjs";
import { validateVideoUrl } from "./url.mjs";

export const EXTRACT_PATH = "/estrai";
export const HEALTH_PATH = "/salute";

const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

function send(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), ...extra });
  res.end(payload);
}

/** Legge un corpo JSON piccolo, rifiutando ciò che è troppo grande prima di tenerlo in memoria. */
export async function readJsonBody(req, maxBytes = HARD_LIMITS.maxBodyBytes) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw errorFor("unsupported_media_type");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw errorFor("payload_too_large");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw errorFor("payload_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw errorFor("invalid_request");
  }
}

/** Chiave del client per il limite: l'indirizzo della connessione, o, dietro un proxy di fiducia, l'ultimo di X-Forwarded-For. */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (forwarded.length > 0) return forwarded[forwarded.length - 1];
  }
  return req.socket?.remoteAddress ?? "sconosciuto";
}

/**
 * @param {ReturnType<import("./config.mjs").loadConfig>} cfg
 * @param {{ extract?: typeof extractVideo, now?: () => number, log?: typeof logEvent }} deps
 */
export function createHandler(cfg, deps = {}) {
  const extract = deps.extract ?? extractVideo;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? logEvent;
  const limiter = createRateLimiter({ max: cfg.rateMax, windowMs: cfg.rateWindowMs });
  const slots = createSlots(cfg.maxConcurrent);

  return async function handle(req, res) {
    const started = now();
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const cors = corsHeaders(origin, cfg.corsOrigin, req.method === "OPTIONS");
    const fail = (error) => {
      const status = error instanceof ServiceError ? error.status : 500;
      const code = error instanceof ServiceError ? error.code : "internal";
      const headers = { ...cors };
      if (error instanceof ServiceError && error.retryAfterSec) headers["retry-after"] = String(error.retryAfterSec);
      send(res, status, { error: code }, headers);
      log({ event: "request", status, code, ms: now() - started });
    };

    try {
      const path = String(req.url ?? "").split("?")[0];

      if (!originAllowed(origin, cfg.corsOrigin)) throw errorFor("forbidden_origin");

      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...BASE_HEADERS, ...cors });
        res.end();
        return;
      }

      if (path === HEALTH_PATH) {
        if (req.method !== "GET") throw errorFor("method_not_allowed");
        send(res, 200, { ok: true }, cors);
        return;
      }

      if (path !== EXTRACT_PATH) throw errorFor("not_found");
      if (req.method !== "POST") throw errorFor("method_not_allowed");

      const limit = limiter.take(clientKey(req, cfg.trustProxy), now());
      if (!limit.allowed) {
        const error = errorFor("rate_limited");
        error.retryAfterSec = limit.retryAfterSec;
        throw error;
      }
      if (!isAuthorized(req.headers.authorization, cfg.token)) throw errorFor("unauthorized");

      const body = await readJsonBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw errorFor("invalid_request");
      const checked = validateVideoUrl(body.url, cfg.domains);
      if (!checked.ok) throw errorFor(checked.code);

      const release = slots.acquire();
      if (!release) throw errorFor("busy");
      let result;
      try {
        result = await extract(checked.url, cfg);
      } finally {
        release();
      }
      send(res, 200, result, cors);
      log({ event: "request", status: 200, ms: now() - started });
    } catch (error) {
      if (!(error instanceof ServiceError)) log({ event: "unexpected", status: 500, ms: now() - started });
      if (!res.headersSent) fail(error);
      else res.end();
    }
  };
}
