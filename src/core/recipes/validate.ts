import {
  validateEnvelope,
  type ValidationError,
  type ValidationErrorCode,
} from "../ledger";
import { UNITS } from "../units";
import {
  DISH_RATINGS,
  FOOD_ID_MAX_LENGTH,
  RECIPE_LIMITS,
  type DishRatingEvent,
  type RecipeEvent,
} from "./types";

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const FOOD_ID_RE = /^[a-z0-9-]+$/;

/** Il tipo dichiarato è `recipe` (una versione di ricetta). */
export function isRecipeEvent(e: unknown): e is RecipeEvent {
  try {
    return isRecord(e) && e.type === "recipe";
  } catch {
    return false;
  }
}

/** Il tipo dichiarato è `dishRating` (com'è andata una cottura). */
export function isDishRatingEvent(e: unknown): e is DishRatingEvent {
  try {
    return isRecord(e) && e.type === "dishRating";
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

/**
 * Errori dell'evento (lista vuota se valido): busta comune più campi propri del tipo.
 * Accetta anche un `void`, che vale per tutto il registro. Non lancia mai.
 * I campi in più sono ignorati, per restare compatibili con versioni future.
 */
export function validateRecipeEvent(event: unknown): ValidationError[] {
  try {
    return validateUnsafe(event);
  } catch {
    // Getter che lanciano, proxy ostili: il valore non è un evento leggibile.
    return [{ path: "", code: "unserializable" }];
  }
}

function validateUnsafe(event: unknown): ValidationError[] {
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
  const checkMinutes = (v: unknown, path: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return add(path, "invalid_type");
    if (v < 0) return add(path, "negative");
    if (v > RECIPE_LIMITS.minutesMax) add(path, "invalid_value");
  };
  const checkStringList = (key: string) => {
    const v = event[key];
    if (v === undefined) return;
    if (!Array.isArray(v)) return add(key, "invalid_type");
    v.forEach((s: unknown, i) => {
      if (!isNonEmptyString(s)) add(`${key}.${i}`, "invalid_type");
    });
  };

  if (event.type === "void") {
    requireString(event, "targetEventId");
    return dedupe(errors);
  }
  if (isDishRatingEvent(event)) {
    requireString(event, "mealId");
    requireString(event, "recipeId");
    const rating = event.rating;
    if (rating !== undefined && !(DISH_RATINGS as readonly unknown[]).includes(rating)) {
      add("rating", typeof rating === "string" ? "invalid_value" : "invalid_type");
    }
    if (event.again !== undefined && typeof event.again !== "boolean") add("again", "invalid_type");
    return dedupe(errors);
  }
  if (!isRecipeEvent(event)) {
    if (event.type !== undefined) add("type", "invalid_value");
    return dedupe(errors);
  }

  requireString(event, "recipeId");
  requireString(event, "title");

  const servings = event.servings;
  if (servings === undefined) add("servings", "required");
  else if (typeof servings !== "number" || !Number.isFinite(servings)) {
    add("servings", "invalid_type");
  } else if (servings <= 0) add("servings", "not_positive");
  else if (servings > RECIPE_LIMITS.servingsMax) add("servings", "invalid_value");

  const ingredients = event.ingredients;
  if (ingredients === undefined) add("ingredients", "required");
  else if (!Array.isArray(ingredients)) add("ingredients", "invalid_type");
  else {
    if (ingredients.length > RECIPE_LIMITS.ingredientsMax) add("ingredients", "invalid_value");
    ingredients.forEach((ing: unknown, i) => {
      const p = `ingredients.${i}`;
      if (!isRecord(ing)) return add(p, "invalid_type");
      requireString(ing, "name", `${p}.name`);
      optionalString(ing, "note", `${p}.note`);
      const foodId = ing.foodId;
      if (foodId !== undefined) {
        if (typeof foodId !== "string") add(`${p}.foodId`, "invalid_type");
        else if (foodId !== "" && (!FOOD_ID_RE.test(foodId) || foodId.length > FOOD_ID_MAX_LENGTH)) {
          add(`${p}.foodId`, "invalid_value");
        }
      }
      const q = ing.quantity;
      if (q !== undefined) {
        if (!isRecord(q)) return add(`${p}.quantity`, "invalid_type");
        if (q.value === undefined) add(`${p}.quantity.value`, "required");
        else if (typeof q.value !== "number" || !Number.isFinite(q.value)) {
          add(`${p}.quantity.value`, "invalid_value");
        } else if (q.value <= 0) add(`${p}.quantity.value`, "not_positive");
        if (q.unit === undefined) add(`${p}.quantity.unit`, "required");
        else if (typeof q.unit !== "string" || !(UNITS as readonly string[]).includes(q.unit)) {
          add(`${p}.quantity.unit`, "invalid_value");
        }
      }
    });
  }

  const steps = event.steps;
  if (steps === undefined) add("steps", "required");
  else if (!Array.isArray(steps)) add("steps", "invalid_type");
  else {
    if (steps.length > RECIPE_LIMITS.stepsMax) add("steps", "invalid_value");
    steps.forEach((st: unknown, i) => {
      const p = `steps.${i}`;
      if (!isRecord(st)) return add(p, "invalid_type");
      requireString(st, "text", `${p}.text`);
      if (st.durationMinutes !== undefined) checkMinutes(st.durationMinutes, `${p}.durationMinutes`);
    });
  }

  const times = event.times;
  if (times !== undefined) {
    if (!isRecord(times)) add("times", "invalid_type");
    else {
      for (const k of ["prepMinutes", "cookMinutes", "totalMinutes"]) {
        if (times[k] !== undefined) checkMinutes(times[k], `times.${k}`);
      }
    }
  }

  checkStringList("equipment");
  checkStringList("tags");

  const origin = event.origin;
  if (origin !== undefined) {
    if (!isRecord(origin)) add("origin", "invalid_type");
    else {
      optionalString(origin, "author", "origin.author");
      const url = origin.url;
      if (url !== undefined) {
        if (typeof url !== "string") add("origin.url", "invalid_type");
        else if (!/^https?:\/\/\S+$/i.test(url)) add("origin.url", "invalid_value");
      }
    }
  }

  const rating = event.rating;
  if (rating !== undefined) {
    if (typeof rating !== "number" || !Number.isFinite(rating)) add("rating", "invalid_type");
    else if (rating < RECIPE_LIMITS.ratingMin || rating > RECIPE_LIMITS.ratingMax) {
      add("rating", "invalid_value");
    }
  }

  if (event.archived !== undefined && typeof event.archived !== "boolean") {
    add("archived", "invalid_type");
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
