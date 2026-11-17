// Archivio locale della sincronizzazione sopra Dexie.
//
// Lo stato sta nella tabella `syncMeta`, già prevista dallo schema v1 per questo scopo: niente
// modifiche allo schema, «Cancella tutti i dati» lo toglie insieme al resto, e soprattutto
// l'applicazione degli eventi di un segmento e la nota "segmento visto" stanno nella stessa
// transazione. Chiavi:
//   sync:state          { ownLastSeq, cursor }
//   sync:seen:<nome>    segmento già elaborato
//   sync:remote:<chiave> versione di evento già presente sul remoto (`eventKey`)
//   sync:q:<id>         voce di quarantena
//   sync:key:<id>       chiave principale non estraibile e i suoi parametri pubblici
//   sync:writeKey       id della chiave con cui cifrare
//   sync:last:<tipo>    ultimo esito per trasporto
import { eventKeys, type IncomingCommit, type KeyInfo, type OutgoingCommit, type QuarantineEntry, type SyncLocalPort, type WriteKey } from "@/core/sync";
import { getDb } from "../db";
import { getDeviceId } from "../deviceId";
import { getEventsAfter, importEvents } from "../eventStore";

export const SYNC_PREFIX = "sync:";
const STATE = "sync:state";
const SEEN = "sync:seen:";
const REMOTE = "sync:remote:";
export const QUARANTINE = "sync:q:";
export const KEY = "sync:key:";
export const WRITE_KEY = "sync:writeKey";

interface SyncStateValue {
  ownLastSeq: number;
  cursor: number;
  uploadKeyId: string | null | undefined;
}

export interface StoredKey {
  keyInfo: KeyInfo;
  key: CryptoKey;
}

const nowIso = () => new Date().toISOString();

async function readState(): Promise<SyncStateValue> {
  const v = (await getDb().syncMeta.get(STATE))?.value as Partial<SyncStateValue> | undefined;
  return {
    ownLastSeq: typeof v?.ownLastSeq === "number" ? v.ownLastSeq : 0,
    cursor: typeof v?.cursor === "number" ? v.cursor : 0,
    uploadKeyId: typeof v?.uploadKeyId === "string" || v?.uploadKeyId === null ? v.uploadKeyId : undefined,
  };
}

async function keysWithPrefix(prefix: string): Promise<string[]> {
  return (await getDb().syncMeta.where("key").startsWith(prefix).primaryKeys()) as string[];
}

export async function readStoredKey(keyId: string): Promise<StoredKey | undefined> {
  const v = (await getDb().syncMeta.get(KEY + keyId))?.value as StoredKey | undefined;
  return v && v.key && v.keyInfo ? v : undefined;
}

/** Svuota la quarantena su richiesta dell'utente. Restituisce quante voci sono state tolte. */
export async function clearQuarantine(): Promise<number> {
  const db = getDb();
  return db.transaction("rw", db.syncMeta, async () => {
    const keys = (await db.syncMeta.where("key").startsWith(QUARANTINE).primaryKeys()) as string[];
    await db.syncMeta.bulkDelete(keys);
    return keys.length;
  });
}

export async function listQuarantine(): Promise<QuarantineEntry[]> {
  const rows = await getDb().syncMeta.where("key").startsWith(QUARANTINE).toArray();
  return rows.map((r) => r.value as QuarantineEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function createDexieSyncPort(): SyncLocalPort {
  return {
    deviceId: () => getDeviceId(),

    async state() {
      const [st, seen] = await Promise.all([readState(), keysWithPrefix(SEEN)]);
      return { ownLastSeq: st.ownLastSeq, uploadKeyId: st.uploadKeyId, seen: new Set(seen.map((k) => k.slice(SEEN.length))) };
    },

    async pending() {
      const { cursor } = await readState();
      const { events, seq } = await getEventsAfter(cursor);
      const keys = await eventKeys(events);
      const rows = await getDb().syncMeta.bulkGet(keys.map((k) => REMOTE + k));
      return { events: events.filter((_, i) => rows[i] === undefined), cursor: seq };
    },

    async commitIncoming(c: IncomingCommit) {
      const db = getDb();
      return db.transaction("rw", [db.events, db.syncMeta], async () => {
        const res = c.events.length > 0 ? await importEvents(c.events) : undefined;
        const updatedAt = nowIso();
        await db.syncMeta.bulkPut([
          ...c.remoteKeys.map((k) => ({ key: REMOTE + k, value: true, updatedAt })),
          ...c.quarantine.map((q) => ({ key: QUARANTINE + q.id, value: q, updatedAt })),
          ...(c.markSeen ? [{ key: SEEN + c.segment, value: true, updatedAt }] : []),
        ]);
        if (c.release.length > 0) await db.syncMeta.bulkDelete(c.release.map((id) => QUARANTINE + id));
        return { added: res?.added ?? 0, conflicts: res?.conflicts.length ?? 0 };
      });
    },

    async commitOutgoing(c: OutgoingCommit) {
      const db = getDb();
      await db.transaction("rw", db.syncMeta, async () => {
        const st = await readState();
        const updatedAt = nowIso();
        await db.syncMeta.bulkPut([
          ...c.remoteKeys.map((k) => ({ key: REMOTE + k, value: true, updatedAt })),
          ...(c.segment ? [{ key: SEEN + c.segment, value: true, updatedAt }] : []),
          {
            key: STATE,
            value: {
              ownLastSeq: Math.max(st.ownLastSeq, c.seq),
              cursor: c.cursor !== undefined ? Math.max(st.cursor, c.cursor) : st.cursor,
              uploadKeyId: c.keyId !== undefined ? c.keyId : st.uploadKeyId,
            },
            updatedAt,
          },
        ]);
      });
    },

    quarantined: () => listQuarantine(),

    async resetUploadState() {
      const db = getDb();
      await db.transaction("rw", db.syncMeta, async () => {
        const keys = [...(await keysWithPrefix(SEEN)), ...(await keysWithPrefix(REMOTE))];
        await db.syncMeta.bulkDelete([...keys, STATE]);
      });
    },

    async keyFor(keyId: string) {
      return (await readStoredKey(keyId))?.key;
    },

    async writeKey(): Promise<WriteKey | undefined> {
      const id = (await getDb().syncMeta.get(WRITE_KEY))?.value;
      if (typeof id !== "string") return undefined;
      const stored = await readStoredKey(id);
      return stored ? { keyId: id, key: stored.key, keyInfo: stored.keyInfo } : undefined;
    },
  };
}
