import {
  canonicalStringify,
  groupById,
  sortEvents,
  type MergeConflict,
} from "./merge";
import { instantMs } from "./time";
import {
  isPantryEvent,
  worseCertainty,
  type Certainty,
  type DiscardReason,
  type EventType,
  type DeclareEvent,
  type Expiry,
  type LedgerEvent,
  type Location,
  type Pieces,
  type PurchaseEvent,
  type Unit,
  type VoidEvent,
} from "./types";
import { validateEvent, type ValidationError } from "./validate";

export type AnomalyCode =
  /** Voce non valida, senza id utilizzabile, non-oggetto o non serializzabile. */
  | "invalid_event"
  /** `asOf` non è un istante ISO UTC valido: nessuno stato calcolato. */
  | "invalid_as_of"
  /** Stesso id con contenuti diversi (ne è stato scelto uno). */
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle"
  | "unknown_lot"
  /**
   * Avviso: l'evento ha `at` anteriore alla creazione del suo lotto (es. orologi sfasati).
   * L'evento è comunque applicato, come avvenuto alla creazione.
   */
  | "event_before_lot"
  | "duplicate_lot"
  | "unit_mismatch"
  | "over_consumption";

export interface Anomaly {
  code: AnomalyCode;
  eventId?: string;
  lotId?: string;
  targetEventId?: string;
  /** Per `over_consumption`: quantità richiesta e quantità disponibile. */
  requested?: number;
  available?: number;
  /** Per `unit_mismatch`. */
  expectedUnit?: Unit;
  actualUnit?: Unit;
  /** Per `invalid_event`. */
  errors?: ValidationError[];
}

export type LotEventType = Exclude<EventType, "void">;

export interface LotHistoryEntry {
  eventId: string;
  type: LotEventType;
  at: string;
  certainty: Certainty;
  /** Variazione effettiva della quantità rimasta, nell'unità del lotto (consumi negativi). */
  quantityDelta?: number;
  reason?: DiscardReason;
  /** La quantità richiesta superava quella rimasta: applicato solo il disponibile. */
  clamped?: true;
}

export interface Lot {
  lotId: string;
  productRef: string;
  /** Categoria dell'alimento (stringa libera), se nota. */
  category?: string;
  /** Codice a barre del prodotto (solo cifre, 8-14), se noto. */
  barcode?: string;
  /** Pezzi dentro la confezione, se dichiarati alla creazione. */
  pieces?: Pieces;
  origin: "purchase" | "declare";
  status: "active" | "finished";
  unit: Unit;
  initial: number;
  remaining: number;
  /** Totali effettivamente applicati, nell'unità del lotto. */
  consumed: number;
  discarded: number;
  gifted: number;
  location: Location;
  createdAt: string;
  finishedAt?: string;
  openedAt?: string;
  expiry?: Expiry;
  /** Ultimo ingresso nel freezer / ultima uscita dal freezer. */
  frozenAt?: string;
  thawedAt?: string;
  /** Prezzo totale del lotto, in centesimi. */
  priceCents?: number;
  store?: string;
  receiptId?: string;
  initialCertainty: Certainty;
  /** Certezza della quantità rimasta: peggiora a ogni uscita stimata, si azzera con un riallineamento. */
  remainingCertainty: Certainty;
  priceCertainty?: Certainty;
  /** Eventi applicati, nell'ordine di applicazione. */
  history: LotHistoryEntry[];
}

export interface PantryState {
  /** Ordinati per data di creazione e poi per `lotId`. Include i lotti finiti. */
  lots: Lot[];
  anomalies: Anomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

export interface DerivePantryOptions {
  /** Considera solo gli eventi con `at` fino a questo istante incluso (stato "a quel momento"). */
  asOf?: string;
}

const EPSILON = 1e-9;
// Evita residui come 0.30000000000000004 che impedirebbero di arrivare a zero.
const norm = (n: number): number => Math.round(n * 1e9) / 1e9;

function resolveVoids(
  events: readonly LedgerEvent[],
  knownIds: ReadonlySet<string>,
  anomalies: Anomaly[],
): Set<string> {
  const voids = new Map<string, VoidEvent>();
  for (const e of events) if (e.type === "void") voids.set(e.id, e);

  // Ogni void ha un solo bersaglio: seguendo i bersagli i cicli sono semplici.
  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const start of voids.keys()) {
    const position = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && voids.has(cur) && !done.has(cur)) {
      const seen = position.get(cur);
      if (seen !== undefined) {
        for (const id of path.slice(seen)) cyclic.add(id);
        break;
      }
      position.set(cur, path.length);
      path.push(cur);
      cur = voids.get(cur)!.targetEventId;
    }
    for (const id of path) done.add(id);
  }

  const effective: VoidEvent[] = [];
  for (const v of voids.values()) {
    if (cyclic.has(v.id)) {
      anomalies.push({ code: "void_cycle", eventId: v.id, targetEventId: v.targetEventId });
    } else {
      effective.push(v);
      if (!knownIds.has(v.targetEventId)) {
        anomalies.push({
          code: "void_target_missing",
          eventId: v.id,
          targetEventId: v.targetEventId,
        });
      }
    }
  }

  // Un void è attivo se nessun void attivo lo annulla: si risolve dalle foglie verso l'alto.
  const incoming = new Map<string, VoidEvent[]>();
  for (const v of effective) {
    const list = incoming.get(v.targetEventId);
    if (list) list.push(v);
    else incoming.set(v.targetEventId, [v]);
  }
  const pending = new Map<string, number>();
  const queue: VoidEvent[] = [];
  for (const v of effective) {
    const n = incoming.get(v.id)?.length ?? 0;
    pending.set(v.id, n);
    if (n === 0) queue.push(v);
  }
  const active = new Map<string, boolean>();
  const voided = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    const isActive = !(incoming.get(v.id) ?? []).some((s) => active.get(s.id));
    active.set(v.id, isActive);
    if (isActive) voided.add(v.targetEventId);
    const left = pending.get(v.targetEventId);
    if (left !== undefined) {
      pending.set(v.targetEventId, left - 1);
      if (left - 1 === 0) queue.push(voids.get(v.targetEventId)!);
    }
  }
  return voided;
}

interface Candidate {
  recordedMs: number;
  id: string;
}
type Winners = Partial<
  Record<"productRef" | "category" | "barcode" | "expiry" | "priceCents" | "store", Candidate>
>;

// Regola dei campi descrittivi (scadenza, productRef, categoria, codice a barre, prezzo, negozio): si modificano solo con
// `updateLot`; vince l'ultima scrittura per (recordedAt, id), non per `at`. Una creazione
// sostitutiva (`replaces`) non li rivendica mai: eredita valori e timbri della creazione
// d'origine. Limiti noti:
// - conta l'orologio di chi scrive: se un telefono ha l'ora sbagliata di ore o giorni, una sua
//   scrittura "nel futuro" prevale su una correzione successiva fatta da un altro telefono,
//   finché non se ne registra una con `recordedAt` ancora maggiore;
// - se l'evento sostituito non è ancora arrivato (sincronizzazione parziale) la sostitutiva usa
//   i propri valori e il proprio timbro: lo stato è transitorio e si sistema all'arrivo dell'evento.
const beats = (c: Candidate, current: Candidate | undefined): boolean =>
  current === undefined ||
  c.recordedMs > current.recordedMs ||
  (c.recordedMs === current.recordedMs && c.id > current.id);

type CreationEvent = PurchaseEvent | DeclareEvent;

/** Nodi che stanno su un ciclo del grafo `da -> a` (ogni nodo ha al più un successore). */
function cycleNodes(next: ReadonlyMap<string, string>): Set<string> {
  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const start of next.keys()) {
    const position = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && !done.has(cur)) {
      const seen = position.get(cur);
      if (seen !== undefined) {
        for (const id of path.slice(seen)) cyclic.add(id);
        break;
      }
      position.set(cur, path.length);
      path.push(cur);
      cur = next.get(cur);
    }
    for (const id of path) done.add(id);
  }
  return cyclic;
}

const isBlank = (v: string | undefined): boolean => v === undefined || v.trim() === "";

function safeValidate(e: unknown): ValidationError[] {
  try {
    return validateEvent(e);
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

function safeKey(e: unknown): string {
  try {
    return canonicalStringify(e);
  } catch {
    return "";
  }
}

/**
 * Per un evento con `type` stringa non della dispensa: il suo id (o "" se manca). `undefined` se
 * l'evento va trattato come della dispensa (anche se malformato, es. senza `type`).
 */
function foreignEvent(item: unknown): string | undefined {
  try {
    if (typeof item !== "object" || item === null) return undefined;
    const { type, id } = item as { type?: unknown; id?: unknown };
    if (typeof type !== "string" || isPantryEvent(item)) return undefined;
    return typeof id === "string" ? id : "";
  } catch {
    return undefined;
  }
}

function unidentifiableAnomaly(item: unknown): Anomaly {
  let errors = safeValidate(item);
  if (errors.length === 0) errors = [{ path: "", code: "unserializable" }];
  let eventId: string | undefined;
  try {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.length > 0) eventId = id;
  } catch {
    eventId = undefined;
  }
  return { code: "invalid_event", ...(eventId !== undefined ? { eventId } : {}), errors };
}

/**
 * Riduzione deterministica del libro mastro nella dispensa calcolata.
 * Il risultato dipende solo dall'insieme di eventi (non dall'ordine né dai duplicati in ingresso).
 * Non lancia mai: le incoerenze (tipiche dell'unione tra dispositivi) finiscono in `anomalies`.
 *
 * Due passate: prima nascono i lotti dagli eventi di creazione non annullati (a parità di `lotId`
 * vince la creazione che viene prima nell'ordine canonico), poi si applicano gli altri eventi
 * nell'ordine canonico. Un evento con `at` anteriore alla creazione del suo lotto è applicato
 * come avvenuto alla creazione, con un avviso `event_before_lot`.
 */
export function derivePantry(
  events: Iterable<unknown>,
  options: DerivePantryOptions = {},
): PantryState {
  let asOfMs = Number.POSITIVE_INFINITY;
  if (options.asOf !== undefined) {
    asOfMs = instantMs(options.asOf);
    if (Number.isNaN(asOfMs)) {
      return { lots: [], anomalies: [{ code: "invalid_as_of" }], voidedEventIds: [] };
    }
  }

  const anomalies: Anomaly[] = [];

  // Gli eventi di altri moduli (diario, ecc.) convivono nel registro: si ignorano in silenzio,
  // senza validarli. Si ricordano solo i loro id, perché un `void` può puntarli.
  const pantryEvents: LedgerEvent[] = [];
  const foreignIds = new Set<string>();
  for (const item of events) {
    const foreign = foreignEvent(item);
    if (foreign === undefined) pantryEvents.push(item as LedgerEvent);
    else if (foreign !== "") foreignIds.add(foreign);
  }
  const { byId, conflicts, unidentifiable } = groupById(pantryEvents);

  const junk = new Map<string, unknown>();
  for (const item of unidentifiable) junk.set(safeKey(item), item);
  for (const key of [...junk.keys()].sort()) {
    anomalies.push(unidentifiableAnomaly(junk.get(key)));
  }
  conflicts.forEach((c: MergeConflict) =>
    anomalies.push({ code: "id_conflict", eventId: c.id }),
  );

  const all = sortEvents(byId.values());
  const valid: LedgerEvent[] = [];
  for (const e of all) {
    const errors = safeValidate(e);
    if (errors.length > 0) {
      anomalies.push({ code: "invalid_event", eventId: e.id, errors });
    } else {
      valid.push(e);
    }
  }

  // Vista `asOf`: i fatti si filtrano per `at`; un void segue il suo bersaglio (diretto o,
  // per un void di void, a catena) e non il proprio `at`, perché `correct()` fa ereditare
  // alla sostituzione l'`at` dell'evento corretto mentre il void nasce "adesso".
  let included = valid;
  if (asOfMs !== Number.POSITIVE_INFINITY) {
    const late = new Set<string>();
    const voidsById = new Map<string, VoidEvent>();
    for (const e of valid) {
      if (e.type === "void") voidsById.set(e.id, e);
      else if (instantMs(e.at) > asOfMs) late.add(e.id);
    }
    const followsLate = (v: VoidEvent): boolean => {
      const seen = new Set<string>();
      let cur = v.targetEventId;
      for (;;) {
        if (late.has(cur)) return true;
        const next = voidsById.get(cur);
        if (!next || seen.has(cur)) return false;
        seen.add(cur);
        cur = next.targetEventId;
      }
    };
    included = valid.filter((e) => (e.type === "void" ? !followsLate(e) : !late.has(e.id)));
  }

  const voided = resolveVoids(included, new Set([...byId.keys(), ...foreignIds]), anomalies);
  const live = included.filter((e) => e.type !== "void" && !voided.has(e.id));

  // Legami `replaces` tra creazioni (anche annullate: la sostituita lo è quasi sempre).
  // Un ciclo vale come assenza di legame; una sostituita assente (non ancora sincronizzata)
  // pure, e lo stato si sistema quando arriva.
  const creations = new Map<string, CreationEvent>();
  for (const e of included) {
    if (e.type === "purchase" || e.type === "declare") creations.set(e.id, e);
  }
  const replacesOf = new Map<string, string>();
  for (const c of creations.values()) {
    if (c.replaces !== undefined && creations.has(c.replaces)) replacesOf.set(c.id, c.replaces);
  }
  const inCycle = cycleNodes(replacesOf);
  const replacedBy = (c: CreationEvent): CreationEvent | undefined =>
    inCycle.has(c.id) ? undefined : creations.get(replacesOf.get(c.id) ?? "");

  /** Creazione d'origine della catena `replaces` (se stessa se non sostituisce nulla di presente). */
  const originOf = (start: CreationEvent): CreationEvent => {
    let cur = start;
    for (;;) {
      const prev = replacedBy(cur);
      if (!prev) return cur;
      cur = prev;
    }
  };

  const lots = new Map<string, Lot>();
  const winners = new Map<string, Winners>();

  // Passata 1: creazione dei lotti.
  for (const e of live) {
    if (e.type !== "purchase" && e.type !== "declare") continue;
    if (lots.has(e.lotId)) {
      anomalies.push({ code: "duplicate_lot", eventId: e.id, lotId: e.lotId });
      continue;
    }
    const lot: Lot = {
      lotId: e.lotId,
      productRef: e.productRef,
      origin: e.type,
      status: "active",
      unit: e.quantity.unit,
      initial: e.quantity.value,
      remaining: e.quantity.value,
      consumed: 0,
      discarded: 0,
      gifted: 0,
      location: e.location,
      createdAt: e.at,
      initialCertainty: e.certainty,
      remainingCertainty: e.certainty,
      history: [{ eventId: e.id, type: e.type, at: e.at, certainty: e.certainty }],
    };
    // Campi descrittivi: valori e timbri della creazione d'origine, qualunque cosa contenga `e`.
    const origin = originOf(e);
    const stamp: Candidate = { recordedMs: instantMs(origin.recordedAt), id: origin.id };
    const won: Winners = { productRef: stamp };
    lot.productRef = origin.productRef;
    if (!isBlank(origin.category)) {
      lot.category = origin.category;
      won.category = stamp;
    }
    if (!isBlank(origin.barcode)) {
      lot.barcode = origin.barcode;
      won.barcode = stamp;
    }
    if (origin.expiry) {
      lot.expiry = { date: origin.expiry.date, kind: origin.expiry.kind };
      won.expiry = stamp;
    }
    if (!isBlank(e.receiptId)) lot.receiptId = e.receiptId;
    if (origin.pieces) lot.pieces = { count: origin.pieces.count, each: origin.pieces.each, ...(origin.pieces.name ? { name: origin.pieces.name } : {}) };
    if (origin.type === "purchase") {
      if (origin.priceCents !== undefined) {
        lot.priceCents = origin.priceCents;
        lot.priceCertainty = origin.certainty;
        won.priceCents = stamp;
      }
      if (!isBlank(origin.store)) {
        lot.store = origin.store;
        won.store = stamp;
      }
    }
    winners.set(e.lotId, won);
    lots.set(e.lotId, lot);
  }

  // Passata 2: tutti gli altri eventi, nell'ordine canonico.
  for (const e of live) {
    if (e.type === "purchase" || e.type === "declare" || e.type === "void") continue;
    const lot = lots.get(e.lotId);
    if (!lot) {
      anomalies.push({ code: "unknown_lot", eventId: e.id, lotId: e.lotId });
      continue;
    }

    let at = e.at;
    if (instantMs(e.at) < instantMs(lot.createdAt)) {
      anomalies.push({ code: "event_before_lot", eventId: e.id, lotId: e.lotId });
      at = lot.createdAt;
    }

    const entry = { eventId: e.id, type: e.type, at, certainty: e.certainty };
    const finishIfEmpty = () => {
      if (lot.remaining === 0) {
        if (lot.status !== "finished") {
          lot.status = "finished";
          lot.finishedAt = at;
        }
      } else {
        lot.status = "active";
        delete lot.finishedAt;
      }
    };

    switch (e.type) {
      case "consume":
      case "discard":
      case "gift": {
        if (e.quantity.unit !== lot.unit) {
          anomalies.push({
            code: "unit_mismatch",
            eventId: e.id,
            lotId: lot.lotId,
            expectedUnit: lot.unit,
            actualUnit: e.quantity.unit,
          });
          continue;
        }
        const requested = e.quantity.value;
        const available = lot.remaining;
        const over = requested - available > EPSILON;
        const applied = Math.min(requested, available);
        if (over) {
          anomalies.push({
            code: "over_consumption",
            eventId: e.id,
            lotId: lot.lotId,
            requested,
            available,
          });
        }
        lot.remaining = norm(available - applied);
        const key =
          e.type === "consume" ? "consumed" : e.type === "discard" ? "discarded" : "gifted";
        lot[key] = norm(lot[key] + applied);
        lot.remainingCertainty = worseCertainty(lot.remainingCertainty, e.certainty);
        lot.history.push({
          ...entry,
          quantityDelta: applied === 0 ? 0 : -applied,
          ...(e.type === "discard" ? { reason: e.reason } : {}),
          ...(over ? { clamped: true as const } : {}),
        });
        finishIfEmpty();
        break;
      }
      case "adjust": {
        if (e.remaining.unit !== lot.unit) {
          anomalies.push({
            code: "unit_mismatch",
            eventId: e.id,
            lotId: lot.lotId,
            expectedUnit: lot.unit,
            actualUnit: e.remaining.unit,
          });
          continue;
        }
        const next = norm(e.remaining.value);
        lot.history.push({ ...entry, quantityDelta: norm(next - lot.remaining) });
        lot.remaining = next;
        lot.remainingCertainty = e.certainty;
        finishIfEmpty();
        break;
      }
      // Apertura e congelamento tengono l'`at` originale anche se anteriore alla creazione:
      // spostarli in avanti renderebbe la scadenza più ottimista.
      case "open":
        if (lot.openedAt === undefined) lot.openedAt = e.at;
        lot.history.push(entry);
        break;
      case "move":
        if (e.to !== lot.location) {
          if (e.to === "freezer") lot.frozenAt = e.at;
          else if (lot.location === "freezer") lot.thawedAt = e.at;
          lot.location = e.to;
        }
        lot.history.push(entry);
        break;
      case "updateLot": {
        // Campi descrittivi: vince l'ultima scrittura per (recordedAt, id), non per `at`.
        // Il massimo di un ordine totale non dipende dall'ordine di applicazione.
        const { patch } = e;
        const won = winners.get(lot.lotId)!;
        const mine: Candidate = { recordedMs: instantMs(e.recordedAt), id: e.id };
        const takes = (field: keyof Winners): boolean => {
          if (!beats(mine, won[field])) return false;
          won[field] = mine;
          return true;
        };
        if (patch.productRef !== undefined && takes("productRef")) {
          lot.productRef = patch.productRef;
        }
        if (patch.category !== undefined && (patch.category === null || !isBlank(patch.category))) {
          if (takes("category")) {
            if (patch.category === null) delete lot.category;
            else lot.category = patch.category;
          }
        }
        if (patch.barcode !== undefined && (patch.barcode === null || !isBlank(patch.barcode))) {
          if (takes("barcode")) {
            if (patch.barcode === null) delete lot.barcode;
            else lot.barcode = patch.barcode;
          }
        }
        if (patch.expiry !== undefined && takes("expiry")) {
          if (patch.expiry === null) delete lot.expiry;
          else lot.expiry = { date: patch.expiry.date, kind: patch.expiry.kind };
        }
        if (patch.priceCents !== undefined && takes("priceCents")) {
          if (patch.priceCents === null) {
            delete lot.priceCents;
            delete lot.priceCertainty;
          } else {
            lot.priceCents = patch.priceCents;
            lot.priceCertainty = e.certainty;
          }
        }
        if (patch.store !== undefined && (patch.store === null || !isBlank(patch.store))) {
          if (takes("store")) {
            if (patch.store === null) delete lot.store;
            else lot.store = patch.store;
          }
        }
        lot.history.push(entry);
        break;
      }
    }
  }

  const ordered = [...lots.values()].sort((a, b) => {
    const d = instantMs(a.createdAt) - instantMs(b.createdAt);
    if (d !== 0) return d < 0 ? -1 : 1;
    return a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0;
  });

  return {
    lots: ordered,
    anomalies,
    voidedEventIds: [...voided].sort(),
  };
}
