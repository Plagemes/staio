// Ciò che la lista della spesa ricorda sul dispositivo, nelle impostazioni locali (si cancella con «Cancella tutti i dati»).
// Qui solo chiavi, forme e controlli: nessun accesso all'archivio. Logica pura.
import type { Unit } from "@/core/ledger";
import type { CompletedTrip, RejectionMemory, StockConfig, TripState } from "@/core/shopping";
import type { ManualItem } from "./manual";

export const SETTING_KEYS = {
  rejections: "shopping.rejections",
  manual: "shopping.manual",
  stock: "shopping.stock",
  history: "shopping.history",
  trip: "shopping.trip",
  lastTrip: "shopping.lastTrip",
  budget: "shopping.budget",
  decisions: "shopping.decisions",
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUnit = (v: unknown): v is Unit => v === "g" || v === "ml" || v === "pz";
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isRejectionMemory(v: unknown): v is RejectionMemory {
  return (
    isRecord(v) &&
    Array.isArray(v.entries) &&
    v.entries.every((e) => isRecord(e) && isString(e.id) && isString(e.key) && isUnit(e.unit) && isString(e.kind) && Array.isArray(e.dates) && e.dates.every(isString))
  );
}

export function isManualList(v: unknown): v is ManualItem[] {
  return (
    Array.isArray(v) &&
    v.every((m) => isRecord(m) && isString(m.id) && isString(m.product) && isString(m.addedAt) && (m.quantity === undefined || (isRecord(m.quantity) && isNumber(m.quantity.value) && isUnit(m.quantity.unit))))
  );
}

export function isStockConfig(v: unknown): v is StockConfig {
  return (
    isRecord(v) &&
    Array.isArray(v.minimums) &&
    v.minimums.every((m) => isRecord(m) && isString(m.id) && isString(m.key) && isString(m.name) && isUnit(m.unit) && isNumber(m.minimum))
  );
}

export function isHistory(v: unknown): v is CompletedTrip[] {
  return (
    Array.isArray(v) &&
    v.every((t) => isRecord(t) && (t.store === null || isString(t.store)) && isString(t.endedAt) && Array.isArray(t.order) && t.order.every(isString))
  );
}

export function isTrip(v: unknown): v is TripState {
  return (
    isRecord(v) &&
    (v.store === null || isString(v.store)) &&
    isString(v.startedAt) &&
    Array.isArray(v.items) &&
    v.items.every((i) => isRecord(i) && isString(i.id) && isString(i.key) && isString(i.name) && isUnit(i.unit) && isNumber(i.quantity)) &&
    Array.isArray(v.offList) &&
    v.offList.every((o) => isRecord(o) && isString(o.id) && isString(o.name) && isString(o.key) && isString(o.addedAt))
  );
}

export const isBudget = (v: unknown): v is number | null => v === null || (isNumber(v) && v >= 0);

/** Scelte sulla lista: confermate (con la quantità bloccata), quantità cambiate, voci rifiutate oggi. */
export interface Decisions {
  confirmed: Record<string, true>;
  quantities: Record<string, number>;
  /** `id` della voce -> data del rifiuto: resta fuori dalla lista per `DISMISS_DAYS` giorni. */
  dismissed: Record<string, string>;
}

export const DISMISS_DAYS = 7;

export const emptyDecisions = (): Decisions => ({ confirmed: {}, quantities: {}, dismissed: {} });

export function isDecisions(v: unknown): v is Decisions {
  return (
    isRecord(v) &&
    isRecord(v.confirmed) &&
    Object.values(v.confirmed).every((x) => x === true) &&
    isRecord(v.quantities) &&
    Object.values(v.quantities).every(isNumber) &&
    isRecord(v.dismissed) &&
    Object.values(v.dismissed).every(isString)
  );
}

/** Ultimi viaggi che si ricordano per imparare l'ordine dei negozi. */
export const HISTORY_LIMIT = 30;
