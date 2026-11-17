import { liveQuery, type Observable } from "dexie";
import { canonicalStringify, sortEvents, type ValidationError } from "@/core/ledger";
import {
  mergeAllEvents,
  validateAnyEvent,
  type AllMergeConflict,
  type AnyEvent,
} from "@/core/events";
import { getDb, type LedgerDb, type StoredEvent } from "./db";

export interface RejectedEvent {
  /** Posizione nell'elenco in ingresso. */
  index: number;
  errors: ValidationError[];
}

export interface AppendResult {
  added: number;
  /** Eventi con id già presente (o ripetuto nel gruppo): ignorati, mai sovrascritti. */
  duplicates: number;
  rejected: RejectedEvent[];
}

export interface ImportResult {
  /** Eventi con un id mai visto prima. */
  added: number;
  conflicts: AllMergeConflict[];
  rejected: RejectedEvent[];
}

function strip(row: StoredEvent): AnyEvent {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { seq, ...event } = row;
  return event as AnyEvent;
}

async function lastSeq(db: LedgerDb): Promise<number> {
  const last = await db.events.orderBy("seq").last();
  return last?.seq ?? 0;
}

function splitValid(events: readonly unknown[]): {
  valid: AnyEvent[];
  rejected: RejectedEvent[];
} {
  const valid: AnyEvent[] = [];
  const rejected: RejectedEvent[] = [];
  events.forEach((event, index) => {
    const errors = validateAnyEvent(event);
    if (errors.length > 0) rejected.push({ index, errors });
    else valid.push(event as AnyEvent);
  });
  return { valid, rejected };
}

/**
 * Aggiunge eventi nuovi. Gli eventi non validi sono rifiutati con i loro errori
 * (gli altri vengono comunque scritti); un id già presente è ignorato.
 */
export async function appendEvents(
  events: readonly AnyEvent[],
): Promise<AppendResult> {
  const { valid, rejected } = splitValid(events);
  const db = getDb();
  return db.transaction("rw", db.events, async () => {
    const unique = new Map<string, AnyEvent>();
    for (const e of valid) if (!unique.has(e.id)) unique.set(e.id, e);
    const ids = [...unique.keys()];
    const existing = await db.events.bulkGet(ids);
    const fresh = ids
      .filter((_, i) => existing[i] === undefined)
      .map((id) => unique.get(id)!);
    if (fresh.length > 0) {
      let seq = await lastSeq(db);
      await db.events.bulkAdd(fresh.map((e) => ({ ...e, seq: ++seq })));
    }
    return {
      added: fresh.length,
      duplicates: valid.length - fresh.length,
      rejected,
    };
  });
}

/** Tutti gli eventi in ordine canonico (at, recordedAt, id). */
export async function getAllEvents(): Promise<AnyEvent[]> {
  return sortEvents((await getDb().events.toArray()).map(strip));
}

export interface EventsAfter {
  events: AnyEvent[];
  /** Sequenza massima dell'archivio: il cursore da usare alla prossima chiamata. */
  seq: number;
}

/** Eventi arrivati in questo archivio dopo la sequenza data (0 = tutti), in ordine di arrivo. */
export async function getEventsAfter(seq: number): Promise<EventsAfter> {
  const db = getDb();
  return db.transaction("r", db.events, async () => {
    const rows = await db.events.where("seq").above(seq).sortBy("seq");
    return {
      events: rows.map(strip),
      seq: rows.length > 0 ? rows[rows.length - 1].seq : Math.max(seq, await lastSeq(db)),
    };
  });
}

/**
 * Unisce eventi provenienti da fuori (altro dispositivo, copia di sicurezza) con
 * `mergeEvents`. Per un id già presente con contenuto diverso vince la versione
 * scelta dal libro mastro, così i dispositivi convergono; il conflitto è riportato.
 */
export async function importEvents(
  events: readonly AnyEvent[],
): Promise<ImportResult> {
  const { valid, rejected } = splitValid(events);
  const db = getDb();
  return db.transaction("rw", db.events, async () => {
    const incomingIds = [...new Set(valid.map((e) => e.id))];
    const stored = await db.events.bulkGet(incomingIds);
    const existing = stored.filter((e): e is StoredEvent => e !== undefined).map(strip);
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const merged = mergeAllEvents(existing, valid);
    const toWrite = merged.events.filter((e) => {
      const old = existingById.get(e.id);
      return old === undefined || canonicalStringify(old) !== canonicalStringify(e);
    });
    if (toWrite.length > 0) {
      let seq = await lastSeq(db);
      await db.events.bulkPut(toWrite.map((e) => ({ ...e, seq: ++seq })));
    }
    return {
      added: merged.events.filter((e) => !existingById.has(e.id)).length,
      conflicts: merged.conflicts,
      rejected,
    };
  });
}

/** Osservabile degli eventi: emette di nuovo a ogni modifica della tabella. */
export function liveEvents(): Observable<AnyEvent[]> {
  return liveQuery(() => getAllEvents());
}
