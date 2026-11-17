// Archivio degli avvisi: un piccolo database IndexedDB separato da quello principale, così lo
// può leggere anche il service worker (public/sw.js usa lo stesso nome, lo stesso archivio e le stesse chiavi).
// Contiene le preferenze, il registro degli avvisi già mostrati e il riepilogo salvato.

import {
  normalizeLedger,
  normalizePrefs,
  type NotifyPrefs,
  type SavedSummary,
  type ShownLedger,
} from "@/core/notify";
import { APP_NAME } from "@/config";

export const NOTIFY_DB_NAME = `${APP_NAME.toLowerCase()}-notify`;
export const NOTIFY_DB_VERSION = 1;
export const NOTIFY_STORE_NAME = "kv";
export const KEY_PREFS = "prefs";
export const KEY_LEDGER = "ledger";
export const KEY_SUMMARY = "summary";

export interface NotifyStore {
  loadPrefs(): Promise<NotifyPrefs>;
  savePrefs(prefs: NotifyPrefs): Promise<void>;
  loadLedger(): Promise<ShownLedger>;
  saveLedger(ledger: ShownLedger): Promise<void>;
  loadSummary(): Promise<SavedSummary | null>;
  saveSummary(summary: SavedSummary | null): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb_error"));
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(NOTIFY_DB_NAME, NOTIFY_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(NOTIFY_STORE_NAME)) {
        request.result.createObjectStore(NOTIFY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb_open_error"));
    request.onblocked = () => reject(new Error("idb_blocked"));
  });
}

async function withStore<T>(factory: IDBFactory, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(factory);
  try {
    const tx = db.transaction(NOTIFY_STORE_NAME, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb_tx_error"));
      tx.onabort = () => reject(tx.error ?? new Error("idb_tx_abort"));
    });
    const value = await requestResult(run(tx.objectStore(NOTIFY_STORE_NAME)));
    await done;
    return value;
  } finally {
    db.close();
  }
}

function isSummary(value: unknown): value is SavedSummary {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const m = s.message as Record<string, unknown> | undefined;
  return (
    typeof s.forDay === "string" &&
    typeof s.timeZone === "string" &&
    typeof s.expiresAt === "string" &&
    typeof s.savedAt === "string" &&
    typeof m === "object" &&
    m !== null &&
    typeof m.title === "string" &&
    typeof m.body === "string" &&
    typeof m.tag === "string" &&
    typeof m.url === "string" &&
    Array.isArray(m.keys)
  );
}

/** `factory` serve ai test (un IndexedDB finto). Ogni metodo può lanciare se l'archivio non è disponibile. */
export function createNotifyStore(factory?: IDBFactory): NotifyStore {
  const idb = (): IDBFactory => {
    const f = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!f) throw new Error("idb_unavailable");
    return f;
  };
  const get = (key: string) => withStore<unknown>(idb(), "readonly", (s) => s.get(key));
  const put = async (key: string, value: unknown) => {
    await withStore(idb(), "readwrite", (s) => s.put(value, key));
  };
  return {
    async loadPrefs() {
      return normalizePrefs(await get(KEY_PREFS));
    },
    savePrefs: (prefs) => put(KEY_PREFS, prefs),
    async loadLedger() {
      return normalizeLedger(await get(KEY_LEDGER));
    },
    saveLedger: (ledger) => put(KEY_LEDGER, ledger),
    async loadSummary() {
      const value = await get(KEY_SUMMARY);
      return isSummary(value) ? value : null;
    },
    async saveSummary(summary) {
      if (summary === null) {
        await withStore(idb(), "readwrite", (s) => s.delete(KEY_SUMMARY));
      } else {
        await put(KEY_SUMMARY, summary);
      }
    },
  };
}
