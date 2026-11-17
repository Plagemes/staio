// Risposta del «servizio di estrazione» dei video. È un dato non fidato: arriva da una macchina che l'utente ha
// indicato ma che può sbagliare o essere compromessa. Si controllano tipi, dimensioni, numero e forma dei fotogrammi;
// qualunque violazione scarta tutta la risposta. Il servizio non riceve mai la chiave dell'intelligenza artificiale.
//
// Contratto: POST /estrai { url } con `Authorization: Bearer <token>` -> { caption, transcript?, frames?, durationSec }.
import type { AiImage } from "./types";
import { MAX_CAPTION_CHARS, MAX_TRANSCRIPT_CHARS, MAX_VIDEO_FRAMES } from "./videoRecipe";

export const SERVICE_LIMITS = {
  maxFrames: MAX_VIDEO_FRAMES,
  /** Caratteri base64 di un fotogramma (circa 1,1 MB di JPEG). */
  maxFrameChars: 1_500_000,
  maxTotalFrameChars: 8_000_000,
  maxCaptionChars: MAX_CAPTION_CHARS,
  maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
  /** Il servizio rifiuta già i video più lunghi: se ne dichiara uno più lungo, la risposta non è affidabile. */
  maxDurationSec: 300,
  /** Dimensione massima dell'intera risposta, in caratteri. */
  maxBodyChars: 12_000_000,
} as const;

export type ServiceReadError = "bad_response" | "too_long" | "empty";

export interface ExtractedVideo {
  caption: string;
  transcript?: string;
  frames: AiImage[];
  durationSec: number;
}

export type ServiceReadResult = { ok: true; value: ExtractedVideo } | { ok: false; code: ServiceReadError };

const bad: ServiceReadResult = { ok: false, code: "bad_response" };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** «/9j/» è l'inizio di ogni JPEG in base64. */
const JPEG_START = "/9j/";

function cleanServiceText(value: string, max: number): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, max)
    .trim();
}

/** Controlla la risposta del servizio. Non lancia mai. */
export function parseServiceResponse(json: unknown): ServiceReadResult {
  try {
    if (!isRecord(json)) return bad;

    const rawCaption = json.caption;
    if (rawCaption !== undefined && rawCaption !== null && typeof rawCaption !== "string") return bad;
    const caption = cleanServiceText(rawCaption ?? "", SERVICE_LIMITS.maxCaptionChars);

    const rawTranscript = json.transcript;
    if (rawTranscript !== undefined && rawTranscript !== null && typeof rawTranscript !== "string") return bad;
    const transcript = cleanServiceText(rawTranscript ?? "", SERVICE_LIMITS.maxTranscriptChars);

    const duration = json.durationSec;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return bad;
    if (duration > SERVICE_LIMITS.maxDurationSec) return { ok: false, code: "too_long" };

    const rawFrames = json.frames;
    if (rawFrames !== undefined && rawFrames !== null && !Array.isArray(rawFrames)) return bad;
    const list: unknown[] = rawFrames ?? [];
    if (list.length > SERVICE_LIMITS.maxFrames) return bad;
    const frames: AiImage[] = [];
    let total = 0;
    for (const item of list) {
      if (typeof item !== "string" || item.length < 100 || item.length > SERVICE_LIMITS.maxFrameChars) return bad;
      if (!item.startsWith(JPEG_START) || !BASE64.test(item)) return bad;
      total += item.length;
      if (total > SERVICE_LIMITS.maxTotalFrameChars) return bad;
      frames.push({ mediaType: "image/jpeg", dataBase64: item });
    }

    if (caption === "" && transcript === "" && frames.length === 0) return { ok: false, code: "empty" };
    return { ok: true, value: { caption, ...(transcript !== "" ? { transcript } : {}), frames, durationSec: duration } };
  } catch {
    return bad;
  }
}
