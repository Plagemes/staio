// La memoria delle righe dello scontrino sta nell'archivio locale delle impostazioni, come quella del codice a barre
// (`barcode.choice.*`): una riga per negozio, `receipt.memory.<negozio>`, e una generale per gli scontrini senza negozio.
// Non inizia con `ai.`, quindi entra nella copia delle impostazioni.
import {
  GENERAL_STORE_KEY,
  RECEIPT_MEMORY_PREFIX,
  dropEntry,
  emptyRow,
  entryCount,
  entryOf,
  memoryRowKey,
  normalizeStoreKey,
  readRow,
  storesToForget,
  type LoadedMemory,
  type MemoryRow,
} from "@/core/ai/receiptMemory";
import { getDb } from "@/data/db";
import { getSetting, removeSetting, setSetting } from "@/data";
import type { ReviewLine } from "./receiptEvents";
import { learnFromLines } from "./receiptLearning";

export interface MemoryStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Le chiavi che iniziano con il prefisso. */
  keys(prefix: string): Promise<string[]>;
}

export const settingsMemoryStore: MemoryStore = {
  get: (key) => getSetting(key),
  set: (key, value) => setSetting(key, value),
  remove: (key) => removeSetting(key),
  keys: async (prefix) => ((await getDb().settings.toCollection().primaryKeys()) as string[]).filter((k) => k.startsWith(prefix)),
};

/** La memoria per il negozio indicato; se l'archivio non c'è (finestra privata) si prosegue senza. */
export async function loadMemory(storeName: string, store: MemoryStore = settingsMemoryStore): Promise<LoadedMemory> {
  const storeKey = normalizeStoreKey(storeName);
  try {
    return { storeKey, row: readRow(await store.get(memoryRowKey(storeKey))) };
  } catch {
    return { storeKey, row: emptyRow() };
  }
}

/** Oltre `MAX_STORES` negozi, si dimentica quello usato meno di recente (mai la memoria generale né quello appena usato). */
async function forgetOldStores(keep: string, store: MemoryStore): Promise<void> {
  const keys = (await store.keys(RECEIPT_MEMORY_PREFIX)).filter((k) => k !== memoryRowKey(""));
  if (keys.length === 0) return;
  const stores = await Promise.all(keys.map(async (key) => ({ storeKey: key.slice(RECEIPT_MEMORY_PREFIX.length), usedAt: readRow(await store.get(key)).usedAt })));
  for (const storeKey of storesToForget(stores, keep)) await store.remove(memoryRowKey(storeKey));
}

export interface Remembered {
  /** Com'era la memoria prima dello scontrino: serve a toglierla con «Annulla». */
  before: LoadedMemory;
  after: LoadedMemory;
}

/** Impara dalle righe confermate. Non lancia: ricordare è un di più, non deve far fallire il salvataggio. */
export async function rememberReceipt(
  storeName: string,
  lines: readonly ReviewLine[],
  now: string,
  store: MemoryStore = settingsMemoryStore,
): Promise<Remembered> {
  const before = await loadMemory(storeName, store);
  const row = learnFromLines(before.row, lines, now);
  if (entryCount(row) === 0) return { before, after: before };
  // anche senza righe nuove, lo scontrino salvato conta come uso del negozio
  const next: MemoryRow = row === before.row ? { ...row, usedAt: now } : row;
  try {
    await store.set(memoryRowKey(before.storeKey), next);
    if (before.storeKey !== "") await forgetOldStores(before.storeKey, store);
  } catch {
    return { before, after: before };
  }
  return { before, after: { storeKey: before.storeKey, row: next } };
}

/** «Dimentica ciò che ho imparato per questo negozio». Restituisce la memoria tolta, per l'«Annulla». */
export async function forgetMemory(storeName: string, store: MemoryStore = settingsMemoryStore): Promise<MemoryRow> {
  const { storeKey, row } = await loadMemory(storeName, store);
  if (entryCount(row) > 0) await store.remove(memoryRowKey(storeKey));
  return row;
}

/** Rimette la memoria com'era; una memoria vuota vuol dire nessuna riga d'archivio. */
export async function restoreMemory(storeName: string, row: MemoryRow, store: MemoryStore = settingsMemoryStore): Promise<void> {
  const key = memoryRowKey(normalizeStoreKey(storeName));
  if (entryCount(row) === 0) await store.remove(key);
  else await store.set(key, row);
}

/** «Non ignorarla più»: toglie subito il ricordo «ignora sempre» di quella riga (e solo quello). */
export async function forgetIgnore(storeKey: string, lineKey: string, store: MemoryStore = settingsMemoryStore): Promise<LoadedMemory> {
  const memory = await loadMemory(storeKey === GENERAL_STORE_KEY ? "" : storeKey, store);
  const entry = entryOf(memory.row, lineKey);
  if (!entry?.ignore) return memory;
  const row = dropEntry(memory.row, lineKey);
  try {
    if (entryCount(row) === 0) await store.remove(memoryRowKey(memory.storeKey));
    else await store.set(memoryRowKey(memory.storeKey), row);
  } catch {
    return memory;
  }
  return { storeKey: memory.storeKey, row };
}
