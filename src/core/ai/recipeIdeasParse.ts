// Interprete della risposta del modello per le idee di ricetta. Non lancia mai: restituisce le ricette leggibili e i
// problemi incontrati. Gli id sconosciuti si scartano; le quantità assurde si tolgono (l'ingrediente resta, senza quantità).
import { UNITS, normalize, type Quantity, type Unit } from "@/core/units";
import type { RecipeStep, RecipeTimes } from "@/core/recipes";
import { cleanText, extractPayload, findRef, note, readTextList, type DraftProblem, type PantryRef } from "./mealPhraseShared";
import { parseDecimal } from "./numbers";
import { isObj, pick, readText } from "./receiptParse";

export const MAX_IDEAS = 5;
const MAX_INGREDIENTS = 40;
const MAX_STEPS = 30;
const MAX_MINUTES = 24 * 60;
const MAX_SERVINGS = 50;
/** Oltre questi valori (in unità base) un solo ingrediente non è credibile. */
const MAX_BASE = { mass: 10_000, volume: 10_000, count: 100 } as const;
const MAX_LOOSE = 20;

export interface IdeaIngredient {
  name: string;
  /** Assente per «q.b.» o se la quantità non era credibile. */
  quantity?: Quantity;
  note?: string;
  /** Alimento di dispensa dichiarato dal modello: sempre un id che esisteva. Il controllo vero lo fa l'app. */
  pantryId?: string;
}

export interface RecipeIdea {
  title: string;
  servings: number;
  ingredients: IdeaIngredient[];
  steps: RecipeStep[];
  times?: RecipeTimes;
  equipment: string[];
  /** Cottura e conservazione, scritte dal modello: da leggere con giudizio. */
  notes?: string;
}

export interface RecipeIdeasReading {
  ideas: RecipeIdea[];
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
  tazza: "tazza", tazze: "tazza",
  bicchiere: "bicchiere", bicchieri: "bicchiere",
  pz: "pz", pezzi: "pz", pezzo: "pz", n: "pz", unita: "pz", unità: "pz",
  pizzico: "pizzico", pizzichi: "pizzico",
  confezione: "confezione", confezioni: "confezione", conf: "confezione",
};

function readIngredientQuantity(value: unknown, unit: unknown): { quantity?: Quantity; problem?: "invalid" | "implausible" } {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return {};
  const n = parseDecimal(value);
  if (n === undefined || !(n > 0)) return { problem: "invalid" };
  const u = readText(unit, 20)?.toLowerCase();
  let resolved: Unit = "pz";
  if (u !== undefined) {
    const alias = UNIT_ALIASES[u] ?? ((UNITS as readonly string[]).includes(u) ? (u as Unit) : undefined);
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

function readIngredient(entry: unknown, pantry: readonly PantryRef[], label: string, problems: DraftProblem[]): IdeaIngredient | undefined {
  if (!isObj(entry)) {
    note(problems, "invalid_ingredient", `${label}: un ingrediente non era leggibile, lo salto.`, "info");
    return undefined;
  }
  const rawName = readText(pick(entry, "name", "nome"), 80);
  const name = rawName === undefined ? "" : cleanText(rawName, 80);
  if (name === "") {
    note(problems, "invalid_ingredient", `${label}: un ingrediente non aveva il nome, lo salto.`, "info");
    return undefined;
  }
  const { quantity, problem } = readIngredientQuantity(pick(entry, "quantity", "quantita", "quantità"), pick(entry, "unit", "unita", "unità"));
  if (problem) note(problems, problem === "invalid" ? "invalid_quantity" : "implausible_quantity", `${label}: la quantità di «${name}» non era credibile, l'ho tolta.`);

  const rawId = pick(entry, "id", "pantryId", "lotto");
  let pantryId: string | undefined;
  if (rawId !== undefined) {
    const ref = findRef(pantry, rawId);
    if (ref) pantryId = ref.id;
    else note(problems, "unknown_id", `${label}: «${name}» era dato come presente in dispensa con un id che non esiste («${cleanText(String(rawId), 20)}»): lo scarto.`);
  }
  const rawNote = readText(pick(entry, "note", "nota"), 100);
  const noteText = rawNote === undefined ? "" : cleanText(rawNote, 100);
  return { name, ...(quantity ? { quantity } : {}), ...(noteText ? { note: noteText } : {}), ...(pantryId ? { pantryId } : {}) };
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
export function parseRecipeIdeas(text: string, pantry: readonly PantryRef[], options: { truncated?: boolean; servings?: number } = {}): RecipeIdeasReading {
  const problems: DraftProblem[] = [];
  const ideas: RecipeIdea[] = [];
  try {
    const found = extractPayload(text, ["recipes", "ricette"]);
    if (!found) {
      note(problems, "no_json", "Nella risposta non ho trovato nessuna ricetta leggibile.");
      if (options.truncated) note(problems, "truncated", "La risposta si è interrotta prima della fine.");
      return { ideas, problems };
    }
    if (found.salvaged) note(problems, "salvaged", "La risposta era incompleta: ho tenuto solo le ricette complete.");
    else if (options.truncated) note(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza: possono mancare ricette.");

    const raw = pick(found.payload, "recipes", "ricette");
    for (const entry of Array.isArray(raw) ? raw : []) {
      if (ideas.length >= MAX_IDEAS) {
        note(problems, "too_many", `Troppe ricette: ne tengo ${MAX_IDEAS}.`, "info");
        break;
      }
      if (!isObj(entry)) {
        note(problems, "invalid_recipe", "Una ricetta non era leggibile: la salto.", "info");
        continue;
      }
      const rawTitle = readText(pick(entry, "title", "titolo", "name"), 100);
      const title = rawTitle === undefined ? "" : cleanText(rawTitle, 100);
      if (title === "") {
        note(problems, "invalid_recipe", "Una ricetta non aveva il titolo: la salto.", "info");
        continue;
      }
      const ingredients: IdeaIngredient[] = [];
      const rawIngredients = pick(entry, "ingredients", "ingredienti");
      for (const item of Array.isArray(rawIngredients) ? rawIngredients : []) {
        if (ingredients.length >= MAX_INGREDIENTS) break;
        const ing = readIngredient(item, pantry, `«${title}»`, problems);
        if (ing) ingredients.push(ing);
      }
      const steps: RecipeStep[] = [];
      const rawSteps = pick(entry, "steps", "passi", "procedimento");
      for (const item of Array.isArray(rawSteps) ? rawSteps : []) {
        if (steps.length >= MAX_STEPS) break;
        const step = readStep(item);
        if (step) steps.push(step);
      }
      if (ingredients.length === 0 || steps.length === 0) {
        note(problems, "invalid_recipe", `«${title}»: mancano ingredienti o passi leggibili, la scarto.`);
        continue;
      }
      const servingsRaw = parseDecimal(pick(entry, "servings", "porzioni"));
      const servings = servingsRaw !== undefined && servingsRaw > 0 && servingsRaw <= MAX_SERVINGS ? servingsRaw : (options.servings ?? 2);
      const prep = readMinutes(pick(entry, "prepMinutes", "preparazione"));
      const cook = readMinutes(pick(entry, "cookMinutes", "cottura"));
      const noteRaw = readText(pick(entry, "notes", "note", "conservazione"), 300);
      ideas.push({
        title,
        servings: Math.round(servings * 100) / 100,
        ingredients,
        steps,
        ...(prep !== undefined || cook !== undefined ? { times: { ...(prep !== undefined ? { prepMinutes: prep } : {}), ...(cook !== undefined ? { cookMinutes: cook } : {}) } } : {}),
        equipment: readTextList(pick(entry, "equipment", "attrezzatura"), 8, 40),
        ...(noteRaw !== undefined ? { notes: cleanText(noteRaw, 300) } : {}),
      });
    }
  } catch {
    note(problems, "no_json", "Non sono riuscito a interpretare la risposta.");
  }
  return { ideas, problems };
}
