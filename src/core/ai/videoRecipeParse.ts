// Interprete della risposta del modello per la ricetta di un video. Non lancia mai.
// Regole fisse: il testo del modello è solo testo (mai HTML, mai istruzioni: si leggono soltanto i campi previsti e
// tutto il resto si ignora); una quantità assente resta assente e non diventa mai zero; una quantità assurda si toglie
// e l'ingrediente resta, senza quantità; ciò che il modello ha dedotto e non letto è segnalato come incerto.
import type { RecipeStep, RecipeTimes } from "@/core/recipes";
import { UNITS, normalize, type Quantity, type Unit } from "@/core/units";
import { cleanText, extractPayload, note, readTextList, type DraftProblem } from "./mealPhraseShared";
import { parseDecimal } from "./numbers";
import { isObj, pick, readText } from "./receiptParse";

export const MAX_VIDEO_INGREDIENTS = 60;
export const MAX_VIDEO_STEPS = 40;
const MAX_MINUTES = 24 * 60;
const MAX_SERVINGS = 50;
const MAX_UNCERTAIN = 12;
/** Oltre questi valori (in unità base) un solo ingrediente non è credibile. */
const MAX_BASE = { mass: 10_000, volume: 10_000, count: 100 } as const;
const MAX_LOOSE = 20;

export interface VideoIngredient {
  name: string;
  /** Assente per «q.b.», per una quantità non detta o non credibile. Mai zero. */
  quantity?: Quantity;
  note?: string;
  /** Dedotto dal modello (non detto né scritto): da controllare. */
  inferred: boolean;
}

export interface VideoRecipe {
  title?: string;
  /** Assente se il video non le dice: non si inventano. */
  servings?: number;
  ingredients: VideoIngredient[];
  steps: RecipeStep[];
  times?: RecipeTimes;
  equipment: string[];
}

export interface VideoRecipeReading {
  /** Il modello ha trovato una ricetta e si è letto almeno un ingrediente o un passo. */
  isRecipe: boolean;
  recipe?: VideoRecipe;
  /** Cose di cui il modello non era sicuro, più gli ingredienti dedotti. */
  uncertain: string[];
  problems: DraftProblem[];
}

const UNIT_ALIASES: Readonly<Record<string, Unit>> = {
  g: "g", gr: "g", grammo: "g", grammi: "g",
  kg: "kg", kilo: "kg", chili: "kg", chilo: "kg",
  hg: "hg", etto: "hg", etti: "hg",
  mg: "mg",
  ml: "ml", millilitri: "ml", millilitro: "ml",
  cl: "cl", dl: "dl",
  l: "l", lt: "l", litro: "l", litri: "l",
  cucchiaio: "cucchiaio", cucchiai: "cucchiaio",
  cucchiaino: "cucchiaino", cucchiaini: "cucchiaino",
  tazza: "tazza", tazze: "tazza", cup: "tazza", cups: "tazza",
  bicchiere: "bicchiere", bicchieri: "bicchiere",
  pz: "pz", pezzi: "pz", pezzo: "pz", n: "pz", unita: "pz", unità: "pz",
  pizzico: "pizzico", pizzichi: "pizzico",
  confezione: "confezione", confezioni: "confezione", conf: "confezione",
};

/** Numero scritto da un modello: anche frazioni semplici come «1/2» e «1 1/2». */
function readNumber(value: unknown): number | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    const mixed = /^(\d{1,3})\s+(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(t);
    if (mixed) {
      const d = Number(mixed[3]);
      return d > 0 ? Number(mixed[1]) + Number(mixed[2]) / d : undefined;
    }
    const frac = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(t);
    if (frac) {
      const d = Number(frac[2]);
      return d > 0 ? Number(frac[1]) / d : undefined;
    }
  }
  return parseDecimal(value);
}

const isAbsent = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

type QuantityRead = { quantity?: Quantity; problem?: "invalid" | "implausible" };

function readQuantity(value: unknown, unit: unknown): QuantityRead {
  if (isAbsent(value)) return {};
  const n = readNumber(value);
  if (n === undefined || !(n > 0)) return { problem: "invalid" };
  const u = readText(unit, 20)?.toLowerCase();
  let resolved: Unit = "pz";
  if (u !== undefined) {
    const alias = Object.hasOwn(UNIT_ALIASES, u) ? UNIT_ALIASES[u] : (UNITS as readonly string[]).includes(u) ? (u as Unit) : undefined;
    if (alias === undefined) return { problem: "invalid" };
    resolved = alias;
  }
  const quantity: Quantity = { value: Math.round(n * 100) / 100, unit: resolved };
  if (!(quantity.value > 0)) return { problem: "invalid" };
  if (resolved === "pizzico" || resolved === "confezione") return quantity.value > MAX_LOOSE ? { problem: "implausible" } : { quantity };
  const base = normalize(quantity);
  if (!base.ok) return { problem: "invalid" };
  const limit = base.value.unit === "g" ? MAX_BASE.mass : base.value.unit === "ml" ? MAX_BASE.volume : MAX_BASE.count;
  return base.value.value > limit ? { problem: "implausible" } : { quantity };
}

function readMinutes(value: unknown): number | undefined {
  const n = parseDecimal(value);
  return n !== undefined && n > 0 && n <= MAX_MINUTES ? Math.round(n) : undefined;
}

function readFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "true" || t === "vero" || t === "sì" || t === "si") return true;
    if (t === "false" || t === "falso" || t === "no") return false;
  }
  return undefined;
}

function readIngredient(entry: unknown, problems: DraftProblem[]): VideoIngredient | undefined {
  if (typeof entry === "string") {
    const name = cleanText(entry, 80);
    return name === "" ? undefined : { name, inferred: false };
  }
  if (!isObj(entry)) {
    note(problems, "invalid_ingredient", "Un ingrediente non era leggibile: lo salto.", "info");
    return undefined;
  }
  const rawName = readText(pick(entry, "name", "nome"), 80);
  const name = rawName === undefined ? "" : cleanText(rawName, 80);
  if (name === "") {
    note(problems, "invalid_ingredient", "Un ingrediente non aveva il nome: lo salto.", "info");
    return undefined;
  }
  const { quantity, problem } = readQuantity(pick(entry, "quantity", "quantita", "quantità"), pick(entry, "unit", "unita", "unità"));
  if (problem) {
    note(problems, problem === "invalid" ? "invalid_quantity" : "implausible_quantity", `La quantità di «${name}» non era credibile: l'ho tolta, la scrivi tu.`);
  }
  const rawNote = readText(pick(entry, "note", "nota"), 100);
  const noteText = rawNote === undefined ? "" : cleanText(rawNote, 100);
  return {
    name,
    ...(quantity ? { quantity } : {}),
    ...(noteText ? { note: noteText } : {}),
    inferred: readFlag(pick(entry, "inferred", "dedotto")) === true,
  };
}

function readStep(entry: unknown): RecipeStep | undefined {
  if (typeof entry === "string") {
    const text = cleanText(entry, 400);
    return text === "" ? undefined : { text };
  }
  if (!isObj(entry)) return undefined;
  const raw = readText(pick(entry, "text", "testo", "step"), 400);
  const text = raw === undefined ? "" : cleanText(raw, 400);
  if (text === "") return undefined;
  const durationMinutes = readMinutes(pick(entry, "minutes", "minuti", "durationMinutes"));
  return { text, ...(durationMinutes !== undefined ? { durationMinutes } : {}) };
}

/** Interpreta la risposta. Non lancia mai. */
export function parseVideoRecipe(text: string, options: { truncated?: boolean } = {}): VideoRecipeReading {
  const problems: DraftProblem[] = [];
  const empty = (): VideoRecipeReading => ({ isRecipe: false, uncertain: [], problems });
  try {
    const found = extractPayload(text, ["ingredients", "ingredienti", "steps", "passi", "isRecipe", "e_ricetta"]);
    if (!found) {
      note(problems, "no_json", "Nella risposta non ho trovato una ricetta leggibile.");
      if (options.truncated) note(problems, "truncated", "La risposta si è interrotta prima della fine.");
      return empty();
    }
    if (found.salvaged) note(problems, "salvaged", "La risposta era incompleta: ho tenuto solo le parti complete.");
    else if (options.truncated) note(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza: possono mancare ingredienti o passi.");

    const payload = found.payload;
    const declared = readFlag(pick(payload, "isRecipe", "e_ricetta"));
    if (declared === false) {
      note(problems, "invalid_recipe", "Il modello non ha trovato una ricetta in questo video.", "info");
      return empty();
    }

    const ingredients: VideoIngredient[] = [];
    const rawIngredients = pick(payload, "ingredients", "ingredienti");
    for (const item of Array.isArray(rawIngredients) ? rawIngredients : []) {
      if (ingredients.length >= MAX_VIDEO_INGREDIENTS) {
        note(problems, "too_many", `Troppi ingredienti: ne tengo ${MAX_VIDEO_INGREDIENTS}.`, "info");
        break;
      }
      const ing = readIngredient(item, problems);
      if (ing) ingredients.push(ing);
    }
    const steps: RecipeStep[] = [];
    const rawSteps = pick(payload, "steps", "passi", "procedimento");
    for (const item of Array.isArray(rawSteps) ? rawSteps : []) {
      if (steps.length >= MAX_VIDEO_STEPS) {
        note(problems, "too_many", `Troppi passi: ne tengo ${MAX_VIDEO_STEPS}.`, "info");
        break;
      }
      const step = readStep(item);
      if (step) steps.push(step);
    }
    if (ingredients.length === 0 && steps.length === 0) {
      note(problems, "invalid_recipe", "Nella risposta non c'erano né ingredienti né passi leggibili.");
      return empty();
    }

    const rawTitle = readText(pick(payload, "title", "titolo", "name"), 100);
    const title = rawTitle === undefined ? "" : cleanText(rawTitle, 100);
    const servingsRaw = readNumber(pick(payload, "servings", "porzioni"));
    const servings = servingsRaw !== undefined && servingsRaw > 0 && servingsRaw <= MAX_SERVINGS ? Math.round(servingsRaw * 100) / 100 : undefined;
    if (!isAbsent(pick(payload, "servings", "porzioni")) && servings === undefined) {
      note(problems, "invalid_quantity", "Le porzioni non erano credibili: le scrivi tu.", "info");
    }
    const prep = readMinutes(pick(payload, "prepMinutes", "preparazione"));
    const cook = readMinutes(pick(payload, "cookMinutes", "cottura"));
    const equipment = readTextList(pick(payload, "equipment", "attrezzatura"), 8, 40);

    const uncertain = readTextList(pick(payload, "uncertain", "incerto", "dubbi"), MAX_UNCERTAIN, 160);
    for (const ing of ingredients) {
      if (ing.inferred && uncertain.length < MAX_UNCERTAIN * 2) uncertain.push(`«${ing.name}» non è detto né scritto: l'ho dedotto dalle immagini.`);
    }

    return {
      isRecipe: true,
      recipe: {
        ...(title ? { title } : {}),
        ...(servings !== undefined ? { servings } : {}),
        ingredients,
        steps,
        ...(prep !== undefined || cook !== undefined ? { times: { ...(prep !== undefined ? { prepMinutes: prep } : {}), ...(cook !== undefined ? { cookMinutes: cook } : {}) } } : {}),
        equipment,
      },
      uncertain,
      problems,
    };
  } catch {
    note(problems, "no_json", "Non sono riuscito a interpretare la risposta.");
    return empty();
  }
}
