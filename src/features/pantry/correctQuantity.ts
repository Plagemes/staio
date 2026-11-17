// «Correggi»: quali eventi scrivere quando si dice quanto resta davvero di un alimento. Logica pura.
// Mai un consumo o uno scarto finto: o si dice quanto ne resta (`adjust`), o si corregge la quantità con cui era entrato.
import type { AnyEvent } from "@/core/events";
import {
  SCHEMA_VERSION,
  correctLot,
  derivePantry,
  generateId,
  piecesOf,
  validateEvent,
  type DeclareEvent,
  type LedgerEvent,
  type Lot,
  type PurchaseEvent,
  type Quantity,
} from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import type { ActionContext, EditErrors, EditResult } from "../actions";

export type QuantityCorrection = { ok: true; events: LedgerEvent[] } | { ok: false; error: string };

const TOLERANCE = 0.001;
const INVALID = "Scrivi quanto ne resta, per esempio 250.";
const STUCK = "Non riesco a correggere questa quantità. Usa «Controlla le quantità».";

const close = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE;
const matches = (found: number | undefined, wanted: number): boolean => found !== undefined && close(found, wanted);

/** «La quantità rimasta è questa», come in `buildRealign`. `laterMs` lo fa risultare registrato dopo gli eventi scritti insieme. */
function adjustTo(lot: Lot, value: number, ctx: ActionContext, laterMs = 0): LedgerEvent {
  const ms = Date.parse(ctx.now);
  return {
    id: (ctx.idGenerator ?? generateId)(),
    type: "adjust",
    at: ctx.now,
    recordedAt: laterMs === 0 || Number.isNaN(ms) ? ctx.now : new Date(ms + laterMs).toISOString(),
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: "measured",
    source: "manual",
    lotId: lot.lotId,
    remaining: { value, unit: lot.unit },
  };
}

/** Quanto resta dell'alimento se al registro si aggiungono questi eventi. */
function remainingWith(log: readonly AnyEvent[], events: readonly LedgerEvent[], lotId: string): number | undefined {
  return derivePantry([...log, ...events]).lots.find((l) => l.lotId === lotId)?.remaining;
}

/**
 * La quantità di partenza che serve perché possano restarne `remaining`: il rimasto voluto più ciò che è uscito davvero
 * (mangiato, buttato, regalato). Non la differenza tra partenza e rimasto: un «Controlla le quantità» di prima la gonfierebbe.
 */
export function initialFor(lot: Pick<Lot, "consumed" | "discarded" | "gifted">, remaining: number): number {
  const out = Math.max(0, lot.consumed) + Math.max(0, lot.discarded) + Math.max(0, lot.gifted);
  return Math.round((remaining + out) * 1e6) / 1e6;
}

/**
 * La domanda da fare prima di salvare un rimasto più grande della quantità con cui l'alimento era entrato: lì si
 * riscrive l'inserimento, e un errore di battitura (2500 per 250) non deve passare in silenzio. `null` se non serve.
 */
export function overInitialQuestion(
  lot: Pick<Lot, "initial" | "unit" | "pieces" | "consumed" | "discarded" | "gifted">,
  remaining: number,
): string | null {
  if (!Number.isFinite(remaining) || remaining <= lot.initial + TOLERANCE) return null;
  const text = (value: number): string => formatQuantity({ value, unit: lot.unit });
  const question = `È più di quanto era entrato (${text(lot.initial)}). Confermi ${text(remaining)}?`;
  const after = piecesOf(lot) ? piecesOf({ pieces: lot.pieces, unit: lot.unit, initial: initialFor(lot, remaining) }) : undefined;
  if (!after) return question;
  return `${question} I pezzi verranno ricalcolati: ${after.count} da circa ${text(after.each)}.`;
}

/**
 * Gli eventi che portano il rimasto di un alimento al valore dato:
 * - uguale a quello che risulta: nessuno;
 * - fino alla quantità di partenza: un `adjust`;
 * - oltre la quantità di partenza (era stata scritta male all'ingresso): la creazione riscritta con una quantità più
 *   grande (il rimasto voluto più ciò che è uscito) e, sempre, un `adjust` che fissa il rimasto: così un consumo fatto
 *   prima su un altro telefono, che arriva dopo, non lo sposta, come nel caso del solo `adjust`. I consumi restano dove sono.
 * Prima di restituirli deriva la dispensa con essi e controlla che il rimasto sia quello voluto.
 */
export function buildQuantityCorrection(args: {
  lot: Lot;
  creation: PurchaseEvent | DeclareEvent;
  /** Quanto ne resta davvero, nell'unità dell'alimento. */
  remaining: number;
  /** Il registro com'è adesso: serve a verificare il risultato. */
  log: readonly AnyEvent[];
  ctx: ActionContext;
}): QuantityCorrection {
  const { lot, creation, remaining, log, ctx } = args;
  if (!Number.isFinite(remaining) || !(remaining > 0)) return { ok: false, error: INVALID };
  if (close(remaining, lot.remaining)) return { ok: true, events: [] };

  let events: LedgerEvent[];
  if (remaining <= lot.initial) {
    events = [adjustTo(lot, remaining, ctx)];
    if (!matches(remainingWith(log, events, lot.lotId), remaining)) return { ok: false, error: STUCK };
  } else {
    if (creation.lotId !== lot.lotId || creation.quantity.unit !== lot.unit || !close(creation.quantity.value, lot.initial)) {
      return { ok: false, error: STUCK };
    }
    const rewritten = correctLot(
      creation,
      { quantity: { value: initialFor(lot, remaining), unit: lot.unit } },
      { lot, deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: ctx.idGenerator },
    );
    if (rewritten.length === 0) return { ok: false, error: STUCK };
    events = [...rewritten, adjustTo(lot, remaining, ctx, 2)];
    if (!matches(remainingWith(log, events, lot.lotId), remaining)) return { ok: false, error: STUCK };
  }

  if (events.some((e) => e.type === "consume" || e.type === "discard" || e.type === "gift" || validateEvent(e).length > 0)) {
    return { ok: false, error: STUCK };
  }
  return { ok: true, events };
}

export type Correction =
  | { ok: true; events: LedgerEvent[]; message: string }
  | { ok: false; error: string; fields?: EditErrors; /** L'errore del campo «Quanto ne resta». */ remaining?: string };

const NOTHING_CHANGED = "Non hai cambiato niente.";

/**
 * Il modulo «Correggi» scrive in una volta sola la quantità e gli altri campi (`buildEdit`, `buildEditMany`).
 * Se gli altri campi non sono cambiati ma la quantità sì, vale la quantità; se non è cambiato niente lo dice.
 */
export function mergeCorrection(args: {
  /** Assente quando la correzione vale per più confezioni: lì la quantità non si tocca. */
  quantity?: QuantityCorrection;
  edit: EditResult;
  /** Il nome dell'alimento dopo la correzione. */
  name: string;
  /** Il rimasto voluto, per l'avviso. */
  remaining?: Quantity;
  /** Su quante confezioni vale. */
  packs?: number;
}): Correction {
  const { quantity, edit, name, remaining, packs = 1 } = args;
  const fields = !edit.ok && "fields" in edit ? edit.fields : undefined;
  const remainingError = quantity && !quantity.ok ? quantity.error : undefined;
  if (fields || remainingError) {
    return { ok: false, error: "Controlla i campi indicati.", ...(fields ? { fields } : {}), ...(remainingError ? { remaining: remainingError } : {}) };
  }
  const quantityEvents = quantity?.ok ? quantity.events : [];
  if (!edit.ok && (edit.error !== NOTHING_CHANGED || quantityEvents.length === 0)) return { ok: false, error: edit.error };
  const events = [...quantityEvents, ...(edit.ok ? edit.events : [])];

  let message = packs > 1 ? `Corrette: ${packs} confezioni di ${name}.` : `Corretto: ${name}.`;
  if (quantityEvents.length > 0 && remaining) {
    const left = remaining.unit === "pz" && remaining.value === 1 ? "ne resta" : "ne restano";
    message = `Corretto: ${name}, ${left} ${formatQuantity(remaining)}.`;
  }
  return { ok: true, events, message };
}
