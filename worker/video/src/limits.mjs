// Limiti e controlli puri: nessuna rete, nessun disco.
import { hostAllowed } from "./url.mjs";

/** Limiti che la configurazione può solo abbassare. */
export const HARD_LIMITS = Object.freeze({
  maxDurationSec: 300,
  maxFrames: 8,
  maxFileBytes: 200 * 1024 * 1024,
  maxTimeoutMs: 300_000,
  maxCaptionChars: 5000,
  maxTranscriptChars: 30_000,
  maxBodyBytes: 4096,
  maxFrameBytes: 700 * 1024,
  maxTotalFrameBytes: 5 * 1024 * 1024,
});

export class ServiceError extends Error {
  /** @param {string} code @param {number} status */
  constructor(code, status) {
    super(code);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export const ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  invalid_url: 422,
  domain_not_allowed: 422,
  too_long: 422,
  too_large: 422,
  rate_limited: 429,
  unavailable: 502,
  internal: 500,
  busy: 503,
  timeout: 504,
});

/** @param {string} code */
export const errorFor = (code) => new ServiceError(code, ERROR_STATUS[code] ?? 500);

/** Intero in un intervallo; se il valore manca o non è un numero si usa `fallback`. */
export function clampInt(value, min, max, fallback) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Controlla i metadati del video prima di scaricarlo: un solo video (non un elenco), non in diretta, durata nota
 * e entro il massimo, dimensione dichiarata entro il massimo, estrattore specifico (mai quello generico), host
 * della pagina ancora tra quelli ammessi.
 * @returns {{ ok: true, durationSec: number } | { ok: false, code: string }}
 */
export function checkInfo(info, { maxDurationSec, maxFileBytes, domains }) {
  if (typeof info !== "object" || info === null || Array.isArray(info)) return { ok: false, code: "unavailable" };
  if (info._type === "playlist" || Array.isArray(info.entries)) return { ok: false, code: "invalid_url" };
  if (info.is_live === true || info.live_status === "is_live" || info.live_status === "is_upcoming") return { ok: false, code: "unavailable" };
  if (typeof info.extractor_key !== "string" || /^generic$/i.test(info.extractor_key)) return { ok: false, code: "domain_not_allowed" };
  if (typeof info.webpage_url === "string") {
    let host;
    try {
      host = new URL(info.webpage_url).hostname;
    } catch {
      return { ok: false, code: "unavailable" };
    }
    if (!hostAllowed(host, domains)) return { ok: false, code: "domain_not_allowed" };
  } else {
    return { ok: false, code: "unavailable" };
  }
  const duration = info.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return { ok: false, code: "unavailable" };
  if (duration > maxDurationSec) return { ok: false, code: "too_long" };
  for (const field of ["filesize", "filesize_approx"]) {
    const size = info[field];
    if (typeof size === "number" && Number.isFinite(size) && size > maxFileBytes) return { ok: false, code: "too_large" };
  }
  return { ok: true, durationSec: Math.round(duration * 10) / 10 };
}

/** Istanti (in secondi) dei fotogrammi: al centro di `count` parti uguali del video. */
export function frameTimestamps(durationSec, count) {
  const n = Math.max(0, Math.min(HARD_LIMITS.maxFrames, Math.trunc(count)));
  if (!(durationSec > 0) || n === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(((durationSec * (i + 0.5)) / n) * 100) / 100);
  return out;
}

/** Testo del servizio: senza caratteri di controllo (tranne a capo), a lunghezza limitata. */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, max)
    .trim();
}

/** I fotogrammi tenuti: ciascuno sotto il suo tetto e tutti insieme sotto il tetto complessivo. */
export function keepFrames(sizes) {
  const kept = [];
  let total = 0;
  sizes.forEach((size, index) => {
    if (size <= 0 || size > HARD_LIMITS.maxFrameBytes) return;
    if (total + size > HARD_LIMITS.maxTotalFrameBytes) return;
    total += size;
    kept.push(index);
  });
  return kept;
}
