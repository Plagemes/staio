// Operazioni di sincronizzazione sull'archivio del dispositivo.
import { liveQuery, type Observable } from "dexie";
import {
  buildPackage,
  fromUtf8,
  importPackage,
  parseKeyInfo,
  parseRemoteName,
  readPackage,
  runSync,
  type BuiltPackage,
  type KeyInfo,
  type QuarantineEntry,
  type ReadPackageResult,
  type SyncLocalPort,
  type SyncReport,
  type SyncTransport,
} from "@/core/sync";
import { getDb } from "../db";
import { getDeviceId } from "../deviceId";
import { getAllEvents } from "../eventStore";
import { getKeyStatus, type KeyStatus } from "./keys";
import { createDexieSyncPort, listQuarantine } from "./localPort";

export type SyncKind = "drive" | "file";

export interface StoredReport extends SyncReport {
  kind: SyncKind;
}

const LAST = "sync:last:";
const LOCK_NAME = "ledger-sync";

/** Una sola sincronizzazione alla volta tra le schede aperte dello stesso dispositivo. */
async function withLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks && typeof locks.request === "function") return locks.request(LOCK_NAME, run) as Promise<T>;
  return run();
}

async function saveReport(kind: SyncKind, report: SyncReport): Promise<StoredReport> {
  const stored: StoredReport = { ...report, kind };
  await getDb().syncMeta.put({ key: LAST + kind, value: stored, updatedAt: report.finishedAt });
  return stored;
}

export interface SyncRunOptions {
  /** Drive: obbligatoria. */
  requireEncryption?: boolean;
  now?: () => Date;
}

export function syncWith(transport: SyncTransport, kind: SyncKind, options: SyncRunOptions = {}): Promise<StoredReport> {
  return withLock(async () => {
    const report = await runSync({
      transport,
      local: createDexieSyncPort(),
      requireEncryption: options.requireEncryption,
      now: options.now,
    });
    return saveReport(kind, report);
  });
}

/** Parametri pubblici delle chiavi presenti sul remoto (per sbloccarle con la frase). */
export async function listRemoteKeyInfos(transport: SyncTransport): Promise<KeyInfo[]> {
  const out: KeyInfo[] = [];
  for (const e of await transport.list()) {
    if (parseRemoteName(e.name).kind !== "key") continue;
    const file = await transport.get(e.name);
    if (!file) continue;
    try {
      const info = parseKeyInfo(JSON.parse(fromUtf8(file.bytes, true)));
      if (info) out.push(info);
    } catch {
      // file illeggibile: ignorato
    }
  }
  return out;
}

/** Pacchetto con tutti gli eventi del dispositivo, cifrato se c'è la chiave e `encrypt` è vero. */
export async function exportSyncPackage(options: { encrypt: boolean }): Promise<BuiltPackage> {
  const port = createDexieSyncPort();
  const [deviceId, events, key] = await Promise.all([getDeviceId(), getAllEvents(), port.writeKey()]);
  if (options.encrypt && !key) throw new Error("no_key");
  return buildPackage({ deviceId, events, key: options.encrypt ? key : undefined });
}

export function readSyncPackage(text: string | Uint8Array): ReadPackageResult {
  return readPackage(text);
}

/** `readKeys`: chiavi aperte solo per questo pacchetto (vedi `unlockPackageKeys`). */
export function importSyncPackage(
  pkg: Extract<ReadPackageResult, { ok: true }>,
  readKeys: ReadonlyMap<string, CryptoKey> = new Map(),
): Promise<StoredReport> {
  return withLock(async () => {
    const port = createDexieSyncPort();
    const local: SyncLocalPort = { ...port, keyFor: async (id) => readKeys.get(id) ?? port.keyFor(id) };
    return saveReport("file", await importPackage(pkg, local));
  });
}

export interface SyncOverview {
  deviceId: string | undefined;
  drive: StoredReport | undefined;
  file: StoredReport | undefined;
  quarantine: QuarantineEntry[];
  keys: KeyStatus;
}

async function readOverview(): Promise<SyncOverview> {
  const db = getDb();
  const [drive, file, quarantine, keys, device] = await Promise.all([
    db.syncMeta.get(LAST + "drive"),
    db.syncMeta.get(LAST + "file"),
    listQuarantine(),
    getKeyStatus(),
    db.settings.get("deviceId"),
  ]);
  return {
    deviceId: typeof device?.value === "string" ? device.value : undefined,
    drive: drive?.value as StoredReport | undefined,
    file: file?.value as StoredReport | undefined,
    quarantine,
    keys,
  };
}

export function liveSyncOverview(): Observable<SyncOverview> {
  return liveQuery(readOverview);
}
