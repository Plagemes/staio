// Frase segreta: si usa per ricavare la chiave e poi si dimentica. Sul dispositivo resta solo
// la chiave principale come CryptoKey non estraibile (nessuno, nemmeno l'app, può leggerla).
//
// Tre azioni distinte, perché un errore di battitura non deve mai creare in silenzio una chiave
// nuova: `unlockPassphrase` verifica la frase contro le chiavi esistenti (remote e locali);
// `createPassphrase` crea una chiave solo se non ne esiste nessuna, con la frase scritta due
// volte; `changePassphrase` è il cambio esplicito, con la frase attuale.
import {
  SyncCryptoError,
  checkPassphrase,
  createKey,
  currentKeyId,
  normalizePassphrase,
  unlockKey,
  type CreateKeyOptions,
  type KeyInfo,
  type UnlockOptions,
} from "@/core/sync";
import { getDb } from "../db";
import { KEY, WRITE_KEY, type StoredKey } from "./localPort";

export interface PassphraseOptions {
  /** Solo per i test. */
  create?: CreateKeyOptions;
  unlock?: UnlockOptions;
}

export interface PassphraseResult {
  /** Chiave con cui questo dispositivo cifrerà d'ora in poi. */
  keyId: string;
  /** Chiavi esistenti che questa frase non apre (un altro dispositivo usa una frase diversa). */
  unmatched: number;
}

async function storedKeys(): Promise<StoredKey[]> {
  const rows = await getDb().syncMeta.where("key").startsWith(KEY).toArray();
  return rows.map((r) => r.value as StoredKey).filter((k) => k && k.keyInfo && k.key);
}

async function storeKeys(keys: StoredKey[], writeKeyId: string): Promise<void> {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  await db.transaction("rw", db.syncMeta, async () => {
    await db.syncMeta.bulkPut([
      ...keys.map((k) => ({ key: KEY + k.keyInfo.keyId, value: k, updatedAt })),
      { key: WRITE_KEY, value: writeKeyId, updatedAt },
    ]);
  });
}

function uniqueInfos(infos: readonly KeyInfo[]): KeyInfo[] {
  return [...new Map(infos.map((k) => [k.keyId, k])).values()].sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
}

async function openAll(passphrase: string, infos: readonly KeyInfo[], options: PassphraseOptions) {
  const opened: StoredKey[] = [];
  let unmatched = 0;
  for (const keyInfo of infos) {
    try {
      opened.push({ keyInfo, key: await unlockKey(passphrase, keyInfo, options.unlock) });
    } catch (e) {
      if (e instanceof SyncCryptoError && e.code === "wrong_passphrase") unmatched++;
      else throw e;
    }
  }
  return { opened, unmatched };
}

function assertConfirmed(passphrase: string, confirmation: string): void {
  if (checkPassphrase(passphrase)) throw new SyncCryptoError("passphrase_too_short");
  if (normalizePassphrase(passphrase) !== normalizePassphrase(confirmation)) throw new SyncCryptoError("passphrase_mismatch");
}

/**
 * Verifica la frase contro le chiavi esistenti: quelle remote passate e quelle già sul
 * dispositivo. Nessuna chiave da nessuna parte: `no_existing_key`. Nessuna aperta:
 * `wrong_passphrase`, e nulla viene scritto. Con chiavi remote si scrive con una di quelle.
 */
export async function unlockPassphrase(
  passphrase: string,
  remote: readonly KeyInfo[],
  options: PassphraseOptions = {},
): Promise<PassphraseResult> {
  const local = await storedKeys();
  const remoteIds = new Set(remote.map((k) => k.keyId));
  const candidates = uniqueInfos([...remote, ...local.map((k) => k.keyInfo)]);
  if (candidates.length === 0) throw new SyncCryptoError("no_existing_key");
  const { opened, unmatched } = await openAll(passphrase, candidates, options);
  if (opened.length === 0) throw new SyncCryptoError("wrong_passphrase");
  const ids = opened.map((k) => k.keyInfo.keyId).sort();
  const onRemote = ids.filter((id) => remoteIds.has(id));
  const current = (await getDb().syncMeta.get(WRITE_KEY))?.value;
  const pool = onRemote.length > 0 ? onRemote : ids;
  // La chiave corrente del remoto, se la frase la apre: è l'unica con cui la sincronizzazione scrive.
  const remoteCurrent = currentKeyId(remote);
  // Si scrive già con la chiave corrente (o non si sa quale sia): una frase in più dà solo lettura.
  const keepCurrent =
    typeof current === "string" &&
    local.some((k) => k.keyInfo.keyId === current) &&
    (remote.length === 0 || current === remoteCurrent);
  const writeKeyId = keepCurrent
    ? current
    : remoteCurrent !== undefined && ids.includes(remoteCurrent)
      ? remoteCurrent
      : typeof current === "string" && pool.includes(current)
        ? current
        : pool[0];
  await storeKeys(opened, writeKeyId);
  return { keyId: writeKeyId, unmatched };
}

/**
 * Chiavi per leggere un pacchetto su file, solo per quell'importazione: non si salvano, non
 * cambiano la chiave di scrittura e quindi non finiscono mai su Drive.
 */
export async function unlockPackageKeys(
  passphrase: string,
  keyInfos: readonly KeyInfo[],
  options: PassphraseOptions = {},
): Promise<ReadonlyMap<string, CryptoKey>> {
  const infos = uniqueInfos(keyInfos);
  if (infos.length === 0) throw new SyncCryptoError("no_existing_key");
  const { opened } = await openAll(passphrase, infos, options);
  if (opened.length === 0) throw new SyncCryptoError("wrong_passphrase");
  return new Map(opened.map((k) => [k.keyInfo.keyId, k.key]));
}

/** Prima chiave in assoluto: solo se non ne esiste nessuna, né remota né locale. */
export async function createPassphrase(
  passphrase: string,
  confirmation: string,
  remote: readonly KeyInfo[],
  options: PassphraseOptions = {},
): Promise<PassphraseResult> {
  if (remote.length > 0 || (await storedKeys()).length > 0) throw new SyncCryptoError("key_exists");
  assertConfirmed(passphrase, confirmation);
  const { keyInfo, key } = await createKey(passphrase, options.create);
  await storeKeys([{ keyInfo, key }], keyInfo.keyId);
  return { keyId: keyInfo.keyId, unmatched: 0 };
}

/**
 * Cambio esplicito: la frase attuale deve aprire almeno una chiave esistente. La chiave nuova
 * diventa quella di scrittura; le vecchie restano per leggere ciò che è già stato scritto.
 */
export async function changePassphrase(
  current: string,
  next: string,
  confirmation: string,
  remote: readonly KeyInfo[],
  options: PassphraseOptions = {},
): Promise<PassphraseResult> {
  const candidates = uniqueInfos([...remote, ...(await storedKeys()).map((k) => k.keyInfo)]);
  if (candidates.length === 0) throw new SyncCryptoError("no_existing_key");
  const { opened } = await openAll(current, candidates, options);
  if (opened.length === 0) throw new SyncCryptoError("wrong_passphrase");
  assertConfirmed(next, confirmation);
  const { keyInfo, key } = await createKey(next, options.create);
  await storeKeys([...opened, { keyInfo, key }], keyInfo.keyId);
  return { keyId: keyInfo.keyId, unmatched: 0 };
}

export interface KeyStatus {
  /** C'è una chiave per cifrare ciò che si carica. */
  ready: boolean;
  keyIds: string[];
}

export async function getKeyStatus(): Promise<KeyStatus> {
  const db = getDb();
  const ids = ((await db.syncMeta.where("key").startsWith(KEY).primaryKeys()) as string[]).map((k) => k.slice(KEY.length));
  const current = (await db.syncMeta.get(WRITE_KEY))?.value;
  return { ready: typeof current === "string" && ids.includes(current), keyIds: ids.sort() };
}

/** Toglie le chiavi da questo dispositivo. I dati non cambiano. */
export async function forgetKeys(): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.syncMeta, async () => {
    const keys = (await db.syncMeta.where("key").startsWith(KEY).primaryKeys()) as string[];
    await db.syncMeta.bulkDelete([...keys, WRITE_KEY]);
  });
}
