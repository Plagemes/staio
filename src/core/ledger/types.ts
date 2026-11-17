// Modello dati del libro mastro a eventi (schemaVersion 1).
// Gli eventi sono solo aggiunti: mai modificati né cancellati.

export const UNITS = ["g", "ml", "pz"] as const;
export type Unit = (typeof UNITS)[number];

export const LOCATIONS = ["frigo", "freezer", "dispensa"] as const;
export type Location = (typeof LOCATIONS)[number];

export const CERTAINTIES = ["measured", "label", "estimated"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const SOURCES = [
  "manual",
  "barcode",
  "receipt",
  "photo",
  "voice",
  "habit",
  "system",
] as const;
export type Source = (typeof SOURCES)[number];

export const EXPIRY_KINDS = ["use_by", "best_before", "estimated"] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

export const DISCARD_REASONS = [
  "expired",
  "leftover",
  "disliked",
  "other",
] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

export const EVENT_TYPES = [
  "purchase",
  "declare",
  "consume",
  "discard",
  "gift",
  "open",
  "move",
  "adjust",
  "updateLot",
  "void",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Tipi di evento della dispensa, compreso `void`. Lo stesso registro può contenere anche eventi
 * di altri moduli (diario): la dispensa li ignora.
 */
export const PANTRY_EVENT_TYPES = EVENT_TYPES;

export function isPantryEvent(e: unknown): boolean {
  try {
    if (typeof e !== "object" || e === null) return false;
    const type = (e as { type?: unknown }).type;
    return typeof type === "string" && (PANTRY_EVENT_TYPES as readonly string[]).includes(type);
  } catch {
    return false;
  }
}

export const SCHEMA_VERSION = 1 as const;

/** Quantità in unità base (g, ml, pz). Le conversioni sono compito del chiamante. */
export interface Quantity {
  value: number;
  unit: Unit;
}

export interface Expiry {
  /** Data di calendario `YYYY-MM-DD`. */
  date: string;
  kind: ExpiryKind;
}

/** Campi comuni a ogni evento. */
export interface EventBase {
  /** Unico e ordinabile nel tempo. */
  id: string;
  /** Istante ISO 8601 UTC in cui il fatto è avvenuto. */
  at: string;
  /** Istante ISO 8601 UTC in cui il fatto è stato registrato. */
  recordedAt: string;
  deviceId: string;
  schemaVersion: typeof SCHEMA_VERSION;
  certainty: Certainty;
  source: Source;
  note?: string;
  /** Id dell'evento che questo evento corregge (lo scrive `correct()`). */
  replaces?: string;
}

/**
 * Pezzi dentro una confezione («2 piadine da 100 g»). Sono un modo di leggere la quantità del lotto, non un'altra
 * unità: la quantità resta in g o ml e, se `count × each` non la riproduce, vale la quantità.
 */
export interface Pieces {
  /** Numero di pezzi nella confezione, intero. */
  count: number;
  /** Quantità di un pezzo, nell'unità del lotto. */
  each: number;
  /** Come si chiama il pezzo, se si ricava («piadina»); altrimenti «pezzo». */
  name?: string;
}

export interface PurchaseEvent extends EventBase {
  type: "purchase";
  lotId: string;
  /** Id di catalogo oppure nome libero. */
  productRef: string;
  /** Categoria dell'alimento: stringa libera, il libro mastro non conosce l'elenco. */
  category?: string;
  /** Codice a barre del prodotto: solo cifre, da 8 a 14. */
  barcode?: string;
  quantity: Quantity;
  /** Pezzi dentro la confezione, se dichiarati. */
  pieces?: Pieces;
  /** Prezzo totale del lotto, in centesimi di euro. */
  priceCents?: number;
  store?: string;
  location: Location;
  expiry?: Expiry;
  receiptId?: string;
}

/** "Ho già in casa": come un acquisto, senza prezzo né negozio. */
export interface DeclareEvent extends EventBase {
  type: "declare";
  lotId: string;
  productRef: string;
  category?: string;
  barcode?: string;
  quantity: Quantity;
  /** Pezzi dentro la confezione, se dichiarati. */
  pieces?: Pieces;
  location: Location;
  expiry?: Expiry;
  receiptId?: string;
}

export interface ConsumeEvent extends EventBase {
  type: "consume";
  lotId: string;
  quantity: Quantity;
  mealId?: string;
}

export interface DiscardEvent extends EventBase {
  type: "discard";
  lotId: string;
  quantity: Quantity;
  reason: DiscardReason;
}

export interface GiftEvent extends EventBase {
  type: "gift";
  lotId: string;
  quantity: Quantity;
}

export interface OpenEvent extends EventBase {
  type: "open";
  lotId: string;
}

export interface MoveEvent extends EventBase {
  type: "move";
  lotId: string;
  to: Location;
}

/** Riallineamento: imposta la quantità rimasta in valore assoluto (zero ammesso). */
export interface AdjustEvent extends EventBase {
  type: "adjust";
  lotId: string;
  remaining: Quantity;
}

/**
 * Arricchimento successivo di un lotto. Una chiave assente non cambia nulla;
 * `null` cancella il valore.
 */
export interface LotPatch {
  expiry?: Expiry | null;
  productRef?: string;
  category?: string | null;
  barcode?: string | null;
  priceCents?: number | null;
  store?: string | null;
}

export interface UpdateLotEvent extends EventBase {
  type: "updateLot";
  lotId: string;
  patch: LotPatch;
}

/** Annulla un evento precedente senza cancellarlo. Un void può essere annullato a sua volta. */
export interface VoidEvent extends EventBase {
  type: "void";
  targetEventId: string;
}

export type LedgerEvent =
  | PurchaseEvent
  | DeclareEvent
  | ConsumeEvent
  | DiscardEvent
  | GiftEvent
  | OpenEvent
  | MoveEvent
  | AdjustEvent
  | UpdateLotEvent
  | VoidEvent;

/** Eventi che si riferiscono a un lotto esistente (tutti tranne creazione e void). */
export type LotEvent = Exclude<
  LedgerEvent,
  PurchaseEvent | DeclareEvent | VoidEvent
>;

const CERTAINTY_RANK: Record<Certainty, number> = {
  measured: 0,
  label: 1,
  estimated: 2,
};

/** La meno affidabile tra due certezze. */
export function worseCertainty(a: Certainty, b: Certainty): Certainty {
  return CERTAINTY_RANK[a] >= CERTAINTY_RANK[b] ? a : b;
}
