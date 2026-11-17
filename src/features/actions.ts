// Azioni su un lotto già registrato: ognuna restituisce gli eventi da scrivere e il testo della conferma.
import {
  SCHEMA_VERSION,
  correctLot,
  generateId,
  isCalendarDate,
  validateEvent,
  voidEvent,
  type Certainty,
  type DeclareEvent,
  type DiscardReason,
  type IdGenerator,
  type LedgerEvent,
  type Location,
  type Lot,
  type LotChanges,
  type PurchaseEvent,
  type Quantity,
  type Unit,
  type VoidEvent,
} from "@/core/ledger";
import type { AnyEvent } from "@/core/events";
import { formatQuantity, normalize, parseQuantity } from "@/core/units";
import { cleanName } from "./capture";
import { parsePriceCents } from "./format";
import { isFoodCategory } from "./lots";
import { DISCARD_REASON_LABELS, LOCATION_LABELS, UNIT_NAMES, type ChosenExpiryKind } from "./labels";

export interface ActionContext {
  /** Istante corrente ISO UTC. */
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type ActionResult =
  | { ok: true; events: LedgerEvent[]; message: string }
  | { ok: false; error: string };

/** Quanto: tutto il rimasto, metà (una stima), o una quantità scritta a mano. */
export type AmountChoice = { kind: "all" } | { kind: "half" } | { kind: "quarter" } | { kind: "text"; text: string };

type AmountResult = { ok: true; quantity: Quantity; certainty: Certainty } | { ok: false; error: string };

const EPSILON = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

type InUnit = { ok: true; quantity: Quantity } | { ok: false; error: string };

/** Legge una quantità nell'unità del lotto: un numero senza unità vale come l'unità del lotto. Positiva, senza altri limiti. */
export function parseQuantityInUnit(text: string, unit: Unit): InUnit {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Scrivi quanto, per esempio 200 g." };
  let quantity: Quantity;
  if (/^[\d.,/\s]+$/.test(trimmed)) {
    const parsed = parseQuantity(`${trimmed} pz`);
    if (!parsed.ok) return { ok: false, error: "Non capisco la quantità." };
    quantity = { value: parsed.value.quantity.value, unit };
  } else {
    const parsed = parseQuantity(trimmed);
    if (!parsed.ok) return { ok: false, error: "Non capisco la quantità. Prova con «200 g» o «2 pz»." };
    const base = normalize(parsed.value.quantity);
    if (!base.ok) return { ok: false, error: "Questa unità non si può contare: scrivi grammi, litri o pezzi." };
    if (base.value.unit !== unit) {
      return { ok: false, error: `Questo alimento si conta in ${UNIT_NAMES[unit]}: scrivi la quantità in quell'unità.` };
    }
    quantity = { value: base.value.value, unit };
  }
  if (!(quantity.value > 0)) return { ok: false, error: "La quantità deve essere maggiore di zero." };
  return { ok: true, quantity };
}

/** Come `parseQuantityInUnit`, ma non oltre quanto resta. */
export function parseAmountForLot(text: string, lot: Pick<Lot, "unit" | "remaining">): AmountResult {
  const read = parseQuantityInUnit(text, lot.unit);
  if (!read.ok) return read;
  let quantity = read.quantity;
  if (quantity.value - lot.remaining > EPSILON) {
    return { ok: false, error: `Ne restano solo ${formatQuantity({ value: lot.remaining, unit: lot.unit })}.` };
  }
  if (Math.abs(quantity.value - lot.remaining) <= EPSILON) quantity = { value: lot.remaining, unit: lot.unit };
  return { ok: true, quantity, certainty: "measured" };
}

export function resolveAmount(lot: Lot, choice: AmountChoice): AmountResult {
  if (lot.remaining <= 0) return { ok: false, error: "Di questo alimento non resta niente." };
  switch (choice.kind) {
    case "all":
      return { ok: true, quantity: { value: lot.remaining, unit: lot.unit }, certainty: "measured" };
    case "half":
      return {
        ok: true,
        quantity: { value: round2(lot.remaining / 2) || lot.remaining, unit: lot.unit },
        certainty: "estimated",
      };
    case "quarter":
      return {
        ok: true,
        quantity: { value: round2(lot.remaining / 4) || lot.remaining, unit: lot.unit },
        certainty: "estimated",
      };
    case "text":
      return parseAmountForLot(choice.text, lot);
  }
}

function baseOf(ctx: ActionContext, certainty: Certainty = "measured") {
  const idGenerator = ctx.idGenerator ?? generateId;
  return {
    id: idGenerator(),
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty,
    source: "manual" as const,
  };
}

const q = (quantity: Quantity) => formatQuantity(quantity);

export function buildConsume(lot: Lot, choice: AmountChoice, ctx: ActionContext): ActionResult {
  const amount = resolveAmount(lot, choice);
  if (!amount.ok) return amount;
  const event: LedgerEvent = {
    ...baseOf(ctx, amount.certainty),
    type: "consume",
    lotId: lot.lotId,
    quantity: amount.quantity,
  };
  return { ok: true, events: [event], message: `Segnato mangiato: ${q(amount.quantity)} di ${lot.productRef}.` };
}

export function buildDiscard(
  lot: Lot,
  choice: AmountChoice,
  reason: DiscardReason,
  ctx: ActionContext,
): ActionResult {
  const amount = resolveAmount(lot, choice);
  if (!amount.ok) return amount;
  const event: LedgerEvent = {
    ...baseOf(ctx, amount.certainty),
    type: "discard",
    lotId: lot.lotId,
    quantity: amount.quantity,
    reason,
  };
  return {
    ok: true,
    events: [event],
    message: `Segnato buttato: ${q(amount.quantity)} di ${lot.productRef} (${DISCARD_REASON_LABELS[reason].toLowerCase()}).`,
  };
}

export function buildOpen(lot: Lot, ctx: ActionContext): ActionResult {
  if (lot.openedAt !== undefined) return { ok: false, error: "Questo alimento risulta già aperto." };
  const event: LedgerEvent = { ...baseOf(ctx), type: "open", lotId: lot.lotId };
  return { ok: true, events: [event], message: `Segnato aperto: ${lot.productRef}.` };
}

export function buildMove(lot: Lot, to: Location, ctx: ActionContext): ActionResult {
  if (to === lot.location) {
    return { ok: false, error: `Questo alimento è già in ${LOCATION_LABELS[to].toLowerCase()}.` };
  }
  const event: LedgerEvent = { ...baseOf(ctx), type: "move", lotId: lot.lotId, to };
  return {
    ok: true,
    events: [event],
    message: `Spostato in ${LOCATION_LABELS[to].toLowerCase()}: ${lot.productRef}.`,
  };
}

/** Il lotto come lo mostra il modulo di modifica. */
export interface EditForm {
  name: string;
  category: string;
  expiryKind: ChosenExpiryKind | "none";
  expiryDate: string;
  priceText: string;
}

export function formFromLot(lot: Lot): EditForm {
  const kind = lot.expiry?.kind;
  return {
    name: lot.productRef,
    category: lot.category ?? "",
    // una data stimata dall'app non è una scelta dell'utente: compare come "Preferibilmente"
    expiryKind: kind === undefined ? "none" : kind === "use_by" ? "use_by" : "best_before",
    expiryDate: lot.expiry?.date ?? "",
    priceText: lot.priceCents !== undefined ? (lot.priceCents / 100).toFixed(2).replace(".", ",") : "",
  };
}

export type EditErrors = Partial<Record<"name" | "category" | "expiryDate" | "price" | "form", string>>;

export type EditResult = ActionResult | { ok: false; error: string; fields: EditErrors };

/** Il libro mastro conosce solo il prezzo degli acquisti: per ciò che c'era già in casa il campo non conta. */
export function canEditPrice(creation: PurchaseEvent | DeclareEvent): boolean {
  return creation.type === "purchase";
}

/**
 * Modifica di nome, categoria, scadenza e prezzo. Passa sempre da `correctLot` con lo stato attuale del
 * lotto: solo i campi davvero cambiati producono un evento.
 */
export function buildEdit(
  creation: PurchaseEvent | DeclareEvent,
  lot: Lot,
  form: EditForm,
  ctx: ActionContext,
): EditResult {
  const fields: EditErrors = {};
  const original = formFromLot(lot);
  const changes: LotChanges = {};

  const name = cleanName(form.name);
  if (name === "") fields.name = "Scrivi come si chiama l'alimento.";
  else if (name !== lot.productRef) changes.productRef = name;

  if (form.category !== "" && !isFoodCategory(form.category)) fields.category = "Scegli una categoria dall'elenco.";
  else if (form.category !== "" && form.category !== (lot.category ?? "")) changes.category = form.category;

  const expiryTouched = form.expiryKind !== original.expiryKind || form.expiryDate !== original.expiryDate;
  if (expiryTouched) {
    if (form.expiryKind === "none") changes.expiry = null;
    else if (form.expiryDate.trim() === "") fields.expiryDate = "Scrivi la data, oppure scegli «Nessuna data».";
    else if (!isCalendarDate(form.expiryDate)) fields.expiryDate = "La data non è valida.";
    else changes.expiry = { date: form.expiryDate, kind: form.expiryKind };
  }

  if (canEditPrice(creation) && form.priceText.trim() !== original.priceText) {
    if (form.priceText.trim() === "") changes.priceCents = null;
    else {
      const price = parsePriceCents(form.priceText);
      if (price.ok) changes.priceCents = price.cents;
      else fields.price = "Scrivi il prezzo in euro, per esempio 3,50.";
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, error: "Controlla i campi indicati.", fields };

  const events = correctLot(creation, changes, { lot, deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: ctx.idGenerator });
  if (events.length === 0) return { ok: false, error: "Non hai cambiato niente." };
  for (const e of events) {
    if (validateEvent(e).length > 0) {
      return { ok: false, error: "Non riesco a salvare la modifica. Controlla i campi e riprova." };
    }
  }
  return { ok: true, events, message: `Modificato: ${changes.productRef ?? lot.productRef}.` };
}

/** Un evento `void` per ognuno degli eventi dati: annulla l'azione appena fatta senza cancellare niente. */
export function buildUndo(events: readonly AnyEvent[], ctx: ActionContext): VoidEvent[] {
  const idGenerator = ctx.idGenerator ?? generateId;
  return events.map((e) => voidEvent(e, { idGenerator, now: () => ctx.now, deviceId: ctx.deviceId }));
}

/** L'evento di creazione ancora valido di un lotto (quello non annullato). */
export function findCreationEvent(
  events: readonly AnyEvent[],
  lotId: string,
  voidedEventIds: readonly string[],
): PurchaseEvent | DeclareEvent | undefined {
  const voided = new Set(voidedEventIds);
  for (const e of events) {
    if ((e.type === "purchase" || e.type === "declare") && e.lotId === lotId && !voided.has(e.id)) return e;
  }
  return undefined;
}
