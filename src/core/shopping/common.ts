// Strumenti condivisi dai moduli della lista della spesa: nomi, date, flussi di prodotto.
import { DEFAULT_TIME_ZONE } from "../expiry";
import type { Lot, PantryState, Unit } from "../ledger";
import { normalize, type Quantity as AnyQuantity } from "../units";

export { DEFAULT_TIME_ZONE };

/** Una riga di lista, nella forma minima che servono ai moduli di negozio, tetto e spesa in corso. */
export interface ShoppingLine {
  /** Identificativo della riga: `chiave|unità`. */
  id: string;
  /** Nome normalizzato del prodotto. */
  key: string;
  name: string;
  unit: Unit;
  /** Quantità nell'unità base (g, ml, pz). */
  quantity: number;
  barcode?: string;
}

/** Nome normalizzato: minuscolo, senza accenti né punteggiatura, spazi compressi. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const streamId = (key: string, unit: Unit): string => `${key}|${unit}`;

const BASE_UNITS: readonly string[] = ["g", "ml", "pz"];

/** Quantità positiva portata all'unità base; `null` se non convertibile in g, ml o pz. */
export function toBaseQuantity(q: AnyQuantity): { value: number; unit: Unit } | null {
  if (typeof q.value !== "number" || !Number.isFinite(q.value) || q.value <= 0) return null;
  const r = normalize(q);
  if (!r.ok) return null;
  if (!BASE_UNITS.includes(r.value.unit) || !(r.value.value > 0)) return null;
  return { value: r.value.value, unit: r.value.unit as Unit };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Data di calendario (nel fuso indicato) di un istante ISO. */
export function calendarDateOf(at: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

export const round9 = (n: number): number => Math.round(n * 1e9) / 1e9;
export const roundTo = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Passo "da spesa" per arrotondare una quantità: 1 pezzo, oppure 10/50/100 g o ml. */
export function purchaseStep(value: number, unit: Unit): number {
  if (unit === "pz") return 1;
  if (value < 100) return 10;
  if (value < 1000) return 50;
  return 100;
}

export function niceRound(value: number, unit: Unit, mode: "up" | "nearest"): number {
  const step = purchaseStep(value, unit);
  const n = mode === "up" ? Math.ceil(value / step - 1e-9) : Math.round(value / step);
  return Math.max(step, n * step);
}

/** Un lotto è utilizzabile se attivo e non scaduto "da consumare entro". */
export function isUsable(lot: Lot, today: string): boolean {
  if (lot.status !== "active") return false;
  return !(lot.expiry && lot.expiry.kind === "use_by" && lot.expiry.date < today);
}

/** Tutti i lotti di un prodotto (per nome normalizzato) nella stessa unità. */
export interface Stream {
  id: string;
  key: string;
  unit: Unit;
  /** Nome come scritto nel lotto più recente. */
  name: string;
  /** In ordine di creazione. */
  lots: Lot[];
  /** Quantità utilizzabile oggi. */
  stock: number;
  /** Codice a barre dell'ultimo lotto che ne ha uno. */
  barcode?: string;
}

export function buildStreams(state: PantryState, today: string): Stream[] {
  const map = new Map<string, Stream>();
  for (const lot of state.lots) {
    const key = normalizeName(lot.productRef);
    if (key === "") continue;
    const id = streamId(key, lot.unit);
    let s = map.get(id);
    if (!s) {
      s = { id, key, unit: lot.unit, name: lot.productRef.trim(), lots: [], stock: 0 };
      map.set(id, s);
    }
    s.lots.push(lot);
    s.name = lot.productRef.trim();
    if (lot.barcode) s.barcode = lot.barcode;
    if (isUsable(lot, today)) s.stock = round9(s.stock + lot.remaining);
  }
  return [...map.values()].sort((a, b) => cmp(a.key, b.key) || cmp(a.unit, b.unit));
}

export function streamMap(streams: readonly Stream[]): Map<string, Stream> {
  return new Map(streams.map((s) => [s.id, s]));
}

export class InvalidShoppingInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShoppingInputError";
  }
}
