// Sincronizzazione con file: un pacchetto contiene segmenti (cifrati se c'è la chiave) e i
// parametri pubblici della chiave. Chi lo importa lo legge con lo stesso protocollo di Drive,
// in sola lettura: niente viene cancellato, gli eventi si uniscono per id.
import { fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";
import { parseKeyInfo, type KeyInfo } from "./crypto";
import { runSync, type IncomingCommit, type SyncLocalPort, type SyncReport, type WriteKey } from "./engine";
import { isDeviceId, keyFileName, parseRemoteName } from "./format";
import { MemoryTransport } from "./memoryTransport";
import { encodeSegment } from "./segment";
import { isIsoInstant } from "../ledger";
import type { AnyEvent } from "../events";

export const PACKAGE_FORMAT = "ledger-sync-package";
export const PACKAGE_VERSION = 1;
export const PACKAGE_EVENTS_PER_SEGMENT = 2000;

export interface SyncPackage {
  format: typeof PACKAGE_FORMAT;
  version: number;
  deviceId: string;
  createdAt: string;
  files: { name: string; data: string }[];
}

export interface BuildPackageInput {
  deviceId: string;
  events: readonly AnyEvent[];
  key?: WriteKey;
  now?: Date;
}

export interface BuiltPackage {
  bytes: Uint8Array;
  events: number;
  encrypted: boolean;
}

export async function buildPackage(input: BuildPackageInput): Promise<BuiltPackage> {
  const createdAt = (input.now ?? new Date()).toISOString();
  const files: SyncPackage["files"] = [];
  if (input.key) {
    files.push({ name: keyFileName(input.key.keyId), data: toBase64(utf8(JSON.stringify(input.key.keyInfo))) });
  }
  for (let i = 0, seq = 1; i < input.events.length || seq === 1; i += PACKAGE_EVENTS_PER_SEGMENT, seq++) {
    const enc = await encodeSegment({
      deviceId: input.deviceId,
      seq,
      createdAt,
      events: input.events.slice(i, i + PACKAGE_EVENTS_PER_SEGMENT),
      key: input.key,
    });
    files.push({ name: enc.name, data: toBase64(enc.bytes) });
    if (input.events.length === 0) break;
  }
  const pkg: SyncPackage = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, deviceId: input.deviceId, createdAt, files };
  return { bytes: utf8(JSON.stringify(pkg)), events: input.events.length, encrypted: Boolean(input.key) };
}

export type PackageError = "invalid_json" | "wrong_format" | "unsupported_version" | "invalid_files";

export type ReadPackageResult =
  | {
      ok: true;
      deviceId: string;
      createdAt: string;
      transport: MemoryTransport;
      keyInfos: KeyInfo[];
      /** File del pacchetto con un nome non riconosciuto (né segmento né chiave): non letti. */
      ignored: number;
    }
  | { ok: false; error: PackageError };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function readPackage(bytes: Uint8Array | string): ReadPackageResult {
  let doc: unknown;
  try {
    doc = JSON.parse(typeof bytes === "string" ? bytes : fromUtf8(bytes, true));
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!isRecord(doc) || doc.format !== PACKAGE_FORMAT) return { ok: false, error: "wrong_format" };
  if (typeof doc.version !== "number" || !Number.isInteger(doc.version) || doc.version < 1) {
    return { ok: false, error: "wrong_format" };
  }
  if (doc.version > PACKAGE_VERSION) return { ok: false, error: "unsupported_version" };
  if (!isDeviceId(doc.deviceId) || !isIsoInstant(doc.createdAt) || !Array.isArray(doc.files)) {
    return { ok: false, error: "invalid_files" };
  }
  const transport = new MemoryTransport();
  const keyInfos: KeyInfo[] = [];
  let ignored = 0;
  for (const f of doc.files) {
    if (!isRecord(f) || typeof f.name !== "string" || typeof f.data !== "string") return { ok: false, error: "invalid_files" };
    const data = fromBase64(f.data);
    if (!data) return { ok: false, error: "invalid_files" };
    const kind = parseRemoteName(f.name).kind;
    // Un nome non riconosciuto non si legge: si conta e l'utente lo vede nell'esito.
    if (kind === "segment") transport.setRaw(f.name, data);
    else if (kind !== "key") ignored++;
    if (kind === "key") {
      try {
        const info = parseKeyInfo(JSON.parse(fromUtf8(data, true)));
        if (info) keyInfos.push(info);
      } catch {
        // parametri della chiave illeggibili: i segmenti cifrati resteranno da sbloccare
      }
    }
  }
  return { ok: true, deviceId: doc.deviceId, createdAt: doc.createdAt, transport, keyInfos, ignored };
}

/**
 * Vista dell'archivio per l'importazione di un pacchetto: applica eventi e quarantena ma non
 * tocca lo stato della sincronizzazione remota (segmenti visti, versioni già caricate),
 * così ciò che arriva da un file viene poi caricato anche su Drive.
 */
export function packageImportPort(local: SyncLocalPort): SyncLocalPort {
  return {
    deviceId: () => local.deviceId(),
    state: async () => ({ seen: new Set<string>(), ownLastSeq: 0 }),
    pending: async () => ({ events: [] }),
    commitIncoming: (c: IncomingCommit) =>
      local.commitIncoming({
        ...c,
        remoteKeys: [],
        markSeen: false,
        quarantine: c.quarantine.map((q) => ({ ...q, origin: "package" as const })),
      }),
    commitOutgoing: async () => undefined,
    // Serve a contare le voci (tetto) e a non duplicarle; la rivalutazione resta ai giri normali.
    quarantined: () => local.quarantined(),
    resetUploadState: async () => undefined,
    keyFor: (id) => local.keyFor(id),
    writeKey: async () => undefined,
  };
}

/** Importa un pacchetto già letto. `locked > 0` nel rapporto: serve la frase segreta. */
export function importPackage(
  pkg: Extract<ReadPackageResult, { ok: true }>,
  local: SyncLocalPort,
  now?: () => Date,
): Promise<SyncReport> {
  return runSync({ transport: pkg.transport, local: packageImportPort(local), packageImport: true, now });
}
