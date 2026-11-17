// Dalle differenze confermate agli eventi del registro. Logica pura: nulla viene scritto qui, né senza conferma.
// - quantità cambiata o finito: `adjust` (riallineamento, «la quantità rimasta è questa»), come il riallineamento manuale;
// - elemento inatteso: `declare` con certezza `estimated`;
// - scadenza: `correctLot` con lo stato attuale del lotto, che produce un `updateLot` (mai una correzione dell'acquisto).
// Tutto con fonte `photo`: ciò che viene da una foto è una stima.
import { formatAmount, formatDay, type Difference, type ScanLocation, type ZoneObservation } from "@/core/ai";
import type { AnyEvent } from "@/core/events";
import {
  SCHEMA_VERSION,
  correctLot,
  generateId,
  validateEvent,
  type AdjustEvent,
  type DeclareEvent,
  type IdGenerator,
  type LedgerEvent,
  type Lot,
} from "@/core/ledger";
import { buildConsume, buildDiscard, findCreationEvent } from "../actions";
import { cleanName } from "../capture";
import { LOCATION_LABELS, suggestCategory } from "../labels";

/** Nota fissa degli eventi scritti da una foto. */
export const PHOTO_NOTE = "Rilevato da foto";

export interface PhotoContext {
  /** Istante corrente ISO UTC. */
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
  location: ScanLocation;
  /** Identificativo corto -> lotto, come lo ha costruito `toExpectedLots`. */
  lotsById: ReadonlyMap<string, Lot>;
  /** Tutti gli eventi, per ritrovare l'acquisto del lotto quando si corregge una scadenza. */
  events: readonly AnyEvent[];
  voidedEventIds: readonly string[];
  /**
   * Per gli avvisi («sembra da consumare presto», lotto con data d'etichetta): cosa ha scelto l'utente, per chiave della differenza.
   * Senza scelta l'avviso non scrive nulla. Sono le azioni di sempre (mangiato, buttato), non una modifica della scadenza.
   */
  actions?: Readonly<Record<string, "eaten" | "discarded">>;
}

export interface WrittenItem {
  key: string;
  summary: string;
}

export interface PhotoEventsResult {
  events: LedgerEvent[];
  /** Cosa è stato composto, per il riepilogo finale. */
  written: WrittenItem[];
  /** Differenze che non si è riusciti a comporre: non producono eventi. */
  errors: { key: string; message: string }[];
}

/** Compone gli eventi delle sole differenze confermate. Con nessuna conferma non produce niente. */
export function buildPhotoEvents(confirmed: readonly Difference[], ctx: PhotoContext): PhotoEventsResult {
  const idGenerator = ctx.idGenerator ?? generateId;
  const result: PhotoEventsResult = { events: [], written: [], errors: [] };
  const fail = (key: string, message: string) => result.errors.push({ key, message });
  const base = {
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: "estimated" as const,
    source: "photo" as const,
    note: PHOTO_NOTE,
  };

  for (const d of confirmed) {
    const lot = d.lotId !== undefined ? ctx.lotsById.get(d.lotId) : undefined;
    const change = d.change;

    if (change.type === "adjust") {
      if (!lot) {
        fail(d.key, "Non trovo più questo lotto.");
        continue;
      }
      const value = Math.min(Math.max(change.remaining.value, 0), lot.initial);
      const event: AdjustEvent = { ...base, id: idGenerator(), type: "adjust", lotId: lot.lotId, remaining: { value, unit: lot.unit } };
      if (validateEvent(event).length > 0) {
        fail(d.key, "Non riesco a salvare questa risposta.");
        continue;
      }
      result.events.push(event);
      result.written.push({
        key: d.key,
        summary: value === 0 ? `${d.name}: segnato finito` : `${d.name}: ne resta circa ${formatAmount(value, lot.unit)}`,
      });
      continue;
    }

    if (change.type === "declare") {
      const name = cleanName(change.name);
      if (name === "") {
        fail(d.key, "Manca il nome dell'alimento.");
        continue;
      }
      const category = suggestCategory(name);
      const event: DeclareEvent = {
        ...base,
        id: idGenerator(),
        type: "declare",
        lotId: idGenerator(),
        productRef: name,
        ...(category ? { category } : {}),
        quantity: change.quantity,
        location: ctx.location,
      };
      if (validateEvent(event).length > 0) {
        fail(d.key, "Non riesco a salvare questo alimento.");
        continue;
      }
      result.events.push(event);
      result.written.push({ key: d.key, summary: `${name}: aggiunto (${LOCATION_LABELS[ctx.location].toLowerCase()})` });
      continue;
    }

    if (change.type === "notice") {
      const action = ctx.actions?.[d.key];
      if (!lot || action === undefined) continue; // visto, e basta: la data in etichetta resta com'è
      const actionCtx = { now: ctx.now, deviceId: ctx.deviceId, idGenerator };
      const built = action === "eaten" ? buildConsume(lot, { kind: "all" }, actionCtx) : buildDiscard(lot, { kind: "all" }, "other", actionCtx);
      if (!built.ok) {
        fail(d.key, built.error);
        continue;
      }
      result.events.push(...built.events);
      result.written.push({ key: d.key, summary: built.message.replace(/\.$/, "") });
      continue;
    }

    // scadenza
    if (!lot) {
      fail(d.key, "Non trovo più questo lotto.");
      continue;
    }
    const creation = findCreationEvent(ctx.events, lot.lotId, ctx.voidedEventIds);
    if (!creation) {
      fail(d.key, "Non trovo l'acquisto di questo lotto.");
      continue;
    }
    const produced = correctLot(creation, { expiry: change.expiry }, { lot, now: () => ctx.now, deviceId: ctx.deviceId, idGenerator });
    if (produced.length === 0) {
      fail(d.key, "La scadenza è già questa.");
      continue;
    }
    // correctLot non sa di foto e stime: si marca solo l'`updateLot` della scadenza, senza toccare l'acquisto
    const marked = produced.map((e) => (e.type === "updateLot" ? ({ ...e, certainty: "estimated", source: "photo", note: PHOTO_NOTE } as LedgerEvent) : e));
    if (marked.some((e) => validateEvent(e).length > 0)) {
      fail(d.key, "Non riesco a salvare questa scadenza.");
      continue;
    }
    result.events.push(...marked);
    result.written.push({
      key: d.key,
      summary: `${d.name}: scadenza ${formatDay(change.expiry.date)}${change.expiry.kind === "estimated" ? " (stimata)" : ""}`,
    });
  }
  return result;
}

/** Dove l'utente ha confermato gli alimenti: alimenta la mappa delle zone. */
export function zoneObservations(confirmed: readonly Difference[], location: ScanLocation, now: string): ZoneObservation[] {
  return confirmed.flatMap((d) => (d.zone ? [{ location, food: d.food, zone: d.zone, at: now }] : []));
}
