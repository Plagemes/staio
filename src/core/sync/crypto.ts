// Cifratura dei segmenti con una frase segreta dell'utente (WebCrypto).
//
// Schema a due livelli:
// 1. frase segreta + sale della chiave --PBKDF2-SHA256 (600 000 iterazioni)--> chiave principale
//    (256 bit, importata come chiave HKDF non estraibile: si conserva sul dispositivo senza
//    poterla leggere, e la frase non si salva mai);
// 2. chiave principale + sale casuale del segmento --HKDF-SHA256--> chiave AES-GCM-256 del segmento,
//    con nonce casuale di 96 bit e l'intestazione del segmento come dati autenticati.
// Il sale e le iterazioni della chiave principale stanno in `key.<id>.json`, con una prova cifrata
// che permette di riconoscere una frase sbagliata senza toccare i dati.
import { buf, fromBase64, randomBytes, toBase64, toHex, utf8, fromUtf8 } from "./bytes";
import { canonicalStringify, isIsoInstant } from "../ledger";

export const KEY_FORMAT = "ledger-sync-key";
export const KEY_VERSION = 1;

/** Parametri dichiarati. 600 000 iterazioni: raccomandazione OWASP 2023 per PBKDF2-HMAC-SHA256. */
export const KDF_ITERATIONS = 600_000;
export const KDF_SALT_BYTES = 16;
/** Una chiave remota con meno iterazioni è rifiutata: proteggerebbe troppo poco la frase. */
export const MIN_KDF_ITERATIONS = 100_000;
export const MAX_KDF_ITERATIONS = 10_000_000;
export const SEGMENT_SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const MIN_PASSPHRASE_LENGTH = 12;

const SEGMENT_INFO = utf8("ledger-sync/segment/v1");
const CHECK_INFO = utf8("ledger-sync/check/v1");
const CHECK_TEXT = "ledger-sync-key-check";

export interface KeyInfo {
  format: typeof KEY_FORMAT;
  version: number;
  /** Esadecimale del sale: identifica la chiave principale. */
  keyId: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  /** Testo noto cifrato con la chiave: decifrarlo prova che la frase è giusta. */
  check: { salt: string; nonce: string; data: string };
  createdAt: string;
}

export type SyncCryptoErrorCode =
  | "wrong_passphrase"
  | "invalid_key_info"
  | "weak_key_info"
  | "auth_failed"
  | "passphrase_too_short"
  /** La frase e la sua ripetizione non coincidono. */
  | "passphrase_mismatch"
  /** Esiste già una chiave: va sbloccata, non creata. */
  | "key_exists"
  /** Nessuna chiave esistente da sbloccare: va creata. */
  | "no_existing_key"
  | "webcrypto_unavailable";

export class SyncCryptoError extends Error {
  constructor(readonly code: SyncCryptoErrorCode) {
    super(code);
    this.name = "SyncCryptoError";
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SyncCryptoError("webcrypto_unavailable");
  return s;
}

/** Spazi ai bordi tolti (le tastiere dei telefoni li aggiungono) e forma Unicode unica. */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC").trim();
}

export function checkPassphrase(passphrase: string): "too_short" | null {
  return [...normalizePassphrase(passphrase)].length < MIN_PASSPHRASE_LENGTH ? "too_short" : null;
}

async function deriveMaster(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey("raw", buf(utf8(normalizePassphrase(passphrase))), "PBKDF2", false, ["deriveBits"]);
  const bits = await s.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations }, base, 256);
  const raw = new Uint8Array(bits);
  try {
    return await s.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  } finally {
    raw.fill(0);
  }
}

async function subKey(master: CryptoKey, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface CreateKeyOptions {
  /** Solo per i test: le iterazioni reali sono `KDF_ITERATIONS`. */
  iterations?: number;
  now?: Date;
}

export interface UnlockedKey {
  keyInfo: KeyInfo;
  /** Chiave principale HKDF, non estraibile. */
  key: CryptoKey;
}

export async function createKey(passphrase: string, options: CreateKeyOptions = {}): Promise<UnlockedKey> {
  if (checkPassphrase(passphrase)) throw new SyncCryptoError("passphrase_too_short");
  const iterations = options.iterations ?? KDF_ITERATIONS;
  const salt = randomBytes(KDF_SALT_BYTES);
  const key = await deriveMaster(passphrase, salt, iterations);
  const keyId = toHex(salt);
  const checkSalt = randomBytes(SEGMENT_SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const data = await subtle().encrypt(
    { name: "AES-GCM", iv: buf(nonce), additionalData: buf(utf8(keyId)) },
    await subKey(key, checkSalt, CHECK_INFO),
    buf(utf8(CHECK_TEXT)),
  );
  const keyInfo: KeyInfo = {
    format: KEY_FORMAT,
    version: KEY_VERSION,
    keyId,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
    check: { salt: toBase64(checkSalt), nonce: toBase64(nonce), data: toBase64(new Uint8Array(data)) },
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  return { keyInfo, key };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Legge e controlla un `key.<id>.json`. */
export function parseKeyInfo(v: unknown): KeyInfo | undefined {
  if (!isRecord(v) || v.format !== KEY_FORMAT || v.version !== KEY_VERSION) return undefined;
  const { kdf, check } = v;
  if (!isRecord(kdf) || !isRecord(check)) return undefined;
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256") return undefined;
  if (typeof kdf.iterations !== "number" || !Number.isInteger(kdf.iterations)) return undefined;
  const salt = typeof kdf.salt === "string" ? fromBase64(kdf.salt) : undefined;
  if (!salt || salt.length !== KDF_SALT_BYTES || v.keyId !== toHex(salt)) return undefined;
  for (const f of ["salt", "nonce", "data"] as const) {
    if (typeof check[f] !== "string" || !fromBase64(check[f] as string)) return undefined;
  }
  if (!isIsoInstant(v.createdAt)) return undefined;
  return {
    format: KEY_FORMAT,
    version: KEY_VERSION,
    keyId: v.keyId,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt as string },
    check: { salt: check.salt as string, nonce: check.nonce as string, data: check.data as string },
    createdAt: v.createdAt,
  };
}

export interface UnlockOptions {
  /** Solo per i test. */
  minIterations?: number;
}

/** Ricava la chiave principale dalla frase. Frase sbagliata: `wrong_passphrase`, e nulla viene scritto. */
export async function unlockKey(passphrase: string, keyInfo: KeyInfo, options: UnlockOptions = {}): Promise<CryptoKey> {
  const parsed = parseKeyInfo(keyInfo);
  if (!parsed) throw new SyncCryptoError("invalid_key_info");
  const min = options.minIterations ?? MIN_KDF_ITERATIONS;
  if (parsed.kdf.iterations < min || parsed.kdf.iterations > MAX_KDF_ITERATIONS) {
    throw new SyncCryptoError("weak_key_info");
  }
  const key = await deriveMaster(passphrase, fromBase64(parsed.kdf.salt)!, parsed.kdf.iterations);
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: buf(fromBase64(parsed.check.nonce)!), additionalData: buf(utf8(parsed.keyId)) },
      await subKey(key, fromBase64(parsed.check.salt)!, CHECK_INFO),
      buf(fromBase64(parsed.check.data)!),
    );
    if (fromUtf8(new Uint8Array(plain)) !== CHECK_TEXT) throw new Error("mismatch");
  } catch {
    throw new SyncCryptoError("wrong_passphrase");
  }
  return key;
}

export interface SealParams {
  /** Sale del segmento, base64. */
  salt: string;
  /** Nonce, base64. */
  nonce: string;
}

/** Sale e nonce nuovi: vanno scelti per ogni segmento e mai riusati. */
export function freshSealParams(): SealParams {
  return { salt: toBase64(randomBytes(SEGMENT_SALT_BYTES)), nonce: toBase64(randomBytes(NONCE_BYTES)) };
}

/** Cifra con la chiave del segmento ricavata dal sale; `aad` è autenticato ma non cifrato. */
export async function seal(master: CryptoKey, params: SealParams, plaintext: Uint8Array, aad: unknown): Promise<Uint8Array> {
  const salt = fromBase64(params.salt)!;
  const nonce = fromBase64(params.nonce)!;
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv: buf(nonce), additionalData: buf(utf8(canonicalStringify(aad))) },
    await subKey(master, salt, SEGMENT_INFO),
    buf(plaintext),
  );
  return new Uint8Array(ciphertext);
}

/** Decifra e verifica. Chiave sbagliata o dati alterati: `auth_failed`. */
export async function open(
  master: CryptoKey,
  params: { salt: string; nonce: string },
  ciphertext: Uint8Array,
  aad: unknown,
): Promise<Uint8Array> {
  const salt = fromBase64(params.salt);
  const nonce = fromBase64(params.nonce);
  if (!salt || !nonce || nonce.length !== NONCE_BYTES) throw new SyncCryptoError("auth_failed");
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: buf(nonce), additionalData: buf(utf8(canonicalStringify(aad))) },
      await subKey(master, salt, SEGMENT_INFO),
      buf(ciphertext),
    );
    return new Uint8Array(plain);
  } catch {
    throw new SyncCryptoError("auth_failed");
  }
}
