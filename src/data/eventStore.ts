import { liveQuery, type Observable } from "dexie";
import { canonicalStringify, generateId, sortEvents, type ValidationError } from "@/core/ledger";
import {
  mergeAllEvents,
  OPERATION_ID_FIELD,
  operationIdOf,
  validateAnyEvent,
  type AllMergeConflict,
  type AnyEvent,
} from "@/core/events";
// non è ancora tra le esportazioni di `@/core/events`
import { stampOperationId } from "@/core/events/operation";
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
 * Una chiamata è una sola azione: tutti i suoi eventi ricevono lo stesso identificativo di operazione (`opId`), nuovo,
 * con cui «Ultime azioni» li tiene insieme. Lo riceve anche un evento che ne porta già uno: chi corregge copia i campi
 * dell'evento di prima, e l'identificativo copiato è dell'azione di prima, non di questa. Chi importa eventi scritti
 * altrove (`importEvents`) non lo tocca.
 */
export async function appendEvents(
  events: readonly AnyEvent[],
): Promise<AppendResult> {
  const { valid, rejected } = splitValid(events);
  const db = getDb();
  return db.transaction("rw", db.events, async () => {
    const unique = new Map<string, AnyEvent>();
    for (const e of stampOperationId(valid, generateId())) if (!unique.has(e.id)) unique.set(e.id, e);
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

/** Due versioni dello stesso evento che differiscono solo perché una porta l'`opId` e l'altra no. */
function sameButOperationId(a: AnyEvent, b: AnyEvent): boolean {
  const [ida, idb] = [operationIdOf(a), operationIdOf(b)];
  if (ida === idb || (ida !== undefined && idb !== undefined)) return false;
  const bare = (e: AnyEvent): string => {
    const { [OPERATION_ID_FIELD]: _opId, ...rest } = e as AnyEvent & Record<string, unknown>;
    void _opId;
    return canonicalStringify(rest);
  };
  return bare(a) === bare(b);
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
    // Lo stesso evento con e senza `opId` non è un conflitto: è lo stesso evento, e vale la versione che lo porta.
    const upgraded = new Set<string>();
    const incoming = valid.map((e) => {
      const old = existingById.get(e.id);
      if (!old || !sameButOperationId(e, old)) return e;
      if (operationIdOf(old) !== undefined) return old;
      upgraded.add(e.id);
      return e;
    });
    const merged = mergeAllEvents(
      existing.filter((e) => !upgraded.has(e.id)),
      incoming,
    );
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
