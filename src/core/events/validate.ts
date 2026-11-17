import { validateEvent, type LedgerEvent, type ValidationError } from "../ledger";
import { validateDiaryEvent, type DiaryEvent } from "../diary";
import { validatePlanEvent, type PlanEvent } from "../plan";
import { validatePrepEvent, type PrepEvent } from "../prep";
import { validateRecipeEvent, type RecipeEvent } from "../recipes";
import { validateExperimentEvent, type ExperimentEvent } from "../analysis";
import { validateConfirmationEvent, type AllergenConfirmationEvent } from "../allergens";
import { familyOf, type EventFamily } from "./families";

/** Qualunque evento del registro: dispensa, diario, piano, preparazioni, ricettario, esperimenti, conferme degli allergeni o `void`. */
export type AnyEvent =
  | LedgerEvent
  | DiaryEvent
  | PlanEvent
  | PrepEvent
  | RecipeEvent
  | ExperimentEvent
  | AllergenConfirmationEvent;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const VALIDATORS: Record<EventFamily, (e: unknown) => ValidationError[]> = {
  pantry: validateEvent,
  diary: validateDiaryEvent,
  plan: validatePlanEvent,
  prep: validatePrepEvent,
  recipes: validateRecipeEvent,
  experiments: validateExperimentEvent,
  allergenConfirmations: validateConfirmationEvent,
};

/**
 * Punto unico di validazione: ogni tipo passa dal validatore della sua famiglia (dispensa,
 * diario, piano, preparazioni, ricettario). Un `void` vale per tutte e si valida come nel
 * libro mastro. Un tipo sconosciuto è `{ path: "type", code: "invalid_value" }` (come nel
 * libro mastro), uno assente `{ path: "type", code: "required" }`. Non lancia mai.
 */
export function validateAnyEvent(e: unknown): ValidationError[] {
  try {
    if (!isRecord(e)) return [{ path: "", code: "not_an_object" }];
    if (e.type === undefined) return [{ path: "type", code: "required" }];
    if (e.type === "void") return validateEvent(e);
    const family = familyOf(e);
    if (family) return VALIDATORS[family](e);
    return [{ path: "type", code: "invalid_value" }];
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

/** Il tipo dell'evento è noto: di una famiglia o `void`. Non dice se l'evento è valido. */
export function isKnownEvent(e: unknown): boolean {
  try {
    return isRecord(e) && (e.type === "void" || familyOf(e) !== undefined);
  } catch {
    return false;
  }
}
