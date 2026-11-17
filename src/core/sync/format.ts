// Formato di scambio: nomi dei file remoti, segmenti di eventi, manifesto per dispositivo.
import { isIsoInstant } from "../ledger";

/**
 * Ogni file remoto ha un nome che dice chi lo ha scritto e cosa contiene:
 * - `seg.<dispositivo>.<sequenza>.<impronta>.json` segmento di eventi, scritto una volta e mai riscritto;
 * - `man.<dispositivo>.json` manifesto, riscritto solo dal suo dispositivo;
 * - `key.<id chiave>.json` parametri pubblici di una chiave (sale, iterazioni, prova).
 * Un dispositivo non riscrive mai file di un altro dispositivo e nessuno cancella niente.
 */
export const SEGMENT_FORMAT = "ledger-sync-segment";
export const SEGMENT_VERSION = 1;
export const MANIFEST_FORMAT = "ledger-sync-manifest";
export const MANIFEST_VERSION = 1;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_RE = /^[0-9a-f]+$/;
const SEQ_DIGITS = 10;
export const MAX_SEQ = 10 ** SEQ_DIGITS - 1;
/** Caratteri dell'impronta nel nome: 64 bit bastano a distinguere due segmenti con la stessa sequenza. */
export const NAME_HASH_CHARS = 16;

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

export function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SEQ;
}

/** Lancia se il nome non sarebbe riconoscibile da `parseRemoteName` (sequenza oltre il massimo, id non valido). */
export function segmentName(deviceId: string, seq: number, hash: string): string {
  if (!isDeviceId(deviceId)) throw new RangeError("invalid_device_id");
  if (!isSeq(seq)) throw new RangeError("invalid_seq");
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new RangeError("invalid_hash");
  return `seg.${deviceId}.${String(seq).padStart(SEQ_DIGITS, "0")}.${hash.slice(0, NAME_HASH_CHARS)}.json`;
}

export function manifestName(deviceId: string): string {
  return `man.${deviceId}.json`;
}

export function keyFileName(keyId: string): string {
  return `key.${keyId}.json`;
}

export type RemoteName =
  | { kind: "segment"; deviceId: string; seq: number; hashPrefix: string }
  | { kind: "manifest"; deviceId: string }
  | { kind: "key"; keyId: string }
  | { kind: "unknown" };

/** Riconosce i nomi scritti da questa versione; tutto il resto è `unknown` e viene lasciato stare. */
export function parseRemoteName(name: string): RemoteName {
  const parts = name.split(".");
  if (parts[parts.length - 1] !== "json") return { kind: "unknown" };
  if (parts[0] === "seg" && parts.length === 5) {
    const [, deviceId, seqText, hashPrefix] = parts;
    if (
      isDeviceId(deviceId) &&
      seqText.length === SEQ_DIGITS &&
      /^\d+$/.test(seqText) &&
      hashPrefix.length === NAME_HASH_CHARS &&
      HEX_RE.test(hashPrefix)
    ) {
      return { kind: "segment", deviceId, seq: Number(seqText), hashPrefix };
    }
  }
  if (parts[0] === "man" && parts.length === 3 && isDeviceId(parts[1])) {
    return { kind: "manifest", deviceId: parts[1] };
  }
  if (parts[0] === "key" && parts.length === 3 && /^[0-9a-f]{32}$/.test(parts[1])) {
    return { kind: "key", keyId: parts[1] };
  }
  return { kind: "unknown" };
}

export interface SegmentEncryption {
  alg: "AES-GCM-256";
  kdf: "HKDF-SHA256";
  /** Chiave principale usata (vedi `key.<id>.json`). */
  keyId: string;
  /** Sale casuale del segmento, base64. */
  salt: string;
  /** Nonce casuale del segmento, base64. */
  nonce: string;
}

/** Intestazione in chiaro: non contiene dati personali, solo come leggere il contenuto. */
export interface SegmentHeader {
  format: typeof SEGMENT_FORMAT;
  version: number;
  deviceId: string;
  seq: number;
  /** Istante di scrittura secondo l'orologio del dispositivo (serve a notare orologi sfasati). */
  createdAt: string;
  /** Numero di eventi. */
  count: number;
  /** SHA-256 esadecimale del contenuto così come è salvato (cifrato o no). */
  hash: string;
  encryption: SegmentEncryption | null;
}

export interface SegmentEnvelope {
  header: SegmentHeader;
  /** Contenuto in base64: `{ "events": [...] }` in UTF-8, cifrato se `encryption` non è nullo. */
  payload: string;
}

export interface ManifestSegment {
  name: string;
  seq: number;
}

/** Riassunto dei segmenti di un dispositivo. È un aiuto, non la fonte di verità: conta l'elenco dei file. */
export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  version: number;
  deviceId: string;
  updatedAt: string;
  lastSeq: number;
  segments: ManifestSegment[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isB64 = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);

function isEncryption(v: unknown): v is SegmentEncryption {
  return (
    isRecord(v) &&
    v.alg === "AES-GCM-256" &&
    v.kdf === "HKDF-SHA256" &&
    typeof v.keyId === "string" &&
    /^[0-9a-f]{32}$/.test(v.keyId) &&
    isB64(v.salt) &&
    isB64(v.nonce)
  );
}

/** Intestazione completa e coerente con questa versione del formato. */
export function isSegmentHeader(v: unknown): v is SegmentHeader {
  return (
    isRecord(v) &&
    v.format === SEGMENT_FORMAT &&
    v.version === SEGMENT_VERSION &&
    isDeviceId(v.deviceId) &&
    isSeq(v.seq) &&
    isIsoInstant(v.createdAt) &&
    typeof v.count === "number" &&
    Number.isInteger(v.count) &&
    v.count >= 0 &&
    typeof v.hash === "string" &&
    /^[0-9a-f]{64}$/.test(v.hash) &&
    (v.encryption === null || isEncryption(v.encryption))
  );
}

/** Intestazione senza l'impronta: sono i dati autenticati della cifratura. */
export function headerForAad(header: Omit<SegmentHeader, "hash"> & { hash?: string }): Omit<SegmentHeader, "hash"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, ...rest } = header;
  return rest;
}

export function parseManifest(v: unknown): Manifest | undefined {
  if (!isRecord(v) || v.format !== MANIFEST_FORMAT || v.version !== MANIFEST_VERSION) return undefined;
  if (!isDeviceId(v.deviceId) || !isIsoInstant(v.updatedAt) || !isSeq(v.lastSeq)) return undefined;
  if (!Array.isArray(v.segments)) return undefined;
  const segments: ManifestSegment[] = [];
  for (const s of v.segments) {
    if (!isRecord(s) || typeof s.name !== "string" || !isSeq(s.seq)) return undefined;
    segments.push({ name: s.name, seq: s.seq });
  }
  return { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, deviceId: v.deviceId, updatedAt: v.updatedAt, lastSeq: v.lastSeq, segments };
}

/** Unione di due elenchi di segmenti per nome, in ordine stabile. */
export function mergeManifestSegments(a: readonly ManifestSegment[], b: readonly ManifestSegment[]): ManifestSegment[] {
  const byName = new Map<string, ManifestSegment>();
  for (const s of [...a, ...b]) if (!byName.has(s.name)) byName.set(s.name, s);
  return [...byName.values()].sort((x, y) => x.seq - y.seq || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}
