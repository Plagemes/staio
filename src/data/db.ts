import Dexie, { type EntityTable } from "dexie";
import { sortEvents } from "@/core/ledger";
import type { AnyEvent } from "@/core/events";

/** Nome tecnico e stabile: cambiarlo equivarrebbe a perdere i dati degli utenti. */
export const DB_NAME = "ledger-local";

export interface SettingRow {
  key: string;
  value: unknown;
}

/** Riservata alla sincronizzazione futura (cursori, ultimo scambio per dispositivo). */
export interface SyncMetaRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Schema versione 1. Non va modificato: per cambiare lo schema si aggiunge
 * una nuova `.version(n)` in `LedgerDb`, con eventuale `.upgrade()`, lasciando intatta questa.
 * `lotId` è indicizzato solo dove presente: gli eventi senza lotId (void, diario) non entrano nell'indice.
 */
export const SCHEMA_V1 = {
  events: "id, at, type, lotId, recordedAt",
  settings: "key",
  syncMeta: "key",
} as const;

/** Schema versione 2: aggiunge `seq`, numero di arrivo locale (non fa parte dell'evento). */
export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  events: "id, at, type, lotId, recordedAt, seq",
} as const;

/** Schema versione 3: aggiunge la memoria dei prodotti letti dal codice a barre. */
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  products: "barcode",
} as const;

export interface ProductRecord {
  barcode: string;
  /** Istante ISO 8601 UTC del recupero. */
  fetchedAt: string;
  /** Contenuto opaco per l'archivio. */
  data: unknown;
}

/** Schema versione 4: indice su `mealId` per i pasti del diario (e i consumi collegati). */
export const SCHEMA_V4 = {
  ...SCHEMA_V3,
  events: "id, at, type, lotId, recordedAt, seq, mealId",
} as const;

/** Evento come salvato: il contenuto più la sequenza di arrivo in questo archivio. */
export type StoredEvent = AnyEvent & { seq: number };

export class LedgerDb extends Dexie {
  events!: EntityTable<StoredEvent, "id">;
  settings!: EntityTable<SettingRow, "key">;
  syncMeta!: EntityTable<SyncMetaRow, "key">;
  products!: EntityTable<ProductRecord, "barcode">;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        const table = tx.table("events");
        const all = (await table.toArray()) as AnyEvent[];
        const rows = sortEvents(all).map((e, i) => ({ ...e, seq: i + 1 }));
        if (rows.length > 0) await table.bulkPut(rows);
      });
    this.version(3).stores(SCHEMA_V3);
    this.version(4).stores(SCHEMA_V4);
  }
}

let instance: LedgerDb | null = null;

/** Apertura pigra: importare il modulo non tocca IndexedDB (utile con il rendering lato server). */
export function getDb(): LedgerDb {
  if (!instance) instance = new LedgerDb();
  return instance;
}

/** Chiude la connessione; la prossima chiamata a `getDb` ne apre una nuova. */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
