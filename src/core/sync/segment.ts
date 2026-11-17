// Scrittura e lettura di un segmento: verifica di nome, intestazione, impronta e cifratura.
import { fromBase64, fromUtf8, sha256Hex, toBase64, utf8 } from "./bytes";
import { freshSealParams, open, seal, SyncCryptoError } from "./crypto";
import {
  NAME_HASH_CHARS,
  SEGMENT_FORMAT,
  SEGMENT_VERSION,
  headerForAad,
  isDeviceId,
  isSegmentHeader,
  isSeq,
  parseRemoteName,
  segmentName,
  type SegmentEncryption,
  type SegmentHeader,
} from "./format";

export interface EncodeSegmentInput {
  deviceId: string;
  seq: number;
  createdAt: string;
  events: readonly unknown[];
  /** Chiave principale con il suo id; senza, il segmento resta in chiaro. */
  key?: { keyId: string; key: CryptoKey };
}

export interface EncodedSegment {
  name: string;
  header: SegmentHeader;
  bytes: Uint8Array;
}

export async function encodeSegment(input: EncodeSegmentInput): Promise<EncodedSegment> {
  if (!isDeviceId(input.deviceId)) throw new RangeError("invalid_device_id");
  if (!isSeq(input.seq)) throw new RangeError("invalid_seq");
  const body = utf8(JSON.stringify({ events: input.events }));
  const base = {
    format: SEGMENT_FORMAT,
    version: SEGMENT_VERSION,
    deviceId: input.deviceId,
    seq: input.seq,
    createdAt: input.createdAt,
    count: input.events.length,
  } as const;
  let payload: Uint8Array;
  let encryption: SegmentEncryption | null = null;
  if (input.key) {
    const params = freshSealParams();
    encryption = { alg: "AES-GCM-256", kdf: "HKDF-SHA256", keyId: input.key.keyId, ...params };
    payload = await seal(input.key.key, params, body, headerForAad({ ...base, encryption }));
  } else {
    payload = body;
  }
  const hash = await sha256Hex(payload);
  const header: SegmentHeader = { ...base, hash, encryption };
  const bytes = utf8(JSON.stringify({ header, payload: toBase64(payload) }));
  return { name: segmentName(input.deviceId, input.seq, hash), header, bytes };
}

export type SegmentRejectReason =
  | "corrupt"
  | "wrong_format"
  | "bad_header"
  | "name_mismatch"
  | "hash_mismatch"
  | "auth_failed"
  | "corrupt_body"
  | "count_mismatch"
  /** Segmento in chiaro dove la cifratura è obbligatoria. */
  | "unencrypted";

export type DecodedSegment =
  | { status: "ok"; header: SegmentHeader; events: unknown[] }
  /** Cifrato con una chiave che questo dispositivo non ha: va riletto dopo la frase segreta. */
  | { status: "locked"; header: SegmentHeader; keyId: string }
  /** Scritto da una versione più recente del formato: si conserva e si riprova dopo un aggiornamento. */
  | { status: "future"; version: number; deviceId?: string }
  | { status: "rejected"; reason: SegmentRejectReason; deviceId?: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type KeyLookup = (keyId: string) => Promise<CryptoKey | undefined>;

export interface DecodeOptions {
  /** Con Drive: un segmento in chiaro è rifiutato, mai applicato. */
  requireEncryption?: boolean;
}

export async function decodeSegment(
  name: string,
  bytes: Uint8Array,
  keyFor: KeyLookup,
  options: DecodeOptions = {},
): Promise<DecodedSegment> {
  const parsedName = parseRemoteName(name);
  const nameDevice = parsedName.kind === "segment" ? parsedName.deviceId : undefined;
  let doc: unknown;
  try {
    doc = JSON.parse(fromUtf8(bytes, true));
  } catch {
    return { status: "rejected", reason: "corrupt", deviceId: nameDevice };
  }
  if (!isRecord(doc) || !isRecord(doc.header)) return { status: "rejected", reason: "corrupt", deviceId: nameDevice };
  const h = doc.header;
  if (h.format !== SEGMENT_FORMAT) return { status: "rejected", reason: "wrong_format", deviceId: nameDevice };
  if (typeof h.version === "number" && Number.isInteger(h.version) && h.version > SEGMENT_VERSION) {
    return { status: "future", version: h.version, deviceId: nameDevice };
  }
  if (!isSegmentHeader(h)) return { status: "rejected", reason: "bad_header", deviceId: nameDevice };
  const header = h;
  if (
    parsedName.kind !== "segment" ||
    parsedName.deviceId !== header.deviceId ||
    parsedName.seq !== header.seq ||
    parsedName.hashPrefix !== header.hash.slice(0, NAME_HASH_CHARS)
  ) {
    return { status: "rejected", reason: "name_mismatch", deviceId: nameDevice };
  }
  const payload = typeof doc.payload === "string" ? fromBase64(doc.payload) : undefined;
  if (!payload) return { status: "rejected", reason: "corrupt", deviceId: header.deviceId };
  if ((await sha256Hex(payload)) !== header.hash) {
    return { status: "rejected", reason: "hash_mismatch", deviceId: header.deviceId };
  }
  if (!header.encryption && options.requireEncryption) {
    return { status: "rejected", reason: "unencrypted", deviceId: header.deviceId };
  }
  let body = payload;
  if (header.encryption) {
    const key = await keyFor(header.encryption.keyId);
    if (!key) return { status: "locked", header, keyId: header.encryption.keyId };
    try {
      body = await open(key, header.encryption, payload, headerForAad(header));
    } catch (e) {
      if (e instanceof SyncCryptoError) return { status: "rejected", reason: "auth_failed", deviceId: header.deviceId };
      throw e;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(body, true));
  } catch {
    return { status: "rejected", reason: "corrupt_body", deviceId: header.deviceId };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    return { status: "rejected", reason: "corrupt_body", deviceId: header.deviceId };
  }
  if (parsed.events.length !== header.count) {
    return { status: "rejected", reason: "count_mismatch", deviceId: header.deviceId };
  }
  return { status: "ok", header, events: parsed.events };
}
