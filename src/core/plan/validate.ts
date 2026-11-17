import {
  UNITS,
  isCalendarDate,
  validateEnvelope,
  type ValidationError,
  type ValidationErrorCode,
} from "../ledger";
import { MEAL_KINDS } from "../diary";
import { NUTRIENT_KEYS } from "../nutrition";
import { isMonday, inWeek } from "./calendar";
import { PLAN_EVENT_TYPES, SERVING_LIMITS, type PlanEvent, type PlanEventType } from "./types";

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_MEAL_SLOTS = 12;

/** Il tipo dichiarato è un tipo del piano. */
export function isPlanEvent(e: unknown): e is PlanEvent {
  try {
    return isRecord(e) && oneOf<PlanEventType>(PLAN_EVENT_TYPES, e.type);
  } catch {
    return false;
  }
}

function safeEnvelope(e: unknown): ValidationError[] {
  try {
    return validateEnvelope(e);
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

const isPositiveFinite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Errori dell'evento (lista vuota se valido): busta comune più campi propri del tipo del piano.
 * Non lancia mai. I campi in più sono ignorati, per restare compatibili con versioni future.
 */
export function validatePlanEvent(event: unknown): ValidationError[] {
  const errors: ValidationError[] = [...safeEnvelope(event)];
  if (!isRecord(event)) return errors;
  try {
    validateFields(event, errors);
    return errors;
  } catch {
    return [...errors, { path: "", code: "unserializable" }];
  }
}

function validateFields(event: Rec, errors: ValidationError[]): void {
  const add = (path: string, code: ValidationErrorCode): void => {
    errors.push({ path, code });
  };
  const requireString = (obj: Rec, key: string, path = key): void => {
    const v = obj[key];
    if (v === undefined) add(path, "required");
    else if (!isNonEmptyString(v)) add(path, "invalid_type");
  };
  const optionalString = (obj: Rec, key: string, path = key): void => {
    if (obj[key] !== undefined && typeof obj[key] !== "string") add(path, "invalid_type");
  };
  const checkDate = (v: unknown, path: string): void => {
    if (v === undefined) add(path, "required");
    else if (!isCalendarDate(v)) add(path, "invalid_date");
  };
  const checkTime = (v: unknown, path: string): void => {
    if (typeof v !== "string") add(path, "invalid_type");
    else if (!TIME_RE.test(v)) add(path, "invalid_value");
  };
  const checkStringList = (v: unknown, path: string): void => {
    if (!Array.isArray(v)) {
      add(path, "invalid_type");
      return;
    }
    v.forEach((s, i) => {
      if (!isNonEmptyString(s)) add(`${path}[${i}]`, "invalid_type");
    });
  };

  const checkItem = (item: unknown, path: string): void => {
    if (item === undefined) return add(path, "required");
    if (!isRecord(item)) return add(path, "invalid_type");
    switch (item.kind) {
      case "food": {
        requireString(item, "name", `${path}.name`);
        if (item.foodId !== undefined && !isNonEmptyString(item.foodId)) {
          add(`${path}.foodId`, "invalid_type");
        }
        const q = item.quantity;
        if (q === undefined) return add(`${path}.quantity`, "required");
        if (!isRecord(q)) return add(`${path}.quantity`, "invalid_type");
        if (q.value === undefined) add(`${path}.quantity.value`, "required");
        else if (typeof q.value !== "number" || !Number.isFinite(q.value)) {
          add(`${path}.quantity.value`, "invalid_value");
        } else if (q.value <= 0) add(`${path}.quantity.value`, "not_positive");
        if (q.unit === undefined) add(`${path}.quantity.unit`, "required");
        else if (!oneOf(UNITS, q.unit)) add(`${path}.quantity.unit`, "invalid_value");
        return;
      }
      case "recipe":
      case "prep": {
        const idKey = item.kind === "recipe" ? "recipeId" : "prepId";
        requireString(item, idKey, `${path}.${idKey}`);
        if (item.servings === undefined) add(`${path}.servings`, "required");
        else if (!isPositiveFinite(item.servings)) add(`${path}.servings`, "not_positive");
        else if (item.servings > SERVING_LIMITS.max) add(`${path}.servings`, "invalid_value");
        return;
      }
      case undefined:
        return add(`${path}.kind`, "required");
      default:
        return add(`${path}.kind`, "invalid_value");
    }
  };

  const type = event.type;
  if (!oneOf<PlanEventType>(PLAN_EVENT_TYPES, type)) {
    if (isNonEmptyString(type)) add("type", "invalid_value");
    return;
  }

  switch (type) {
    case "dayType":
      checkDate(event.date, "date");
      requireString(event, "dayType");
      break;

    case "planTargets": {
      requireString(event, "dayType");
      const targets = event.targets;
      if (targets === undefined) return add("targets", "required");
      if (!isRecord(targets)) return add("targets", "invalid_type");
      const keys = Object.keys(targets);
      if (keys.length === 0) add("targets", "required");
      for (const key of keys) {
        const path = `targets.${key}`;
        if (!oneOf(NUTRIENT_KEYS, key)) {
          add(path, "invalid_value");
          continue;
        }
        const range = targets[key];
        if (!isRecord(range)) {
          add(path, "invalid_type");
          continue;
        }
        const { min, max } = range;
        let numeric = true;
        for (const [name, v] of [
          ["min", min],
          ["max", max],
        ] as const) {
          if (v === undefined) continue;
          if (typeof v !== "number" || !Number.isFinite(v)) {
            add(`${path}.${name}`, "invalid_value");
            numeric = false;
          } else if (v < 0) {
            add(`${path}.${name}`, "negative");
            numeric = false;
          }
        }
        if (min === undefined && max === undefined) add(path, "required");
        else if (numeric && typeof min === "number" && typeof max === "number" && min > max) {
          add(`${path}.min`, "invalid_value");
        }
      }
      break;
    }

    case "planStructure": {
      const meals = event.meals;
      if (meals === undefined) add("meals", "required");
      else if (!Array.isArray(meals)) add("meals", "invalid_type");
      else {
        if (meals.length === 0 || meals.length > MAX_MEAL_SLOTS) add("meals", "invalid_value");
        meals.forEach((m, i) => {
          const path = `meals[${i}]`;
          if (!isRecord(m)) return add(path, "invalid_type");
          if (m.kind === undefined) add(`${path}.kind`, "required");
          else if (!oneOf(MEAL_KINDS, m.kind)) add(`${path}.kind`, "invalid_value");
          if (m.time !== undefined) checkTime(m.time, `${path}.time`);
        });
      }
      const win = event.eatingWindow;
      if (win !== undefined) {
        if (!isRecord(win)) add("eatingWindow", "invalid_type");
        else {
          if (win.from === undefined) add("eatingWindow.from", "required");
          else checkTime(win.from, "eatingWindow.from");
          if (win.to === undefined) add("eatingWindow.to", "required");
          else checkTime(win.to, "eatingWindow.to");
        }
      }
      if (event.excludedFoods !== undefined) checkStringList(event.excludedFoods, "excludedFoods");
      if (event.allergens !== undefined) checkStringList(event.allergens, "allergens");
      if (event.defaultDayType !== undefined && !isNonEmptyString(event.defaultDayType)) {
        add("defaultDayType", "invalid_type");
      }
      break;
    }

    case "planWeek": {
      const weekStart = event.weekStart;
      if (weekStart === undefined) add("weekStart", "required");
      else if (!isCalendarDate(weekStart)) add("weekStart", "invalid_date");
      else if (!isMonday(weekStart)) add("weekStart", "invalid_value");
      const entries = event.entries;
      if (entries === undefined) return add("entries", "required");
      if (!Array.isArray(entries)) return add("entries", "invalid_type");
      const weekOk = isMonday(weekStart);
      entries.forEach((entry, i) => {
        const path = `entries[${i}]`;
        if (!isRecord(entry)) return add(path, "invalid_type");
        if (entry.date === undefined) add(`${path}.date`, "required");
        else if (!isCalendarDate(entry.date)) add(`${path}.date`, "invalid_date");
        else if (weekOk && !inWeek(weekStart as string, entry.date)) {
          add(`${path}.date`, "invalid_value");
        }
        if (entry.meal === undefined) add(`${path}.meal`, "required");
        else if (!oneOf(MEAL_KINDS, entry.meal)) add(`${path}.meal`, "invalid_value");
        optionalString(entry, "note", `${path}.note`);
        checkItem(entry.item, `${path}.item`);
      });
      break;
    }
  }
}
