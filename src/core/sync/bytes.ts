// Conversioni tra testo, byte, base64 ed esadecimale; impronte del contenuto.
import { canonicalStringify } from "../ledger";

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Decodifica UTF-8; con `fatal` lancia su sequenze non valide invece di sostituirle. */
export function fromUtf8(bytes: Uint8Array, fatal = false): string {
  return new TextDecoder("utf-8", { fatal }).decode(bytes);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

/** Base64 rigoroso (alfabeto standard, riempimento obbligatorio). `undefined` se non valido. */
export function fromBase64(text: string): Uint8Array | undefined {
  if (typeof text !== "string" || text.length % 4 !== 0) return undefined;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = text[i + j];
      const isPad = ch === "=" && i + 4 === text.length && j >= 4 - pad;
      const v = isPad ? 0 : B64_INDEX.get(ch);
      if (v === undefined) return undefined;
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("webcrypto_unavailable");
  return s;
}

/** Copia in un ArrayBuffer proprio: WebCrypto non accetta viste su buffer condivisi. */
export function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest("SHA-256", buf(bytes))));
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Chiave di una versione di un evento: id più SHA-256 del contenuto canonico. Due versioni
 * diverse con lo stesso id hanno chiavi diverse, così ognuna arriva agli altri dispositivi
 * e l'unione sceglie ovunque la stessa.
 */
export async function eventKey(event: unknown): Promise<string> {
  const id = typeof event === "object" && event !== null ? (event as { id?: unknown }).id : undefined;
  return `${String(id)}|${await sha256Hex(utf8(canonicalStringify(event)))}`;
}

export function eventKeys(events: readonly unknown[]): Promise<string[]> {
  return Promise.all(events.map(eventKey));
}
