import {
  CERTAINTIES,
  UNITS,
  isCalendarDate,
  validateEnvelope,
  type ValidationError,
  type ValidationErrorCode,
} from "../ledger";
import {
  DIARY_EVENT_TYPES,
  DIARY_LIMITS,
  FOOD_ID_MAX_LENGTH,
  MAIN_MEAL_KINDS,
  MEAL_DECLARATION_STATUSES,
  MEAL_KINDS,
  SYMPTOM_KINDS,
  type DiaryEvent,
  type DiaryEventType,
} from "./types";

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

const FOOD_ID_RE = /^[a-z0-9-]+$/;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Il tipo dichiarato è un tipo del diario. */
export function isDiaryEvent(e: unknown): e is DiaryEvent {
  return isRecord(e) && oneOf<DiaryEventType>(DIARY_EVENT_TYPES, e.type);
}

function safeEnvelope(e: unknown): ValidationError[] {
  try {
    return validateEnvelope(e);
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

/**
 * Errori dell'evento (lista vuota se valido): busta comune più campi propri del tipo.
 * Accetta anche un `void`, che vale per il libro mastro e per il diario. Non lancia mai.
 * I campi in più sono ignorati, per restare compatibili con versioni future.
 */
export function validateDiaryEvent(event: unknown): ValidationError[] {
  const errors: ValidationError[] = [...safeEnvelope(event)];
  if (!isRecord(event)) {
    if (errors.length === 0) errors.push({ path: "", code: "not_an_object" });
    return dedupe(errors);
  }
  const add = (path: string, code: ValidationErrorCode): void => {
    errors.push({ path, code });
  };

  const requireString = (obj: Rec, key: string, path = key) => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!isNonEmptyString(v)) add(path, "invalid_type");
  };
  const optionalString = (obj: Rec, key: string, path = key) => {
    if (obj[key] !== undefined && typeof obj[key] !== "string") add(path, "invalid_type");
  };
  const requireEnum = (obj: Rec, key: string, list: readonly string[], path = key) => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!oneOf(list, v)) add(path, "invalid_value");
  };
  /**
   * Numero finito. Zero o meno: `not_positive` (o `negative` se si ammette lo zero).
   * Fuori dai limiti di plausibilità: `invalid_value` sul campo.
   */
  const checkNumber = (
    obj: Rec,
    key: string,
    mode: "positive" | "nonNegative",
    required: boolean,
    limits: { min?: number; max?: number } = {},
    path = key,
  ) => {
    const v = obj[key];
    if (v === undefined) {
      if (required) add(path, "required");
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return add(path, "invalid_value");
    if (mode === "positive" ? v <= 0 : v < 0) {
      return add(path, mode === "positive" ? "not_positive" : "negative");
    }
    if ((limits.min !== undefined && v < limits.min) || (limits.max !== undefined && v > limits.max)) {
      add(path, "invalid_value");
    }
  };
  const checkScore = (obj: Rec) => {
    const v = obj.score;
    if (v === undefined) add("score", "required");
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      add("score", "invalid_value");
    }
  };
  const checkItems = (obj: Rec, required: boolean) => {
    const items = obj.items;
    if (items === undefined) {
      if (required) add("items", "required");
      return;
    }
    if (!Array.isArray(items)) return add("items", "invalid_type");
    items.forEach((item: unknown, i) => {
      const base = `items.${i}`;
      if (!isRecord(item)) return add(base, "invalid_type");
      requireString(item, "name", `${base}.name`);
      requireEnum(item, "certainty", CERTAINTIES, `${base}.certainty`);
      const foodId = item.foodId;
      if (foodId !== undefined) {
        // Stringa vuota: vale come campo assente.
        if (typeof foodId !== "string") add(`${base}.foodId`, "invalid_type");
        else if (foodId !== "" && (foodId.length > FOOD_ID_MAX_LENGTH || !FOOD_ID_RE.test(foodId))) {
          add(`${base}.foodId`, "invalid_value");
        }
      }
      const q = item.quantity;
      if (q === undefined) return add(`${base}.quantity`, "required");
      if (!isRecord(q)) return add(`${base}.quantity`, "invalid_type");
      checkNumber(q, "value", "positive", true, {}, `${base}.quantity.value`);
      requireEnum(q, "unit", UNITS, `${base}.quantity.unit`);
    });
  };

  const type = event.type;
  if (type === undefined) {
    add("type", "required");
    return dedupe(errors);
  }
  if (type === "void") {
    requireString(event, "targetEventId");
    return dedupe(errors);
  }
  if (!oneOf<DiaryEventType>(DIARY_EVENT_TYPES, type)) {
    add("type", "invalid_value");
    return dedupe(errors);
  }

  switch (type) {
    case "meal":
      requireString(event, "mealId");
      requireEnum(event, "kind", MEAL_KINDS);
      optionalString(event, "title");
      optionalString(event, "habitId");
      checkItems(event, false);
      break;
    case "untrackedMeal":
      requireEnum(event, "kind", MEAL_KINDS);
      break;
    case "mealDeclaration": {
      const d = event.date;
      if (d === undefined) add("date", "required");
      else if (typeof d !== "string") add("date", "invalid_type");
      else if (!isCalendarDate(d)) add("date", "invalid_value");
      requireEnum(event, "kind", MAIN_MEAL_KINDS);
      requireEnum(event, "status", MEAL_DECLARATION_STATUSES);
      break;
    }
    case "water":
      checkNumber(event, "ml", "positive", true, { max: DIARY_LIMITS.volumeMlMax });
      break;
    case "drink":
      requireString(event, "name");
      checkNumber(event, "ml", "positive", true, { max: DIARY_LIMITS.volumeMlMax });
      checkNumber(event, "caffeineMg", "nonNegative", false, { max: DIARY_LIMITS.caffeineMgMax });
      checkNumber(event, "alcoholG", "nonNegative", false, { max: DIARY_LIMITS.alcoholGMax });
      checkNumber(event, "energyKcal", "nonNegative", false, { max: DIARY_LIMITS.energyKcalMax });
      checkNumber(event, "sugarsG", "nonNegative", false, { max: DIARY_LIMITS.sugarsGMax });
      break;
    case "weight":
      checkNumber(event, "kg", "positive", true, {
        min: DIARY_LIMITS.weightKgMin,
        max: DIARY_LIMITS.weightKgMax,
      });
      break;
    case "mood": {
      checkScore(event);
      const tags = event.tags;
      if (tags !== undefined) {
        if (!Array.isArray(tags)) add("tags", "invalid_type");
        else tags.forEach((t: unknown, i) => {
          if (!isNonEmptyString(t)) add(`tags.${i}`, "invalid_type");
        });
      }
      break;
    }
    case "symptom":
      requireEnum(event, "kind", SYMPTOM_KINDS);
      checkScore(event);
      optionalString(event, "label");
      break;
    case "supplement":
      requireString(event, "name");
      optionalString(event, "dose");
      optionalString(event, "lotId");
      break;
    case "habit": {
      requireString(event, "habitId");
      requireString(event, "title");
      requireEnum(event, "kind", MEAL_KINDS);
      const t = event.usualTime;
      if (t !== undefined) {
        if (typeof t !== "string") add("usualTime", "invalid_type");
        else if (!TIME_RE.test(t)) add("usualTime", "invalid_value");
      }
      checkItems(event, true);
      if (event.archived !== undefined && typeof event.archived !== "boolean") {
        add("archived", "invalid_type");
      }
      break;
    }
  }
  return dedupe(errors);
}

function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.path}\u0000${e.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
