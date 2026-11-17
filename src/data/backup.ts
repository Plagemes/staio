import { isConfirmationEvent, validateConfirmationEvent } from "@/core/allergens";
import type { AnyEvent } from "@/core/events";
import { getDb } from "./db";
import { getDeviceId } from "./deviceId";
import { getAllEvents, importEvents, type ImportResult } from "./eventStore";

export const BACKUP_FORMAT = "ledger-backup";
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  deviceId: string;
  events: AnyEvent[];
}

export type ImportBackupResult =
  | ({
      ok: true;
      /**
       * Quante conferme di allergeni (date in precedenza, anche su un altro dispositivo) contiene la copia. Assente se zero.
       * Il ripristino le porta dentro senza un gesto dell'utente: l'esito lo dice, perché le riguardi in «Obiettivi».
       */
      allergenConfirmations?: number;
    } & ImportResult)
  | { ok: false; error: string };

export async function exportBackup(): Promise<Backup> {
  const [events, deviceId] = await Promise.all([getAllEvents(), getDeviceId()]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId,
    events,
  };
}

/** Accetta il testo JSON o l'oggetto già letto. Non lancia: gli errori di formato sono nel risultato. */
export async function importBackup(json: unknown): Promise<ImportBackupResult> {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "not_an_object" };
  }
  const b = data as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) return { ok: false, error: "wrong_format" };
  if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1) {
    return { ok: false, error: "invalid_version" };
  }
  if (b.version > BACKUP_VERSION) return { ok: false, error: "unsupported_version" };
  if (!Array.isArray(b.events)) return { ok: false, error: "invalid_events" };
  const events = b.events as AnyEvent[];
  const confirmations = events.filter(
    (e) => isConfirmationEvent(e) && e.action === "confirm" && validateConfirmationEvent(e).length === 0,
  ).length;
  const result = await importEvents(events);
  return { ok: true, ...result, ...(confirmations > 0 ? { allergenConfirmations: confirmations } : {}) };
}

/** Cancella tutti i dati locali, identità del dispositivo compresa. */
export async function wipeAll(): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.events, db.settings, db.syncMeta, db.products], async () => {
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.syncMeta.clear(),
      db.products.clear(),
    ]);
  });
}
