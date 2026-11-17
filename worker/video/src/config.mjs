// Configurazione dalle variabili d'ambiente. I limiti si possono solo abbassare rispetto a `HARD_LIMITS`.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOrigin } from "./cors.mjs";
import { HARD_LIMITS, clampInt } from "./limits.mjs";
import { ALLOWED_DOMAINS } from "./url.mjs";

export const MIN_TOKEN_CHARS = 24;

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env) {
  const token = (env.STAIO_VIDEO_TOKEN ?? "").trim();
  if (token.length < MIN_TOKEN_CHARS || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error(`STAIO_VIDEO_TOKEN manca o non è valido: servono almeno ${MIN_TOKEN_CHARS} caratteri stampabili, senza spazi (per esempio l'uscita di «openssl rand -base64 32»).`);
  }
  const corsRaw = (env.STAIO_VIDEO_CORS_ORIGIN ?? "").trim();
  const corsOrigin = parseOrigin(corsRaw);
  if (corsRaw !== "" && corsOrigin === undefined) {
    throw new Error("STAIO_VIDEO_CORS_ORIGIN non è un'origine valida: scrivi schema e dominio, per esempio https://app.esempio.it (senza percorso).");
  }
  return Object.freeze({
    token,
    host: (env.HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port: clampInt(env.PORT, 1, 65535, 8787),
    corsOrigin,
    domains: ALLOWED_DOMAINS,
    maxDurationSec: clampInt(env.STAIO_VIDEO_MAX_DURATION_SEC, 1, HARD_LIMITS.maxDurationSec, HARD_LIMITS.maxDurationSec),
    maxFileBytes: clampInt(env.STAIO_VIDEO_MAX_FILE_MB, 1, HARD_LIMITS.maxFileBytes / (1024 * 1024), 80) * 1024 * 1024,
    timeoutMs: clampInt(env.STAIO_VIDEO_TIMEOUT_SEC, 10, HARD_LIMITS.maxTimeoutMs / 1000, 120) * 1000,
    frames: clampInt(env.STAIO_VIDEO_FRAMES, 0, HARD_LIMITS.maxFrames, HARD_LIMITS.maxFrames),
    frameWidth: clampInt(env.STAIO_VIDEO_FRAME_WIDTH, 256, 1280, 768),
    rateMax: clampInt(env.STAIO_VIDEO_RATE_MAX, 1, 1000, 10),
    rateWindowMs: clampInt(env.STAIO_VIDEO_RATE_WINDOW_SEC, 10, 86_400, 600) * 1000,
    maxConcurrent: clampInt(env.STAIO_VIDEO_CONCURRENCY, 1, 2, 1),
    trustProxy: env.STAIO_VIDEO_TRUST_PROXY === "1",
    tmpRoot: (env.STAIO_VIDEO_TMP ?? "").trim() || join(tmpdir(), "staio-video"),
    ytdlp: (env.STAIO_VIDEO_YTDLP ?? "").trim() || "yt-dlp",
    ffmpeg: (env.STAIO_VIDEO_FFMPEG ?? "").trim() || "ffmpeg",
  });
}
