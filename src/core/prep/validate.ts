import {
  LOCATIONS,
  UNITS,
  validateEnvelope,
  type ValidationError,
  type ValidationErrorCode,
} from "../ledger";
import { PREP_LIMITS, type PrepEvent } from "./types";

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const oneOf = (list: readonly string[], v: unknown): boolean =>
  typeof v === "string" && list.includes(v);

/** Il tipo dichiarato è `prep`. */
export function isPrepEvent(e: unknown): e is PrepEvent {
  try {
    return isRecord(e) && e.type === "prep";
  } catch {
    return false;
  }
}

/** Errori dell'evento `prep` (lista vuota se valido): busta comune più campi propri. Non lancia mai. */
export function validatePrepEvent(event: unknown): ValidationError[] {
  let errors: ValidationError[];
  try {
    errors = [...validateEnvelope(event)];
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
  if (!isRecord(event)) return errors;
  const add = (path: string, code: ValidationErrorCode): void => {
    errors.push({ path, code });
  };
  const requireString = (obj: Rec, key: string, path = key): void => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!isNonEmptyString(v)) add(path, "invalid_type");
  };
  const cents = (v: unknown, path: string): void => {
    if (typeof v !== "number") add(path, "invalid_type");
    else if (!Number.isInteger(v) || v < 0) add(path, "invalid_value");
  };

  try {
    if (event.type !== undefined && event.type !== "prep" && isNonEmptyString(event.type)) {
      add("type", "invalid_value");
      return errors;
    }
    requireString(event, "prepId");
    requireString(event, "title");
    if (event.recipeId !== undefined && !isNonEmptyString(event.recipeId)) add("recipeId", "invalid_type");
    if (event.portions === undefined) add("portions", "required");
    else if (typeof event.portions !== "number" || !Number.isInteger(event.portions)) {
      add("portions", "invalid_value");
    } else if (event.portions <= 0) add("portions", "not_positive");
    else if (event.portions > PREP_LIMITS.maxPortions) add("portions", "invalid_value");
    requireString(event, "batchLotId");
    requireString(event, "batchEventId");
    if (event.priceEventId !== undefined && !isNonEmptyString(event.priceEventId)) {
      add("priceEventId", "invalid_type");
    }
    if (event.location === undefined) add("location", "required");
    else if (!oneOf(LOCATIONS, event.location)) add("location", "invalid_value");
    if (event.costCents !== undefined) cents(event.costCents, "costCents");
    if (event.costPartial !== undefined && typeof event.costPartial !== "boolean") {
      add("costPartial", "invalid_type");
    }
    if (event.cookedPerRaw !== undefined) {
      const y = event.cookedPerRaw;
      if (typeof y !== "number" || !Number.isFinite(y)) add("cookedPerRaw", "invalid_value");
      else if (y <= 0) add("cookedPerRaw", "not_positive");
    }

    const ingredients = event.ingredients;
    if (ingredients === undefined) add("ingredients", "required");
    else if (!Array.isArray(ingredients)) add("ingredients", "invalid_type");
    else {
      if (ingredients.length === 0) add("ingredients", "required");
      ingredients.forEach((ing, i) => {
        const path = `ingredients[${i}]`;
        if (!isRecord(ing)) return add(path, "invalid_type");
        requireString(ing, "lotId", `${path}.lotId`);
        requireString(ing, "productRef", `${path}.productRef`);
        requireString(ing, "consumeEventId", `${path}.consumeEventId`);
        if (ing.costCents !== undefined) cents(ing.costCents, `${path}.costCents`);
        const q = ing.quantity;
        if (q === undefined) return add(`${path}.quantity`, "required");
        if (!isRecord(q)) return add(`${path}.quantity`, "invalid_type");
        if (q.value === undefined) add(`${path}.quantity.value`, "required");
        else if (typeof q.value !== "number" || !Number.isFinite(q.value)) {
          add(`${path}.quantity.value`, "invalid_value");
        } else if (q.value <= 0) add(`${path}.quantity.value`, "not_positive");
        if (q.unit === undefined) add(`${path}.quantity.unit`, "required");
        else if (!oneOf(UNITS, q.unit)) add(`${path}.quantity.unit`, "invalid_value");
      });
    }
    return errors;
  } catch {
    return [...errors, { path: "", code: "unserializable" }];
  }
}
