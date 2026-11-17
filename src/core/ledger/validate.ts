import {
  CERTAINTIES,
  DISCARD_REASONS,
  EVENT_TYPES,
  EXPIRY_KINDS,
  LOCATIONS,
  SCHEMA_VERSION,
  SOURCES,
  UNITS,
  type EventType,
  type Unit,
} from "./types";
import { isCalendarDate, isIsoInstant } from "./time";

export type ValidationErrorCode =
  | "not_an_object"
  | "required"
  | "invalid_type"
  | "invalid_value"
  | "not_positive"
  | "negative"
  | "invalid_date"
  | "invalid_instant"
  | "unit_mismatch"
  | "not_allowed"
  | "empty_patch"
  /** Contiene valori non serializzabili (es. BigInt, funzioni, cicli). */
  | "unserializable";

export interface ValidationError {
  /** Percorso del campo, es. `quantity.value`. Vuoto per l'evento intero. */
  path: string;
  code: ValidationErrorCode;
}

export interface ValidateOptions {
  /** Unità dei lotti noti: se presente, una quantità in altra unità è un errore. */
  lotUnits?: ReadonlyMap<string, Unit>;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Campi comuni a ogni evento, senza `type` (id, at, recordedAt, deviceId, schemaVersion, certainty, source, note, replaces). */
function envelopeErrors(event: Rec): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (path: string, code: ValidationErrorCode): void => {
    errors.push({ path, code });
  };
  const requireString = (key: string) => {
    const v = event[key];
    if (v === undefined) add(key, "required");
    else if (!isNonEmptyString(v)) add(key, "invalid_type");
  };
  // Una stringa vuota in un campo facoltativo vale come campo assente.
  const optionalString = (key: string) => {
    if (event[key] !== undefined && typeof event[key] !== "string") add(key, "invalid_type");
  };
  const requireEnum = (key: string, list: readonly string[]) => {
    const v = event[key];
    if (v === undefined) add(key, "required");
    else if (!oneOf(list, v)) add(key, "invalid_value");
  };
  const checkInstant = (key: string) => {
    const v = event[key];
    if (v === undefined) add(key, "required");
    else if (!isIsoInstant(v)) add(key, "invalid_instant");
  };

  requireString("id");
  checkInstant("at");
  checkInstant("recordedAt");
  requireString("deviceId");
  if (event.schemaVersion === undefined) add("schemaVersion", "required");
  else if (event.schemaVersion !== SCHEMA_VERSION) add("schemaVersion", "invalid_value");
  requireEnum("certainty", CERTAINTIES);
  requireEnum("source", SOURCES);
  optionalString("note");
  optionalString("replaces");
  return errors;
}

/**
 * Valida solo la "busta" comune di un evento, qualunque sia il suo tipo: id, at, recordedAt,
 * deviceId, schemaVersion, certainty, source, note, replaces e `type` (stringa non vuota, senza
 * controllare che sia un tipo noto). Pensata per i moduli che definiscono altri tipi di evento.
 */
export function validateEnvelope(event: unknown): ValidationError[] {
  if (!isRecord(event)) return [{ path: "", code: "not_an_object" }];
  const errors = envelopeErrors(event);
  if (event.type === undefined) errors.push({ path: "type", code: "required" });
  else if (!isNonEmptyString(event.type)) errors.push({ path: "type", code: "invalid_type" });
  return errors;
}

/**
 * Restituisce gli errori dell'evento (lista vuota se valido). Non lancia mai.
 * I campi in più sono ignorati, per restare compatibili con versioni future.
 */
export function validateEvent(
  event: unknown,
  options: ValidateOptions = {},
): ValidationError[] {
  if (!isRecord(event)) return [{ path: "", code: "not_an_object" }];
  const errors: ValidationError[] = [];
  const add = (path: string, code: ValidationErrorCode): void => {
    errors.push({ path, code });
  };

  const requireString = (obj: Rec, key: string, path = key) => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!isNonEmptyString(v)) add(path, "invalid_type");
  };
  // Una stringa vuota in un campo facoltativo vale come campo assente.
  const optionalString = (obj: Rec, key: string, path = key) => {
    if (obj[key] !== undefined && typeof obj[key] !== "string") {
      add(path, "invalid_type");
    }
  };
  const requireEnum = (
    obj: Rec,
    key: string,
    list: readonly string[],
    path = key,
  ) => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!oneOf(list, v)) add(path, "invalid_value");
  };
  const checkExpiry = (v: unknown, path: string) => {
    if (!isRecord(v)) return add(path, "invalid_type");
    if (v.date === undefined) add(`${path}.date`, "required");
    else if (!isCalendarDate(v.date)) add(`${path}.date`, "invalid_date");
    requireEnum(v, "kind", EXPIRY_KINDS, `${path}.kind`);
  };
  // Solo cifre, da 8 a 14 (EAN-8, UPC-A, EAN-13, GTIN-14); stringa vuota = assente.
  const checkBarcode = (v: unknown, path: string) => {
    if (typeof v !== "string") add(path, "invalid_type");
    else if (v !== "" && !/^\d{8,14}$/.test(v)) add(path, "invalid_value");
  };
  const checkPieces = (v: unknown, path: string) => {
    if (!isRecord(v)) return add(path, "invalid_type");
    const { count, each, name } = v;
    if (count === undefined) add(`${path}.count`, "required");
    else if (typeof count !== "number") add(`${path}.count`, "invalid_type");
    else if (!Number.isInteger(count) || count < 1 || count > 1000) add(`${path}.count`, "invalid_value");
    if (each === undefined) add(`${path}.each`, "required");
    else if (typeof each !== "number") add(`${path}.each`, "invalid_type");
    else if (!Number.isFinite(each) || each <= 0) add(`${path}.each`, "invalid_value");
    if (name !== undefined && !isNonEmptyString(name)) add(`${path}.name`, "invalid_type");
  };
  const checkCents = (v: unknown, path: string) => {
    if (typeof v !== "number") add(path, "invalid_type");
    else if (!Number.isInteger(v) || v < 0) add(path, "invalid_value");
  };
  /** Quantità positiva; con `allowZero` anche zero (solo per il riallineamento). */
  const checkQuantity = (
    key: string,
    allowZero: boolean,
    lotId: unknown,
  ): void => {
    const q = event[key];
    if (q === undefined) return add(key, "required");
    if (!isRecord(q)) return add(key, "invalid_type");
    const { value, unit } = q;
    if (value === undefined) add(`${key}.value`, "required");
    else if (typeof value !== "number" || !Number.isFinite(value)) {
      add(`${key}.value`, "invalid_value");
    } else if (value < 0) add(`${key}.value`, allowZero ? "negative" : "not_positive");
    else if (value === 0 && !allowZero) add(`${key}.value`, "not_positive");

    if (unit === undefined) return add(`${key}.unit`, "required");
    if (!oneOf(UNITS, unit)) return add(`${key}.unit`, "invalid_value");
    if (typeof lotId === "string" && options.lotUnits) {
      const known = options.lotUnits.get(lotId);
      if (known !== undefined && known !== unit) add(`${key}.unit`, "unit_mismatch");
    }
  };

  errors.push(...envelopeErrors(event));

  const type = event.type;
  if (type === undefined) {
    add("type", "required");
    return errors;
  }
  if (!oneOf<EventType>(EVENT_TYPES, type)) {
    add("type", "invalid_value");
    return errors;
  }

  if (type === "void") {
    requireString(event, "targetEventId");
    return errors;
  }

  requireString(event, "lotId");
  const lotId = event.lotId;

  switch (type) {
    case "purchase":
    case "declare":
      requireString(event, "productRef");
      optionalString(event, "category");
      if (event.barcode !== undefined) checkBarcode(event.barcode, "barcode");
      checkQuantity("quantity", false, lotId);
      if (event.pieces !== undefined) checkPieces(event.pieces, "pieces");
      // `daysAfterOpening` non si valida: un valore inutilizzabile si ignora in `derive`, l'evento resta valido.
      requireEnum(event, "location", LOCATIONS);
      if (event.expiry !== undefined) checkExpiry(event.expiry, "expiry");
      optionalString(event, "receiptId");
      if (type === "purchase") {
        if (event.priceCents !== undefined) checkCents(event.priceCents, "priceCents");
        optionalString(event, "store");
      } else {
        if (event.priceCents !== undefined) add("priceCents", "not_allowed");
        if (event.store !== undefined) add("store", "not_allowed");
      }
      break;
    case "consume":
      checkQuantity("quantity", false, lotId);
      optionalString(event, "mealId");
      break;
    case "discard":
      checkQuantity("quantity", false, lotId);
      requireEnum(event, "reason", DISCARD_REASONS);
      break;
    case "gift":
      checkQuantity("quantity", false, lotId);
      break;
    case "open":
      break;
    case "move":
      requireEnum(event, "to", LOCATIONS);
      break;
    case "adjust":
      checkQuantity("remaining", true, lotId);
      break;
    case "updateLot": {
      const patch = event.patch;
      if (patch === undefined) {
        add("patch", "required");
        break;
      }
      if (!isRecord(patch)) {
        add("patch", "invalid_type");
        break;
      }
      let touched = 0;
      if (patch.productRef !== undefined) {
        touched++;
        if (!isNonEmptyString(patch.productRef)) add("patch.productRef", "invalid_type");
      }
      if (patch.category !== undefined) {
        touched++;
        // Stringa vuota: accettata e senza effetto, come campo assente.
        if (patch.category !== null && typeof patch.category !== "string") {
          add("patch.category", "invalid_type");
        }
      }
      if (patch.barcode !== undefined) {
        touched++;
        if (patch.barcode !== null) checkBarcode(patch.barcode, "patch.barcode");
      }
      if (patch.expiry !== undefined) {
        touched++;
        if (patch.expiry !== null) checkExpiry(patch.expiry, "patch.expiry");
      }
      if (patch.priceCents !== undefined) {
        touched++;
        if (patch.priceCents !== null) checkCents(patch.priceCents, "patch.priceCents");
      }
      if (patch.store !== undefined) {
        touched++;
        // Stringa vuota: accettata e senza effetto, come campo assente.
        if (patch.store !== null && typeof patch.store !== "string") {
          add("patch.store", "invalid_type");
        }
      }
      if (touched === 0) add("patch", "empty_patch");
      break;
    }
  }
  return errors;
}
