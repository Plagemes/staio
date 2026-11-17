// Interprete della risposta del modello per la foto di un piatto. Non lancia mai.
// Regole fisse: la quantità da foto è sempre una stima e porta il suo intervallo; sotto una soglia di certezza la voce
// non entra nel pasto da sola, diventa una domanda.
import { parseDecimal } from "./numbers";
import { DEFAULT_CONFIDENCE, readConfidence } from "./pantryScan";
import {
  AMOUNT_LIMITS,
  MAX_DRAFT_ITEMS,
  cleanText,
  extractPayload,
  findRef,
  note,
  readTextList,
  type DraftProblem,
  type DraftQuantity,
  type PantryRef,
} from "./mealPhraseShared";
import { readItemAmount } from "./mealPhraseParse";
import { isObj, pick, readText } from "./receiptParse";

/** Sotto questa certezza una voce da foto è una domanda («c'era davvero?»), non una voce del pasto. */
export const PLATE_MIN_CONFIDENCE = 0.6;
/** Se il modello non dà un intervallo credibile, se ne mostra uno largo attorno alla stima. */
export const DEFAULT_RANGE_LOW = 0.7;
export const DEFAULT_RANGE_HIGH = 1.4;

export interface PlateRange {
  min: number;
  max: number;
  /** L'intervallo non veniva dal modello: l'ho ricavato io, largo apposta. */
  derived: boolean;
}

export interface PlateItem {
  /** Nome da mostrare: quello della dispensa se la voce è collegata a un lotto, altrimenti quello visto. */
  name: string;
  /** Identificativo corto della dispensa, sempre uno di quelli inviati. */
  pantryId?: string;
  /** Stima migliore. Assente se il modello non l'ha data: la scrive l'utente. */
  quantity?: DraftQuantity;
  /** Presente se c'è la quantità. */
  range?: PlateRange;
  confidence: number;
  /** Sotto soglia: la voce parte non inclusa e si chiede conferma. */
  question: boolean;
  /** Una quantità da foto è sempre una stima. */
  estimated: true;
}

export interface PlatePhotoDraft {
  items: PlateItem[];
  /** Parti del piatto che il modello non ha saputo riconoscere. */
  unrecognized: string[];
  problems: DraftProblem[];
}

/** La regola della soglia: una voce è una domanda se la certezza è sotto `PLATE_MIN_CONFIDENCE`. */
export function isQuestion(confidence: number): boolean {
  return !(confidence >= PLATE_MIN_CONFIDENCE);
}

const round = (n: number, unit: DraftQuantity["unit"]) => (unit === "pz" ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10);

/** Intervallo credibile attorno alla stima: quello del modello se coerente, altrimenti uno largo ricavato. */
export function rangeFor(quantity: DraftQuantity, rawMin: unknown, rawMax: unknown): PlateRange {
  const { value, unit } = quantity;
  const limit = AMOUNT_LIMITS[unit];
  const lo = parseDecimal(rawMin);
  const hi = parseDecimal(rawMax);
  const usable = lo !== undefined && hi !== undefined && lo > 0 && hi > 0 && lo <= hi && hi <= limit * 2;
  if (!usable) {
    return { min: round(value * DEFAULT_RANGE_LOW, unit), max: round(Math.min(value * DEFAULT_RANGE_HIGH, limit), unit), derived: true };
  }
  // la stima sta sempre dentro l'intervallo: se il modello si contraddice si allarga, non si sposta la stima
  return { min: round(Math.min(lo, value), unit), max: round(Math.max(hi, value), unit), derived: false };
}

/** Interpreta la risposta. Non lancia mai. */
export function parsePlatePhoto(text: string, pantry: readonly PantryRef[], options: { truncated?: boolean } = {}): PlatePhotoDraft {
  const problems: DraftProblem[] = [];
  const items: PlateItem[] = [];
  let unrecognized: string[] = [];
  const seen = new Set<string>();

  try {
    const found = extractPayload(text, ["items", "voci"]);
    if (!found) {
      note(problems, "no_json", "Nella risposta non ho trovato un elenco leggibile.");
      if (options.truncated) note(problems, "truncated", "La risposta si è interrotta prima della fine.");
      return { items, unrecognized, problems };
    }
    if (found.salvaged) note(problems, "salvaged", "La risposta era incompleta: ho tenuto solo le voci che si leggevano.");
    else if (options.truncated) note(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza: alcune voci possono mancare.");

    const raw = pick(found.payload, "items", "voci");
    for (const entry of Array.isArray(raw) ? raw : []) {
      if (!isObj(entry)) {
        note(problems, "invalid_entry", "Una voce non era leggibile: la salto.", "info");
        continue;
      }
      if (items.length >= MAX_DRAFT_ITEMS) {
        note(problems, "too_many", `Troppe voci: ne tengo ${MAX_DRAFT_ITEMS}.`, "info");
        break;
      }
      const seenName = readText(pick(entry, "name", "nome"), 80);
      const rawId = pick(entry, "id", "lot", "lotto");
      let ref = rawId === undefined ? undefined : findRef(pantry, rawId);
      if (rawId !== undefined && ref === undefined) {
        note(problems, "unknown_id", `Il modello ha citato «${cleanText(String(rawId), 20) || "?"}», che non è nella tua dispensa: scarto il collegamento.`);
      }
      if (ref && seen.has(ref.id)) {
        note(problems, "duplicate_id", `${ref.name} compare due volte: tengo la prima voce.`, "info");
        continue;
      }
      const name = ref ? ref.name : seenName === undefined ? "" : cleanText(seenName, 80);
      if (name === "") {
        note(problems, "invalid_entry", "Una voce non aveva il nome: la salto.", "info");
        continue;
      }

      const confidence = readConfidence(pick(entry, "confidence", "certezza")) ?? DEFAULT_CONFIDENCE;
      const { quantity, mismatch } = readItemAmount(entry, name, problems, ref?.remaining.unit);
      let finalQuantity = quantity;
      if (mismatch) {
        note(problems, "unit_mismatch", `${name}: la dispensa lo conta in ${ref?.remaining.unit}, la stima è in ${mismatch.unit}. Lo tengo come voce libera, senza scalare la dispensa.`);
        finalQuantity = mismatch;
        ref = undefined;
      }
      if (ref) seen.add(ref.id);

      items.push({
        name,
        ...(ref ? { pantryId: ref.id } : {}),
        ...(finalQuantity ? { quantity: finalQuantity, range: rangeFor(finalQuantity, pick(entry, "min", "minimo"), pick(entry, "max", "massimo")) } : {}),
        confidence,
        question: isQuestion(confidence),
        estimated: true,
      });
    }
    unrecognized = readTextList(pick(found.payload, "unrecognized", "non_riconosciuto", "unreadable"), 10);
  } catch {
    note(problems, "no_json", "Non sono riuscito a interpretare la risposta.");
  }
  return { items, unrecognized, problems };
}
