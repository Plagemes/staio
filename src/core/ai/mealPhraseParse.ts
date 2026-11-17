// Interprete della risposta del modello per il pasto da una frase. Non lancia mai. Ogni identificativo che non era
// nell'elenco inviato viene scartato; ogni quantità assurda diventa «da scrivere a mano». Tutto è una bozza.
import type { MealKind } from "@/core/diary";
import { DEFAULT_CONFIDENCE, readConfidence } from "./pantryScan";
import {
  MAX_DRAFT_ITEMS,
  cleanText,
  extractPayload,
  findRef,
  note,
  readAmount,
  readMealKind,
  readTextList,
  type DraftProblem,
  type DraftQuantity,
  type PantryRef,
} from "./mealPhraseShared";
import { isObj, pick, readText } from "./receiptParse";

/** Voce presa dalla dispensa: si scrive come consumo di quel lotto, solo dopo la conferma. */
export interface DraftPantryItem {
  /** Identificativo corto, sempre uno di quelli inviati. */
  pantryId: string;
  /** Assente se la risposta non la dava o non era credibile: la scrive l'utente. */
  quantity?: DraftQuantity;
  confidence: number;
}

/** Voce senza lotto: nome e quantità stimata; l'alimento della tabella lo sceglie l'utente. */
export interface DraftFreeItem {
  name: string;
  quantity?: DraftQuantity;
  confidence: number;
}

export interface MealPhraseDraft {
  kind?: MealKind;
  items: DraftPantryItem[];
  free: DraftFreeItem[];
  /** Parti della frase che il modello non ha capito. */
  unclear: string[];
  problems: DraftProblem[];
}

export const EMPTY_PHRASE_DRAFT: MealPhraseDraft = { items: [], free: [], unclear: [], problems: [] };

/**
 * Legge la quantità di una voce. Con `lotUnit` (voce di dispensa) deve essere nell'unità del lotto; se non lo è, chi
 * chiama la trasforma in voce libera.
 */
export function readItemAmount(
  entry: Record<string, unknown>,
  label: string,
  problems: DraftProblem[],
  lotUnit?: DraftQuantity["unit"],
): { quantity?: DraftQuantity; mismatch?: DraftQuantity } {
  const read = readAmount(pick(entry, "quantity", "quantita", "quantità"), pick(entry, "unit", "unita", "unità"), lotUnit ?? "pz");
  if (!read.ok) {
    if (read.reason === "invalid") note(problems, "invalid_quantity", `${label}: la quantità non si capiva, scrivila tu.`);
    else if (read.reason === "implausible") note(problems, "implausible_quantity", `${label}: la quantità proposta non è credibile, la scarto: scrivila tu.`);
    return {};
  }
  if (lotUnit !== undefined && read.value.unit !== lotUnit) return { mismatch: read.value };
  return { quantity: read.value };
}

/** Interpreta la risposta. Non lancia mai. */
export function parseMealPhrase(text: string, pantry: readonly PantryRef[], options: { truncated?: boolean } = {}): MealPhraseDraft {
  const problems: DraftProblem[] = [];
  const items: DraftPantryItem[] = [];
  const free: DraftFreeItem[] = [];
  let unclear: string[] = [];
  let kind: MealKind | undefined;
  const seen = new Set<string>();

  const draft = (): MealPhraseDraft => ({ ...(kind ? { kind } : {}), items, free, unclear, problems });

  try {
    const found = extractPayload(text, ["items", "free"]);
    if (!found) {
      note(problems, "no_json", "Nella risposta non ho trovato un elenco leggibile.");
      if (options.truncated) note(problems, "truncated", "La risposta si è interrotta prima della fine.");
      return draft();
    }
    if (found.salvaged) note(problems, "salvaged", "La risposta era incompleta: ho tenuto solo le voci che si leggevano.");
    else if (options.truncated) note(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza: alcune voci possono mancare.");

    const rawKind = pick(found.payload, "kind", "pasto");
    if (rawKind !== undefined) {
      kind = readMealKind(rawKind);
      if (kind === undefined) note(problems, "invalid_kind", "Il tipo di pasto non era chiaro: scegli tu.", "info");
    }

    const rawItems = pick(found.payload, "items", "voci");
    for (const entry of Array.isArray(rawItems) ? rawItems : []) {
      if (!isObj(entry)) {
        note(problems, "invalid_entry", "Una voce non era leggibile: la salto.", "info");
        continue;
      }
      if (items.length + free.length >= MAX_DRAFT_ITEMS) {
        note(problems, "too_many", `Troppe voci: ne tengo ${MAX_DRAFT_ITEMS}.`, "info");
        break;
      }
      const rawId = pick(entry, "id", "lot", "lotto");
      const ref = findRef(pantry, rawId);
      if (ref === undefined) {
        note(problems, "unknown_id", `Il modello ha citato «${cleanText(String(rawId ?? "?"), 20) || "?"}», che non è nella tua dispensa: lo scarto.`);
        continue;
      }
      if (seen.has(ref.id)) {
        note(problems, "duplicate_id", `${ref.name} compare due volte: tengo la prima voce.`, "info");
        continue;
      }
      seen.add(ref.id);
      const confidence = readConfidence(pick(entry, "confidence", "certezza")) ?? DEFAULT_CONFIDENCE;
      const { quantity, mismatch } = readItemAmount(entry, ref.name, problems, ref.remaining.unit);
      if (mismatch) {
        // l'unità non è quella del lotto: non si può scalare la dispensa, resta come voce libera con il nome vero
        note(problems, "unit_mismatch", `${ref.name}: la dispensa lo conta in ${ref.remaining.unit}, la risposta in ${mismatch.unit}. Lo tengo come voce libera, senza scalare la dispensa.`);
        free.push({ name: ref.name, quantity: mismatch, confidence });
      } else {
        items.push({ pantryId: ref.id, confidence, ...(quantity ? { quantity } : {}) });
      }
    }

    const rawFree = pick(found.payload, "free", "libere");
    for (const entry of Array.isArray(rawFree) ? rawFree : []) {
      if (!isObj(entry)) continue;
      const name = readText(pick(entry, "name", "nome"), 80);
      const clean = name === undefined ? "" : cleanText(name, 80);
      if (clean === "") {
        note(problems, "invalid_entry", "Una voce libera non aveva il nome: la salto.", "info");
        continue;
      }
      if (items.length + free.length >= MAX_DRAFT_ITEMS) {
        note(problems, "too_many", `Troppe voci: ne tengo ${MAX_DRAFT_ITEMS}.`, "info");
        break;
      }
      const { quantity } = readItemAmount(entry, clean, problems);
      free.push({
        name: clean,
        confidence: readConfidence(pick(entry, "confidence", "certezza")) ?? DEFAULT_CONFIDENCE,
        ...(quantity ? { quantity } : {}),
      });
    }

    unclear = readTextList(pick(found.payload, "unclear", "poco_chiaro", "non_capito"), 10);
  } catch {
    note(problems, "no_json", "Non sono riuscito a interpretare la risposta.");
  }
  return draft();
}
