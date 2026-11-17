// Dal modulo di cattura agli eventi del libro mastro. Nessuna scrittura: restituisce solo gli eventi.
import {
  SCHEMA_VERSION,
  generateId,
  isCalendarDate,
  validateEvent,
  type DeclareEvent,
  type Expiry,
  type IdGenerator,
  type LedgerEvent,
  type Location,
  type PurchaseEvent,
  type Quantity,
} from "@/core/ledger";
import { formatQuantity, normalize, parseQuantity } from "@/core/units";
import { isFoodCategory } from "./lots";
import { parsePriceCents } from "./format";
import { FOOD_CATEGORY_LABELS, LOCATION_LABELS, type ChosenExpiryKind } from "./labels";

export interface CaptureInput {
  name: string;
  quantityText: string;
  location: Location;
  /** Categoria del motore delle scadenze, o stringa vuota se non scelta. */
  category: string;
  expiryKind: ChosenExpiryKind | "none";
  /** `YYYY-MM-DD`, o vuoto. */
  expiryDate: string;
  priceText: string;
  /** "Ce l'avevo già in casa": scrive `declare` invece di `purchase`. */
  alreadyHave: boolean;
  /** Codice a barre da cui arrivano i dati: la fonte diventa `barcode` e la quantità vale come letta in etichetta. */
  barcode?: string;
  brand?: string;
  /** Pezzi dentro la confezione (2 piadine da 100 g); la quantità resta quella della confezione. */
  pieces?: { count: number; each: number; name?: string };
}

export type CaptureField = "name" | "quantity" | "category" | "expiryDate" | "price" | "form";
export type FieldErrors = Partial<Record<CaptureField, string>>;

export interface CaptureContext {
  /** Istante corrente ISO UTC. */
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type CaptureResult =
  | { ok: true; events: LedgerEvent[]; lotId: string; summary: string }
  | { ok: false; errors: FieldErrors };

export type QuantityReading =
  | { ok: true; quantity: Quantity; /** Testo rimasto dopo quantità e unità ("6 uova" -> "uova"). */ rest: string }
  | { ok: false; error: string };

/** Legge una quantità libera e la porta in unità base (g, ml, pz). */
export function readQuantity(text: string): QuantityReading {
  if (text.trim() === "") {
    return { ok: false, error: "Scrivi la quantità, per esempio 500 g, 1 l o 6 uova." };
  }
  const parsed = parseQuantity(text);
  if (!parsed.ok) {
    return { ok: false, error: "Non capisco la quantità. Prova con «500 g», «1 l» o «6 uova»." };
  }
  const base = normalize(parsed.value.quantity);
  if (!base.ok) {
    return { ok: false, error: "Questa unità non si può contare: scrivi grammi, litri o pezzi." };
  }
  if (!(base.value.value > 0)) {
    return { ok: false, error: "La quantità deve essere maggiore di zero." };
  }
  // normalize ammette solo g, ml, pz: lo stringo per il compilatore e per il libro mastro
  const unit = base.value.unit;
  if (unit !== "g" && unit !== "ml" && unit !== "pz") {
    return { ok: false, error: "Questa unità non si può contare: scrivi grammi, litri o pezzi." };
  }
  return { ok: true, quantity: { value: base.value.value, unit }, rest: parsed.value.rest };
}

/** Prima lettera maiuscola e spazi ordinati. */
export function cleanName(text: string): string {
  const s = text.trim().replace(/\s+/g, " ");
  return s === "" ? s : s[0].toUpperCase() + s.slice(1);
}

/** Cifre, da 8 a 14 come nel libro mastro: altro non è un codice a barre. */
const BARCODE_RE = /^\d{8,14}$/;

/** I pezzi si portano nell'evento solo se sono almeno due e la quantità della confezione è in g o ml. */
function piecesOf(pieces: CaptureInput["pieces"], quantity: Quantity): NonNullable<CaptureInput["pieces"]> | undefined {
  if (!pieces || quantity.unit === "pz") return undefined;
  if (!Number.isInteger(pieces.count) || pieces.count < 2 || !(pieces.each > 0)) return undefined;
  const name = pieces.name?.trim();
  return { count: pieces.count, each: pieces.each, ...(name ? { name } : {}) };
}

export function buildCaptureEvents(input: CaptureInput, ctx: CaptureContext): CaptureResult {
  const errors: FieldErrors = {};

  const reading = readQuantity(input.quantityText);
  if (!reading.ok) errors.quantity = reading.error;

  // "6 uova" nel campo quantità basta a dare anche il nome, se il campo nome è vuoto
  const name = cleanName(input.name !== "" ? input.name : reading.ok ? reading.rest : "");
  if (name === "") errors.name = "Scrivi come si chiama l'alimento.";

  if (!isFoodCategory(input.category)) {
    errors.category = "Scegli una categoria: serve a stimare la scadenza.";
  }

  let expiry: Expiry | undefined;
  if (input.expiryKind !== "none") {
    if (input.expiryDate.trim() === "") {
      errors.expiryDate = "Scrivi la data di scadenza, oppure scegli «Nessuna data».";
    } else if (!isCalendarDate(input.expiryDate)) {
      errors.expiryDate = "La data non è valida.";
    } else {
      expiry = { date: input.expiryDate, kind: input.expiryKind };
    }
  }

  let priceCents: number | undefined;
  if (!input.alreadyHave && input.priceText.trim() !== "") {
    const price = parsePriceCents(input.priceText);
    if (price.ok) priceCents = price.cents;
    else errors.price = "Scrivi il prezzo in euro, per esempio 3,50.";
  }

  if (Object.keys(errors).length > 0 || !reading.ok) return { ok: false, errors };

  const barcode = input.barcode !== undefined && BARCODE_RE.test(input.barcode) ? input.barcode : undefined;
  const fromBarcode = barcode !== undefined;
  const brand = input.brand?.trim();
  const idGenerator = ctx.idGenerator ?? generateId;
  const lotId = idGenerator();
  // Un acquisto con la quantità letta in etichetta; ciò che c'era già in casa è, per sua natura, approssimato.
  const base = {
    id: idGenerator(),
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    source: fromBarcode ? ("barcode" as const) : ("manual" as const),
    // il codice è un campo dell'evento; nella nota resta solo la marca
    ...(fromBarcode ? { barcode } : {}),
    ...(fromBarcode && brand ? { note: `Marca: ${brand}` } : {}),
    lotId,
    productRef: name,
    category: input.category,
    quantity: reading.quantity,
    ...(piecesOf(input.pieces, reading.quantity) ? { pieces: piecesOf(input.pieces, reading.quantity) } : {}),
    location: input.location,
    ...(expiry ? { expiry } : {}),
  };
  const event: PurchaseEvent | DeclareEvent = input.alreadyHave
    ? { ...base, type: "declare", certainty: fromBarcode ? "label" : "estimated" }
    : { ...base, type: "purchase", certainty: "label", ...(priceCents !== undefined ? { priceCents } : {}) };

  if (validateEvent(event).length > 0) {
    return { ok: false, errors: { form: "Non riesco a salvare questo alimento. Controlla i campi e riprova." } };
  }
  const category = FOOD_CATEGORY_LABELS[input.category as keyof typeof FOOD_CATEGORY_LABELS];
  return {
    ok: true,
    events: [event],
    lotId,
    summary: `${name}, ${formatQuantity(reading.quantity)}, ${LOCATION_LABELS[input.location].toLowerCase()} (${category.toLowerCase()})`,
  };
}
