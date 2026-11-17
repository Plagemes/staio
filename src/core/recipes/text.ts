// Lettura di una ricetta da testo libero incollato. Riconoscimento prudente: ciò che non si capisce
// resta come testo in `unrecognized`, niente invenzioni.

import { parseDurationText, stepDurationFromText } from "./duration";
import { cleanLine, parseIngredientLine, type ParsedIngredient } from "./ingredient";
import { RECIPE_LIMITS, type RecipeStep, type RecipeTimes } from "./types";

export interface ParsedRecipeText {
  title?: string;
  servings?: number;
  times?: RecipeTimes;
  ingredients: ParsedIngredient[];
  steps: RecipeStep[];
  /** Righe non riconosciute, nell'ordine in cui compaiono. */
  unrecognized: string[];
  /** Vero se il testo ha le intestazioni degli ingredienti e della preparazione. */
  structured: boolean;
}

const MAX_CHARS = 100_000;
const MAX_LINES = 2000;
const MAX_LINE_CHARS = 5000;
/** Oltre questa lunghezza una riga non è un'intestazione né una riga di porzioni o tempi. */
const SHORT_LINE = 200;

const ING_HEADING =
  /^(?:#{1,6}\s*)?(?:ingredienti|ingredients|occorrente|ingredienti\s+necessari)\b\s*(?:(?:per|for)\s+(\d+)\s*(?:persone|porzioni|servings|people)?)?\s*[:.]?\s*(?:\([^)]*\))?\s*$/i;
const STEP_HEADING =
  /^(?:#{1,6}\s*)?(?:preparazione|procedimento|istruzioni|metodo|come\s+si\s+prepara|svolgimento|directions|instructions|method|preparation|steps)\s*:?\s*$/i;
const SERVINGS_LINE =
  /^(?:porzioni|dosi|persone|serves?|servings?|resa|yield|per)\s*[:\-]?\s*(?:per\s*)?(\d{1,3})(?:\s*(?:persone|porzioni|servings|people))?\s*$/i;
const SERVINGS_FOR = /^(?:dosi\s+)?per\s+(\d{1,3})\s*(?:persone|porzioni)\s*[:.]?$/i;
const TIME_LINE =
  /^(?:tempo(?:\s+di)?|time)?\s*(preparazione|cottura|totale|prep|cook|cooking|total)(?:\s+time)?\s*[:\-]\s*(.+)$/i;
const GENERIC_TIME_LINE = /^(?:tempo|time)\s*[:\-]\s*(.+)$/i;
const NUMBERING = /^(?:(?:passo|step|punto|fase)\s*)?\d{1,2}\s*[.):\-]\s+/i;

/** Una riga che comincia con una quantità e un'unità o un numero, abbastanza corta da essere un ingrediente. */
function looksLikeIngredient(line: string): ParsedIngredient | null {
  if (line.length > 90 || /[.!?]$/.test(line)) return null;
  const p = parseIngredientLine(line);
  return p?.quantity ? p : null;
}

/**
 * Legge una ricetta da testo incollato: titolo, porzioni, tempi, ingredienti (quantità, unità,
 * nome) e passi. Non lancia mai.
 */
export function parseRecipeText(input: string): ParsedRecipeText {
  const result: ParsedRecipeText = {
    ingredients: [],
    steps: [],
    unrecognized: [],
    structured: false,
  };
  try {
    const text = String(input ?? "").slice(0, MAX_CHARS);
    const lines = text.split(/\r\n|\r|\n/).slice(0, MAX_LINES);
    let section: "none" | "ingredients" | "steps" = "none";
    let sawIng = false;
    let sawSteps = false;
    let titleDone = false;
    const times: RecipeTimes = {};

    for (const rawLine of lines) {
      // Spazi compattati e riga accorciata: le espressioni sulle intestazioni lavorano solo su righe brevi.
      const line = rawLine.slice(0, MAX_LINE_CHARS).replace(/\s+/g, " ").trim();
      if (line === "") continue;
      const short = line.length <= SHORT_LINE;

      if (!titleDone) {
        titleDone = true;
        const t = line.replace(/^#{1,6}\s*/, "").replace(/^(?:ricetta|titolo)\s*[:\-]\s*/i, "").trim();
        const isHeading = short && (ING_HEADING.test(line) || STEP_HEADING.test(line));
        const isMeta = short && (SERVINGS_LINE.test(line) || SERVINGS_FOR.test(line) || TIME_LINE.test(line));
        if (
          t !== "" &&
          t.length <= 120 &&
          !isHeading &&
          !isMeta &&
          !/[.!?]$/.test(t) &&
          !looksLikeIngredient(t) &&
          !NUMBERING.test(t)
        ) {
          result.title = t.replace(/\*\*|__/g, "").trim();
          continue;
        }
      }

      const ih = short ? ING_HEADING.exec(line) : null;
      if (ih) {
        section = "ingredients";
        sawIng = true;
        if (ih[1] !== undefined) setServings(result, Number(ih[1]));
        continue;
      }
      if (short && STEP_HEADING.test(line)) {
        section = "steps";
        sawSteps = true;
        continue;
      }

      const sv = short ? (SERVINGS_LINE.exec(line) ?? SERVINGS_FOR.exec(line)) : null;
      if (sv) {
        setServings(result, Number(sv[1]));
        continue;
      }
      const tl = short ? TIME_LINE.exec(line) : null;
      if (tl) {
        const minutes = parseDurationText(tl[2] as string);
        if (minutes !== undefined) {
          const kind = (tl[1] as string).toLowerCase();
          if (/^prep/.test(kind)) times.prepMinutes = minutes;
          else if (/^(cottura|cook)/.test(kind)) times.cookMinutes = minutes;
          else times.totalMinutes = minutes;
          continue;
        }
      }
      const gt = short ? GENERIC_TIME_LINE.exec(line) : null;
      if (gt) {
        const minutes = parseDurationText(gt[1] as string);
        if (minutes !== undefined) {
          times.totalMinutes = minutes;
          continue;
        }
      }

      if (section === "ingredients") {
        // "Per la crema:" e simili sono etichette di gruppo, non ingredienti.
        if (/:$/.test(line) && !/\d/.test(line)) {
          result.unrecognized.push(line);
          continue;
        }
        const p = parseIngredientLine(line);
        if (p && (p.recognized || line.length <= 60)) result.ingredients.push(p);
        else result.unrecognized.push(cleanLine(line));
        continue;
      }
      if (section === "steps") {
        pushStep(result, line);
        continue;
      }

      // Nessuna intestazione ancora: solo ciò che è inequivocabile.
      if (NUMBERING.test(line) && /[a-zàèéìòù]{3}/i.test(line.replace(NUMBERING, ""))) {
        pushStep(result, line);
        continue;
      }
      const p = looksLikeIngredient(line);
      if (p) result.ingredients.push(p);
      else result.unrecognized.push(cleanLine(line));
    }

    if (Object.keys(times).length > 0) result.times = times;
    result.structured = sawIng && sawSteps;
    result.ingredients = result.ingredients.slice(0, RECIPE_LIMITS.ingredientsMax);
    result.steps = result.steps.slice(0, RECIPE_LIMITS.stepsMax);
  } catch {
    // Mai un'eccezione: si restituisce quanto letto finora.
  }
  return result;
}

function setServings(r: ParsedRecipeText, n: number): void {
  if (Number.isFinite(n) && n > 0 && n <= RECIPE_LIMITS.servingsMax && r.servings === undefined) {
    r.servings = n;
  }
}

function pushStep(r: ParsedRecipeText, line: string): void {
  const text = line.slice(0, 2100).replace(NUMBERING, "").replace(/^[-–—•*·]\s*/, "").trim();
  if (text.length < 3) return;
  const d = stepDurationFromText(text);
  r.steps.push({ text, ...(d !== undefined ? { durationMinutes: d } : {}) });
}
