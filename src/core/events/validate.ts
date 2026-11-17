import { isPantryEvent, validateEvent, type LedgerEvent, type ValidationError } from "../ledger";
import { isDiaryEvent, validateDiaryEvent, type DiaryEvent } from "../diary";

/** Qualunque evento del registro: dispensa, diario o `void`. */
export type AnyEvent = LedgerEvent | DiaryEvent;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Punto unico di validazione. Un `void` è valido per entrambi i domini, un tipo della
 * dispensa passa dal libro mastro, uno del diario dal diario. Un tipo sconosciuto è
 * `{ path: "type", code: "invalid_value" }` (come nel libro mastro). Non lancia mai.
 */
export function validateAnyEvent(e: unknown): ValidationError[] {
  try {
    if (!isRecord(e)) return [{ path: "", code: "not_an_object" }];
    if (e.type === undefined) return [{ path: "type", code: "required" }];
    if (e.type === "void") return validateEvent(e);
    if (isPantryEvent(e)) return validateEvent(e);
    if (isDiaryEvent(e)) return validateDiaryEvent(e);
    return [{ path: "type", code: "invalid_value" }];
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

/** Il tipo dell'evento è noto: dispensa, diario o `void`. Non dice se l'evento è valido. */
export function isKnownEvent(e: unknown): boolean {
  try {
    return isRecord(e) && (e.type === "void" || isPantryEvent(e) || isDiaryEvent(e));
  } catch {
    return false;
  }
}
