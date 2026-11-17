// Dalla lettura dello scontrino alle righe da rivedere, e dalle righe confermate agli acquisti del registro.
// Logica pura: la scrittura nel registro (`appendEvents`) la fa la schermata.
import type { ReceiptReading } from "@/core/ai";
import { normalizeLineKey, quantityKey, type LineState, type MemoryEntry } from "@/core/ai/receiptMemory";
import {
  SCHEMA_VERSION,
  generateId,
  isCalendarDate,
  validateEvent,
  type IdGenerator,
  type Location,
  type PurchaseEvent,
} from "@/core/ledger";
import { cleanName, readQuantity } from "../capture";
import { suggestCategory } from "../labels";
import { isFoodCategory } from "../lots";
import { defaultLocation } from "../quickAdd";

export interface ReviewLine {
  /** Identificativo stabile della riga nella schermata. */
  key: string;
  include: boolean;
  name: string;
  quantityText: string;
  /** La quantità non c'era sullo scontrino: è un "1" proposto. */
  quantityGuessed: boolean;
  /** Chiave del motore delle scadenze, o stringa vuota. */
  category: string;
  location: Location;
  /** Prezzo della riga in centesimi, al netto degli sconti. */
  priceCents?: number;
  discountCents: number;
  raw: string;
  isFood: boolean;
  /** Prodotto collegato leggendo il codice a barre: il lotto porta il codice, e da lì i valori del prodotto. */
  barcode?: string;
  /** Il prodotto collegato è una scheda creata dal nome: il suo codice non è un codice a barre. */
  localProduct?: true;
  daysAfterOpening?: number;
  /** Nome e marca del prodotto collegato, per mostrarli. */
  productLabel?: string;
  /** «Ignora sempre»: la riga non è cibo, in questo negozio la salto da sola. */
  ignoreAlways?: boolean;
  /** Testo della riga normalizzato: con il negozio, è la chiave della memoria. */
  memoryKey?: string;
  /** Quantità letta dalla foto (normalizzata), se c'era sullo scontrino: serve a vedere se il formato è lo stesso dell'ultima volta. */
  seenQuantity?: string;
  /** Ciò che aveva proposto la lettura, prima della memoria e delle correzioni. */
  proposed?: LineState;
  /** Cosa ricordo di questa riga e se l'ho applicata («come l'ultima volta») o solo proposta. */
  remembered?: { source: "store" | "general"; applied: boolean; entry: MemoryEntry };
  /** L'utente ha già toccato la riga: la memoria non la cambia più. */
  touched?: boolean;
}

function quantityTextOf(line: ReceiptReading["lines"][number]): string {
  if (!line.quantity) return "1 pz";
  // niente cifre inutili: 532 e non 532.0
  return `${String(line.quantity.value).replace(".", ",")} ${line.quantity.unit}`;
}

/** Le righe lette diventano righe da rivedere: gli alimenti inclusi, tutto il resto escluso in partenza. */
export function toReviewLines(reading: ReceiptReading): ReviewLine[] {
  return reading.lines.map((line, index) => {
    const category = line.category ?? (line.isFood ? suggestCategory(line.name) : undefined);
    const location = category ? defaultLocation(category) : "frigo";
    const quantityText = quantityTextOf(line);
    return {
      key: `line-${index}`,
      include: line.isFood,
      name: line.name,
      quantityText,
      quantityGuessed: line.quantity === undefined,
      category: category ?? "",
      location,
      memoryKey: normalizeLineKey(line.raw, line.name),
      ...(line.quantity ? { seenQuantity: quantityKey(quantityText) } : {}),
      proposed: { name: line.name, category: category ?? "", quantity: quantityText, location, ignore: false },
      ...(line.priceCents !== undefined ? { priceCents: line.priceCents } : {}),
      discountCents: line.discountCents,
      raw: line.raw,
      isFood: line.isFood,
    };
  });
}

/** Somma dei prezzi delle righe incluse, in centesimi. */
export function includedTotalCents(lines: readonly ReviewLine[]): number {
  return lines.reduce((sum, l) => (l.include && l.priceCents !== undefined ? sum + l.priceCents : sum), 0);
}

export interface ReceiptMeta {
  /** Negozio come lo ha scritto o corretto l'utente; vuoto se non c'è. */
  store: string;
  /** `YYYY-MM-DD`; vuoto o non valido = oggi. */
  date: string;
}

export interface ReceiptContext {
  /** Istante corrente ISO UTC. */
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type ReceiptEventsResult =
  | { ok: true; events: PurchaseEvent[]; receiptId: string; summary: string }
  | { ok: false; errors: Record<string, string>; form?: string };

/** Prefisso fisso e non ambiguo della nota: altri moduli leggono le note, e il testo grezzo di una riga non deve poter sembrare un loro formato. */
export const RECEIPT_NOTE_PREFIX = "Riga scontrino";

/** Nota dell'evento: prefisso fisso, poi il testo stampato della riga senza sequenze "Codice a barre" (le legge il modulo del codice a barre). */
export function receiptNote(raw: string): string {
  const text = raw
    .replace(/codice\s*a\s*barre\s*:?\s*\d*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return text === "" ? RECEIPT_NOTE_PREFIX : `${RECEIPT_NOTE_PREFIX}: ${text}`;
}

/** Nome del negozio da proporre: la catena, con il punto vendita se aggiunge qualcosa. */
export function storeLabel(reading: Pick<ReceiptReading, "store" | "chain">): string {
  const { store, chain } = reading;
  if (chain && store) return store.toLowerCase().includes(chain.toLowerCase()) ? store : `${chain} · ${store}`;
  return chain ?? store ?? "";
}

/** Istante dell'acquisto: la data dello scontrino a mezzogiorno UTC, se valida e non nel futuro; altrimenti adesso. */
export function purchaseInstant(date: string, now: string): string {
  if (isCalendarDate(date) && date <= now.slice(0, 10)) return `${date}T12:00:00.000Z`;
  return now;
}

/**
 * Un acquisto per ogni riga inclusa, tutti con lo stesso `receiptId`. Tutto ciò che è stato interpretato
 * (quantità, categoria, luogo) è una stima: la certezza è `estimated`.
 */
export function buildReceiptEvents(lines: readonly ReviewLine[], meta: ReceiptMeta, ctx: ReceiptContext): ReceiptEventsResult {
  const chosen = lines.filter((l) => l.include);
  if (chosen.length === 0) return { ok: false, errors: {}, form: "Non hai scelto nessuna riga da salvare." };

  const errors: Record<string, string> = {};
  const parsed = chosen.map((line) => {
    const quantity = readQuantity(line.quantityText);
    const name = cleanName(line.name);
    if (name === "") errors[line.key] = "Scrivi come si chiama l'alimento.";
    else if (!quantity.ok) errors[line.key] = quantity.error;
    else if (!isFoodCategory(line.category)) errors[line.key] = "Scegli una categoria: serve a stimare la scadenza.";
    return { line, name, quantity };
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const idGenerator = ctx.idGenerator ?? generateId;
  const receiptId = idGenerator();
  const at = purchaseInstant(meta.date, ctx.now);
  const store = meta.store.trim();
  const events: PurchaseEvent[] = [];
  for (const { line, name, quantity } of parsed) {
    if (!quantity.ok) continue;
    const event: PurchaseEvent = {
      id: idGenerator(),
      type: "purchase",
      at,
      recordedAt: ctx.now,
      deviceId: ctx.deviceId,
      schemaVersion: SCHEMA_VERSION,
      certainty: "estimated",
      source: "receipt",
      note: receiptNote(line.raw),
      lotId: idGenerator(),
      productRef: name,
      category: line.category,
      quantity: quantity.quantity,
      location: line.location,
      receiptId,
      ...(line.barcode ? { barcode: line.barcode } : {}),
      ...(line.daysAfterOpening !== undefined ? { daysAfterOpening: line.daysAfterOpening } : {}),
      ...(line.priceCents !== undefined && line.priceCents >= 0 ? { priceCents: line.priceCents } : {}),
      ...(store !== "" ? { store } : {}),
    };
    if (validateEvent(event).length > 0) {
      errors[line.key] = "Non riesco a salvare questa riga. Controlla i campi e riprova.";
      continue;
    }
    events.push(event);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const count = events.length;
  const summary = `${count} ${count === 1 ? "alimento" : "alimenti"} dallo scontrino${store !== "" ? ` (${store})` : ""}`;
  return { ok: true, events, receiptId, summary };
}
