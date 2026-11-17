// Parti comuni alle letture «pasto da una frase», «pasto da una foto» e «idee di ricette»: l'elenco della dispensa con
// identificativi corti (il modello non vede mai gli id veri), i numeri come li scrive un modello, l'estrazione del JSON.
// Tutto ciò che torna dal modello è una bozza stimata: qui si scarta ciò che non corrisponde a niente di reale.
import type { MealKind } from "@/core/diary";
import { parseDecimal } from "./numbers";
import { isObj, readText, tryParse } from "./receiptParse";
import type { Obj } from "./receiptParse";

export type DraftUnit = "g" | "ml" | "pz";

export interface DraftQuantity {
  value: number;
  unit: DraftUnit;
}

/** Un alimento in dispensa, come lo vede il modello. */
export interface PantryRef {
  /** Identificativo corto (A1, A2…): è l'unico modo in cui la risposta può riferirsi alla dispensa. */
  id: string;
  name: string;
  /** Quantità rimasta secondo il registro. */
  remaining: DraftQuantity;
  /** Giorni alla scadenza (negativo se già scaduto), se nota. */
  daysLeft?: number;
}

export type DraftProblemCode =
  | "no_json"
  | "salvaged"
  | "truncated"
  | "unknown_id"
  | "duplicate_id"
  | "invalid_entry"
  | "invalid_quantity"
  | "implausible_quantity"
  | "unit_mismatch"
  | "invalid_kind"
  | "too_many"
  | "invalid_recipe"
  | "invalid_ingredient";

export interface DraftProblem {
  code: DraftProblemCode;
  /** `warning` merita attenzione; `info` è solo una nota. */
  severity: "warning" | "info";
  message: string;
}

export function note(problems: DraftProblem[], code: DraftProblemCode, message: string, severity: "warning" | "info" = "warning"): void {
  problems.push({ code, severity, message });
}

/** Oltre questi valori una quantità per una sola voce di un pasto non è credibile: la si scarta e si chiede all'utente. */
export const AMOUNT_LIMITS: Readonly<Record<DraftUnit, number>> = { g: 3000, ml: 3000, pz: 30 };

export const MAX_DRAFT_ITEMS = 30;

// ---------------------------------------------------------------- elenco della dispensa

/** Testo su una riga sola, senza separatori né caratteri di controllo: il nome lo ha scritto l'utente, non è da fidarsi. */
export function cleanText(value: string, max = 60): string {
  return value
    .replace(/[\u0000-\u001f\u007f|<>{}[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const pantryId = (index: number): string => `A${index + 1}`;

const amountText = (q: DraftQuantity): string => `${Math.round(q.value * 100) / 100} ${q.unit}`;

export function daysLeftText(days: number): string {
  if (days < -1) return `scaduto da ${-days} giorni`;
  if (days === -1) return "scaduto ieri";
  if (days === 0) return "scade oggi";
  if (days === 1) return "scade domani";
  return `scade tra ${days} giorni`;
}

/** `A1 | Latte intero | resta 800 ml | scade tra 3 giorni` */
export function pantryRefLine(ref: PantryRef): string {
  const parts = [ref.id, cleanText(ref.name), `resta ${amountText(ref.remaining)}`];
  if (ref.daysLeft !== undefined && Number.isFinite(ref.daysLeft)) parts.push(daysLeftText(Math.round(ref.daysLeft)));
  return parts.join(" | ");
}

export function pantryListText(pantry: readonly PantryRef[]): string {
  return pantry.length === 0 ? "(la dispensa è vuota)" : pantry.map(pantryRefLine).join("\n");
}

/** Cerca un identificativo nell'elenco, senza badare a maiuscole e spazi. Undefined se non c'è: l'id era inventato. */
export function findRef(pantry: readonly PantryRef[], rawId: unknown): PantryRef | undefined {
  if (typeof rawId !== "string" && typeof rawId !== "number") return undefined;
  const wanted = String(rawId).trim().toUpperCase();
  return pantry.find((p) => p.id.toUpperCase() === wanted);
}

// ---------------------------------------------------------------- tipo di pasto

const KIND_WORDS: ReadonlyArray<readonly [RegExp, MealKind]> = [
  [/^(breakfast|colazione|mattina)$/, "breakfast"],
  [/^(lunch|pranzo)$/, "lunch"],
  [/^(dinner|cena|supper)$/, "dinner"],
  [/^(snack|spuntino|merenda)$/, "snack"],
];

export function readMealKind(value: unknown): MealKind | undefined {
  const s = readText(value, 30)?.toLowerCase();
  if (s === undefined) return undefined;
  return KIND_WORDS.find(([pattern]) => pattern.test(s))?.[1];
}

// ---------------------------------------------------------------- quantità

const UNIT_ROWS: ReadonlyArray<readonly [RegExp, DraftUnit, number]> = [
  [/^(g|gr|grammi?)$/, "g", 1],
  [/^(kg|kilo|chili)$/, "g", 1000],
  [/^(hg|etto|etti)$/, "g", 100],
  [/^(ml|millilitri?)$/, "ml", 1],
  [/^(cl)$/, "ml", 10],
  [/^(dl)$/, "ml", 100],
  [/^(l|lt|litri?)$/, "ml", 1000],
  [/^(cucchiaio|cucchiai)$/, "ml", 15],
  [/^(cucchiaino|cucchiaini)$/, "ml", 5],
  [/^(bicchiere|bicchieri)$/, "ml", 200],
  [/^(tazza|tazze)$/, "ml", 240],
  [/^(pz|pezzi|pezzo|unita|unità|n|conf|confezione|confezioni)$/, "pz", 1],
];

export type AmountRead = { ok: true; value: DraftQuantity } | { ok: false; reason: "missing" | "invalid" | "implausible" };

/**
 * Quantità in unità base (g, ml, pz) da un numero e un'unità scritti da un modello. Senza unità vale `fallbackUnit`
 * (l'unità della dispensa) o i pezzi. Zero, negativi, testo e valori oltre `AMOUNT_LIMITS` non sono quantità.
 */
export function readAmount(value: unknown, unit: unknown, fallbackUnit: DraftUnit = "pz"): AmountRead {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return { ok: false, reason: "missing" };
  const n = parseDecimal(value);
  if (n === undefined || !(n > 0)) return { ok: false, reason: "invalid" };
  const u = readText(unit, 20)?.toLowerCase();
  let base: DraftUnit = fallbackUnit;
  let factor = 1;
  if (u !== undefined) {
    const row = UNIT_ROWS.find(([pattern]) => pattern.test(u));
    if (!row) return { ok: false, reason: "invalid" };
    base = row[1];
    factor = row[2];
  }
  const scaled = n * factor;
  const rounded = base === "pz" ? Math.round(scaled * 100) / 100 : Math.round(scaled * 10) / 10;
  if (!(rounded > 0) || rounded > AMOUNT_LIMITS[base]) return { ok: false, reason: "implausible" };
  return { ok: true, value: { value: rounded, unit: base } };
}

// ---------------------------------------------------------------- estrazione del JSON

/**
 * Oggetti `{...}` completi dentro l'array che comincia subito dopo `from`, fino alla sua parentesi di chiusura:
 * le graffe dentro le stringhe non contano, e un oggetto tagliato a metà non si recupera.
 */
export function objectsInArray(text: string, from: number): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) found.push(text.slice(start, i + 1));
    } else if (c === "]" && depth === 0) break;
  }
  return found;
}

/** Il testo di un oggetto JSON in cima al testo (non dentro un altro), se ce n'è uno che si legge. */
function firstObjectWith(text: string, keys: readonly string[]): Obj | undefined {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      if (depth > 0) inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParse(text.slice(start, i + 1));
        if (isObj(parsed) && keys.some((k) => k in parsed)) return parsed;
      }
    }
  }
  return undefined;
}

export interface Extracted {
  payload: Obj;
  /** La risposta era tagliata o rovinata: si sono tenute solo le voci complete. */
  salvaged: boolean;
}

/**
 * Trova l'oggetto della risposta: JSON puro, dentro un blocco di codice, dentro altro testo, oppure tagliato a metà
 * (allora si recuperano gli oggetti completi di ciascun elenco in `arrayKeys`). `keys` dice quali chiavi lo riconoscono.
 */
export function extractPayload(text: string, keys: readonly string[]): Extracted | undefined {
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/```[A-Za-z]*/g, " ").trim();
  const whole = tryParse(cleaned);
  if (isObj(whole) && keys.some((k) => k in whole)) return { payload: whole, salvaged: false };
  const inner = firstObjectWith(cleaned, keys);
  if (inner) return { payload: inner, salvaged: false };

  const recovered: Obj = {};
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(cleaned);
    if (!match) continue;
    const items: unknown[] = [];
    for (const candidate of objectsInArray(cleaned, match.index + match[0].length)) {
      const parsed = tryParse(candidate);
      if (isObj(parsed)) items.push(parsed);
    }
    recovered[key] = items;
  }
  return Object.keys(recovered).length > 0 ? { payload: recovered, salvaged: true } : undefined;
}

/** Elenco di testi brevi da un array (o da un testo solo). */
export function readTextList(value: unknown, max: number, maxLength = 120): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: string[] = [];
  for (const item of items) {
    const t = readText(item, maxLength);
    if (t !== undefined && out.length < max) out.push(cleanText(t, maxLength));
  }
  return out.filter((t) => t !== "");
}
