// Interprete della risposta del modello per la tabella nutrizionale di un'etichetta. Non lancia mai.
// Ciò che esce è una bozza: niente viene corretto in silenzio. Ciò che si ricava (kcal dai kJ, sale dal sodio) è dichiarato
// come tale; i controlli di plausibilità stanno in `labelNutritionCheck` e girano anche mentre l'utente corregge.
import { problem, extractPayload, type ReadProblem } from "./labelShared";
import { cleanText, readTextList } from "./mealPhraseShared";
import { parseDecimal } from "./numbers";
import { DEFAULT_CONFIDENCE, readConfidence } from "./pantryScan";
import { pick, readText } from "./receiptParse";

export const NUTRIENT_FIELDS = ["energyKcal", "fat", "saturatedFat", "carbohydrates", "sugars", "fiber", "proteins", "salt"] as const;
export type NutrientField = (typeof NUTRIENT_FIELDS)[number];
export type LabelNutrients = Partial<Record<NutrientField, number>>;
export type LabelBasis = "100g" | "100ml" | "serving" | "unclear";

/** Sotto questa certezza la lettura dei numeri si segnala come incerta. */
export const LABEL_MIN_CONFIDENCE = 0.5;
export const KJ_PER_KCAL = 4.184;
const MAX_INGREDIENTS = 4000;

export interface LabelReading {
  found: boolean;
  name?: string;
  /** L'intestazione della colonna da cui il modello ha preso i valori, com'è stampata. */
  columnHeader?: string;
  basis: LabelBasis;
  serving?: { value: number; unit: "g" | "ml" };
  nutrients: LabelNutrients;
  /** Il valore in kJ come stampato, per il controllo di coerenza con le kcal. */
  energyKj?: number;
  ingredients?: string;
  ingredientsLang?: string;
  /** Il modello dice che l'elenco è completo. Solo un'indicazione: conta come completo solo se lo conferma l'utente. */
  ingredientsComplete?: boolean;
  allergens: string[];
  traces: string[];
  confidence: number;
  problems: ReadProblem[];
}

const empty = (): LabelReading => ({ found: false, basis: "unclear", nutrients: {}, allergens: [], traces: [], confidence: 0, problems: [] });

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Numero da un campo: «12,5», «<0,5 g», «350 kcal». Undefined se non è un numero. */
function readValue(value: unknown, field: string, problems: ReadProblem[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  let n: number | undefined;
  let approximate = false;
  if (typeof value === "number") n = Number.isFinite(value) ? value : undefined;
  else if (typeof value === "string") {
    let s = value.trim();
    if (/^(<|≤|~|circa|ca\.?)/i.test(s)) {
      approximate = true;
      s = s.replace(/^(<|≤|~|circa|ca\.?)\s*/i, "");
    }
    const milli = /\bmg\s*$/i.test(s);
    s = s.replace(/\s*(kcal|kj|mg|g|ml)\.?\s*$/i, "");
    n = parseDecimal(s);
    if (n !== undefined && milli && field !== "energyKcal" && field !== "energyKj") n /= 1000;
  }
  if (n === undefined || n < 0) {
    problems.push(problem("invalid_value", "warning", `Il valore letto per «${field}» non è un numero valido: lo lascio vuoto.`, field));
    return undefined;
  }
  if (approximate) problems.push(problem("approximate", "info", `Un valore era scritto come «${String(value).trim()}»: ho tenuto il numero, controllalo.`, field));
  return n;
}

const SERVING_HEADER = /(porzion|serving|portion|\bper\s+\d+(?:[.,]\d+)?\s*(?:g|ml)\b)/i;
const HUNDRED_HEADER = /\b100\s*(g|ml)\b/i;

function readBasis(value: unknown): LabelBasis {
  const s = readText(value, 20)?.toLowerCase().replace(/\s+/g, "");
  if (s === "100g") return "100g";
  if (s === "100ml") return "100ml";
  if (s === "serving" || s === "porzione") return "serving";
  return "unclear";
}

/** Risposta tagliata a metà: si recuperano i campi semplici già scritti per intero (numeri, testi, vero/falso). */
function salvageScalars(text: string): Record<string, unknown> | undefined {
  if (typeof text !== "string") return undefined;
  const out: Record<string, unknown> = {};
  const pattern = /"([A-Za-z]+)"\s*:\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|true|false|null)(?=\s*[,}\]])/g;
  for (const m of text.matchAll(pattern)) {
    try {
      out[m[1]] = JSON.parse(m[2]);
    } catch {
      // campo illeggibile: si salta
    }
  }
  return "energyKcal" in out || "energyKj" in out || "fat" in out || "proteins" in out || "carbohydrates" in out ? out : undefined;
}

/** Interpreta la risposta. Non lancia mai. */
export function parseLabelNutrition(text: string, options: { truncated?: boolean } = {}): LabelReading {
  const reading = empty();
  const problems = reading.problems;
  try {
    let found = extractPayload(text, ["found", "per", "energyKcal", "fat", "proteins", "carbohydrates", "ingredients", "energyKj"]);
    if (!found && options.truncated) {
      const scalars = salvageScalars(text);
      if (scalars) found = { payload: scalars, salvaged: true };
    }
    if (!found) {
      problems.push(problem("no_json", "warning", "Nella risposta non ho trovato una tabella leggibile."));
      if (options.truncated) problems.push(problem("truncated", "warning", "La risposta si è interrotta prima della fine."));
      return reading;
    }
    const p = found.payload;
    if (options.truncated) problems.push(problem("truncated", "warning", "La risposta si è interrotta per il limite di lunghezza: un valore può mancare."));

    const name = readText(pick(p, "name", "nome"), 80);
    if (name !== undefined && cleanText(name, 80) !== "") reading.name = cleanText(name, 80);
    reading.confidence = readConfidence(pick(p, "confidence", "certezza")) ?? DEFAULT_CONFIDENCE;

    const values: LabelNutrients = {};
    for (const field of NUTRIENT_FIELDS) {
      if (field === "salt") continue;
      const v = readValue(pick(p, field), field, problems);
      if (v !== undefined) values[field] = round(v, field === "energyKcal" ? 0 : 2);
    }
    const kj = readValue(pick(p, "energyKj", "kj"), "energyKj", problems);
    if (kj !== undefined) reading.energyKj = Math.round(kj);
    if (values.energyKcal === undefined && kj !== undefined) {
      values.energyKcal = Math.round(kj / KJ_PER_KCAL);
      problems.push(problem("derived", "info", `Sull'etichetta c'erano solo i kJ (${Math.round(kj)}): le kcal (${values.energyKcal}) sono calcolate, dividendo per ${String(KJ_PER_KCAL).replace(".", ",")}.`, "energyKcal"));
    }
    const salt = readValue(pick(p, "salt", "sale"), "salt", problems);
    const sodium = readValue(pick(p, "sodium", "sodio"), "sodium", problems);
    if (salt !== undefined) values.salt = round(salt, 2);
    else if (sodium !== undefined) {
      values.salt = round(sodium * 2.5, 2);
      problems.push(problem("derived", "info", `Sull'etichetta c'era il sodio (${String(sodium).replace(".", ",")} g): il sale (${String(values.salt).replace(".", ",")} g) è calcolato, moltiplicando per 2,5.`, "salt"));
    }
    reading.nutrients = values;

    const servingValue = readValue(pick(p, "servingSize", "serving", "porzione"), "servingSize", problems);
    const servingUnit = readText(pick(p, "servingUnit"), 5)?.toLowerCase();
    if (servingValue !== undefined && servingValue > 0 && (servingUnit === "g" || servingUnit === "ml")) {
      reading.serving = { value: servingValue, unit: servingUnit };
    }

    // la base dei valori: la dichiara il modello, ma l'intestazione stampata ha l'ultima parola
    const header = readText(pick(p, "columnHeader", "intestazione"), 80);
    if (header !== undefined) reading.columnHeader = cleanText(header, 80);
    const hundred = reading.columnHeader ? HUNDRED_HEADER.exec(reading.columnHeader) : null;
    const headerSaysServing = reading.columnHeader !== undefined && SERVING_HEADER.test(reading.columnHeader) && !hundred;
    let basis = readBasis(pick(p, "per", "basis"));
    if (headerSaysServing && (basis === "100g" || basis === "100ml")) {
      basis = "serving";
      problems.push(problem("serving_as_100", "warning", `Il modello li dava per 100, ma l'intestazione della colonna dice «${reading.columnHeader}»: li ho segnati come per porzione. Controlla.`));
    } else if (hundred && basis === "serving") {
      basis = "unclear";
    } else if (basis === "unclear" && hundred) {
      basis = hundred[1].toLowerCase() === "ml" ? "100ml" : "100g";
    } else if (basis === "unclear" && headerSaysServing) {
      basis = "serving";
    }
    reading.basis = basis;

    const hasValues = Object.keys(values).length > 0;
    const declaredFound = pick(p, "found", "trovata");
    reading.found = hasValues && declaredFound !== false && declaredFound !== "false";
    if (!reading.found) {
      problems.push(problem("no_table", "warning", "Non ho trovato nella foto una tabella nutrizionale leggibile. Riprova con una foto più vicina, dritta e senza riflessi."));
    } else if (reading.confidence < LABEL_MIN_CONFIDENCE) {
      problems.push(problem("low_confidence", "warning", "Lettura poco sicura: controlla ogni numero con la confezione."));
    }

    const ingredients = readText(pick(p, "ingredients", "ingredienti"), MAX_INGREDIENTS + 1);
    if (ingredients !== undefined) {
      const cleaned = cleanText(ingredients.replace(/^ingredienti\s*:?\s*/i, ""), MAX_INGREDIENTS);
      if (cleaned !== "") {
        reading.ingredients = cleaned;
        const lang = readText(pick(p, "ingredientsLanguage", "lingua"), 5)?.toLowerCase();
        if (lang !== undefined && /^[a-z]{2,3}$/.test(lang)) reading.ingredientsLang = lang;
        const complete = pick(p, "ingredientsComplete", "completo");
        if (typeof complete === "boolean") reading.ingredientsComplete = complete;
        if (complete === false) {
          problems.push(problem("ingredients_partial", "warning", "Il modello segnala che l'elenco degli ingredienti può essere tagliato o in parte illeggibile: confrontalo con la confezione."));
        }
        if (ingredients.length > MAX_INGREDIENTS) problems.push(problem("truncated", "warning", "L'elenco degli ingredienti era molto lungo: ho tenuto solo l'inizio. Controlla l'etichetta."));
      }
    }
    reading.allergens = readTextList(pick(p, "allergens", "allergeni"), 14, 60);
    reading.traces = readTextList(pick(p, "traces", "tracce"), 14, 60);
    if (found.salvaged) problems.push(problem("salvaged", "info", "La risposta era incompleta: ho tenuto solo ciò che si leggeva."));
    for (const note of readTextList(pick(p, "notes", "note"), 4, 120)) problems.push(problem("approximate", "info", `Nota del modello: ${note}`));
  } catch {
    return { ...empty(), problems: [problem("no_json", "warning", "Non sono riuscito a interpretare la risposta.")] };
  }
  return reading;
}
