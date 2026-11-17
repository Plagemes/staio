import { generateId, type IdGenerator } from "./ids";
import type { Lot } from "./derive";
import { canonicalStringify } from "./merge";
import {
  SCHEMA_VERSION,
  type Certainty,
  type DeclareEvent,
  type EventBase,
  type Expiry,
  type LedgerEvent,
  type Location,
  type PurchaseEvent,
  type Quantity,
  type Source,
  type UpdateLotEvent,
  type VoidEvent,
} from "./types";

export interface EventFactoryOptions {
  /** Default: generatore basato su tempo + casualità. */
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  /** Dispositivo che scrive. Default: quello del nuovo evento, poi quello dell'evento bersaglio. */
  deviceId?: string;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * Evento senza i campi che `correct` sa ricavare da solo.
 * `at` manca: di default il nuovo evento eredita quello dell'evento corretto,
 * così l'ordine cronologico del libro non cambia.
 */
export type ReplacementEvent = DistributiveOmit<
  LedgerEvent,
  "id" | "at" | "recordedAt" | "deviceId" | "schemaVersion"
> &
  Partial<Pick<EventBase, "id" | "at" | "recordedAt" | "deviceId" | "schemaVersion">>;

const systemNow = () => new Date().toISOString();

/**
 * Crea un `void` che annulla `target`. Vale anche per un `void`: annullarlo lo ripristina
 * l'evento originale.
 */
export function voidEvent(
  target: Pick<LedgerEvent, "id" | "deviceId">,
  options: EventFactoryOptions = {},
): VoidEvent {
  const now = (options.now ?? systemNow)();
  return {
    id: (options.idGenerator ?? generateId)(),
    type: "void",
    at: now,
    recordedAt: now,
    deviceId: options.deviceId ?? target.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: "measured",
    source: "manual",
    targetEventId: target.id,
  };
}

/**
 * Correzione = annulla l'evento sbagliato e ne aggiunge uno nuovo.
 * Per correggere un acquisto mantenere lo stesso `lotId` nel nuovo evento:
 * quello vecchio è annullato, quindi il lotto resta uno solo.
 * Quando si corregge una creazione, i campi descrittivi (scadenza, productRef, categoria, codice a barre, prezzo, negozio)
 * sono copiati dall'evento corretto e quelli passati nella sostituzione sono ignorati: si
 * modificano solo con `updateLot` (vedi `correctLot`).
 * Lancia solo se il nuovo evento riusa l'id del vecchio (errore di chi chiama).
 */
export function correct(
  target: LedgerEvent,
  replacement: ReplacementEvent,
  options: EventFactoryOptions = {},
): [VoidEvent, LedgerEvent] {
  if (replacement.id === target.id) {
    throw new RangeError("correct: the replacement must have a different id");
  }
  const idGenerator = options.idGenerator ?? generateId;
  const now = (options.now ?? systemNow)();
  const deviceId = options.deviceId ?? replacement.deviceId ?? target.deviceId;
  const voided = voidEvent(target, {
    idGenerator,
    now: () => now,
    deviceId,
  });
  const next = {
    ...replacement,
    id: replacement.id ?? idGenerator(),
    at: replacement.at ?? target.at,
    recordedAt: replacement.recordedAt ?? now,
    deviceId,
    schemaVersion: SCHEMA_VERSION,
    replaces: target.id,
  } as LedgerEvent;
  if (isCreation(target) && isCreation(next)) {
    const rec = next as unknown as Record<string, unknown>;
    rec.productRef = target.productRef;
    if (target.category !== undefined && target.category.trim() !== "") {
      rec.category = target.category;
    } else delete rec.category;
    if (target.barcode !== undefined && target.barcode.trim() !== "") {
      rec.barcode = target.barcode;
    } else delete rec.barcode;
    if (target.expiry) rec.expiry = { date: target.expiry.date, kind: target.expiry.kind };
    else delete rec.expiry;
    const price = target.type === "purchase" ? target.priceCents : undefined;
    const store = target.type === "purchase" ? target.store : undefined;
    if (next.type === "purchase" && price !== undefined) rec.priceCents = price;
    else delete rec.priceCents;
    if (next.type === "purchase" && store !== undefined) rec.store = store;
    else delete rec.store;
  }
  return [voided, next];
}

function isCreation(e: LedgerEvent): e is PurchaseEvent | DeclareEvent {
  return e.type === "purchase" || e.type === "declare";
}

/** Modifiche a un lotto: quelle strutturali passano da una correzione, quelle descrittive da `updateLot`. */
export interface LotChanges {
  quantity?: Quantity;
  location?: Location;
  /** Istante in cui il fatto è avvenuto. */
  at?: string;
  receiptId?: string;
  note?: string;
  certainty?: Certainty;
  source?: Source;
  /** `null` cancella. */
  expiry?: Expiry | null;
  productRef?: string;
  /** `null` cancella; stringa vuota = assente. */
  category?: string | null;
  /** `null` cancella; stringa vuota = assente. */
  barcode?: string | null;
  priceCents?: number | null;
  store?: string | null;
}

export interface CorrectLotOptions extends EventFactoryOptions {
  /**
   * Stato attuale del lotto (da `derivePantry`). Se c'è, le modifiche descrittive uguali ai valori
   * attuali sono omesse. Senza, tutte quelle indicate producono un `updateLot`: confrontarle con
   * l'acquisto originale sarebbe sbagliato, perché un `updateLot` precedente può averle cambiate.
   */
  lot?: Pick<Lot, "productRef" | "category" | "barcode" | "expiry" | "priceCents" | "store">;
}

const same = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b);
const blank = (v: string | undefined | null) => (v === undefined || v === null || v.trim() === "" ? undefined : v);

/**
 * Eventi giusti per modificare un lotto a partire dal suo acquisto (o dichiarazione):
 * - cambiano quantità, luogo, `at` (o ricevuta, nota, certezza, fonte): coppia void + nuova creazione;
 * - cambiano scadenza, productRef, categoria, codice a barre, prezzo o negozio: un `updateLot` con `recordedAt` successivo;
 * - solo campi descrittivi: solo l'`updateLot`; nessuna modifica: lista vuota.
 */
export function correctLot(
  target: PurchaseEvent | DeclareEvent,
  changes: LotChanges,
  options: CorrectLotOptions = {},
): LedgerEvent[] {
  const idGenerator = options.idGenerator ?? generateId;
  const now = (options.now ?? systemNow)();
  const deviceId = options.deviceId ?? target.deviceId;
  const out: LedgerEvent[] = [];

  const structural =
    (changes.quantity !== undefined && !same(changes.quantity, target.quantity)) ||
    (changes.location !== undefined && changes.location !== target.location) ||
    (changes.at !== undefined && changes.at !== target.at) ||
    (changes.receiptId !== undefined && blank(changes.receiptId) !== blank(target.receiptId)) ||
    (changes.note !== undefined && blank(changes.note) !== blank(target.note)) ||
    (changes.certainty !== undefined && changes.certainty !== target.certainty) ||
    (changes.source !== undefined && changes.source !== target.source);

  if (structural) {
    const { id: _id, recordedAt: _rec, replaces: _rep, ...rest } = target;
    void [_id, _rec, _rep];
    const replacement = { ...rest } as Record<string, unknown>;
    for (const key of ["quantity", "location", "at", "receiptId", "note", "certainty", "source"] as const) {
      if (changes[key] !== undefined) replacement[key] = changes[key];
    }
    out.push(
      ...correct(target, replacement as unknown as ReplacementEvent, {
        idGenerator,
        now: () => now,
        deviceId,
      }),
    );
  }

  const lot = options.lot;
  const patch: UpdateLotEvent["patch"] = {};
  if (changes.productRef !== undefined && changes.productRef !== lot?.productRef) {
    patch.productRef = changes.productRef;
  }
  if (
    changes.category !== undefined &&
    (changes.category === null || changes.category.trim() !== "") &&
    !(lot && blank(changes.category) === blank(lot.category))
  ) {
    patch.category = changes.category;
  }
  if (
    changes.barcode !== undefined &&
    (changes.barcode === null || changes.barcode.trim() !== "") &&
    !(lot && blank(changes.barcode) === blank(lot.barcode))
  ) {
    patch.barcode = changes.barcode;
  }
  if (changes.expiry !== undefined && !(lot && same(changes.expiry ?? undefined, lot.expiry))) {
    patch.expiry = changes.expiry;
  }
  if (
    changes.priceCents !== undefined &&
    !(lot && (changes.priceCents ?? undefined) === lot.priceCents)
  ) {
    patch.priceCents = changes.priceCents;
  }
  if (changes.store !== undefined && !(lot && blank(changes.store) === blank(lot.store))) {
    patch.store = changes.store;
  }
  if (Object.keys(patch).length > 0) {
    const ms = Date.parse(now);
    // Un millisecondo dopo la correzione: l'updateLot deve risultare registrato per ultimo.
    const later = Number.isNaN(ms) ? now : new Date(ms + 1).toISOString();
    out.push({
      id: idGenerator(),
      type: "updateLot",
      at: now,
      recordedAt: later,
      deviceId,
      schemaVersion: SCHEMA_VERSION,
      certainty: changes.certainty ?? "measured",
      source: changes.source ?? "manual",
      lotId: target.lotId,
      patch,
    });
  }
  return out;
}
