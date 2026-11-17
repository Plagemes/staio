// Interprete della risposta del modello per uno scontrino. Non lancia mai: restituisce le righe valide
// e l'elenco dei problemi incontrati. Tutto ciò che viene da qui è una stima da far rivedere all'utente.
import type { FoodCategory } from "@/core/expiry";
import { parseDecimal, readCentsField, readEuroField } from "./numbers";
import { RECEIPT_CATEGORY_KEYS } from "./receiptPrompt";

export type ReceiptUnit = "g" | "ml" | "pz";

export interface ReceiptQuantity {
  value: number;
  unit: ReceiptUnit;
}

export interface ReceiptLine {
  /** Testo della riga come stampato. */
  raw: string;
  /** Nome interpretato. */
  name: string;
  quantity?: ReceiptQuantity;
  /** Prezzo della riga in centesimi, già al netto degli sconti agganciati alla riga. */
  priceCents?: number;
  /** Sconti agganciati a questa riga, positivi, già sottratti da `priceCents`. */
  discountCents: number;
  isFood: boolean;
  category?: FoodCategory;
}

export type ProblemCode =
  | "no_json"
  | "salvaged"
  | "truncated"
  | "no_lines"
  | "line_skipped"
  | "name_from_raw"
  | "missing_price"
  | "invalid_quantity"
  | "unknown_category"
  | "category_on_non_food"
  | "discount_unattached"
  | "discount_exceeds"
  | "invalid_date"
  | "total_mismatch"
  | "unreadable";

export interface ReceiptProblem {
  code: ProblemCode;
  /** `warning` merita attenzione; `info` è solo una nota. */
  severity: "warning" | "info";
  message: string;
  /** Posizione della riga nella risposta del modello (da 0), se il problema riguarda una riga. */
  lineIndex?: number;
}

export interface ReceiptReading {
  store?: string;
  chain?: string;
  /** `YYYY-MM-DD` */
  date?: string;
  lines: ReceiptLine[];
  /** Somma degli sconti che non si riferiscono a un articolo (positiva). */
  unattachedDiscountsCents: number;
  totalCents?: number;
  problems: ReceiptProblem[];
}

export interface ParseOptions {
  /** Il fornitore ha tagliato la risposta per il limite di lunghezza. */
  truncated?: boolean;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(obj: Obj, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(obj, key) && obj[key] !== null && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

// ---------------------------------------------------------------- estrazione del JSON

/** Oggetti `{...}` completi al livello più alto del testo, ignorando le graffe dentro le stringhe. */
function topLevelObjects(text: string, from = 0): string[] {
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
    if (c === '"') {
      if (depth > 0) inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) found.push(text.slice(start, i + 1));
    }
  }
  return found;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const LINE_KEYS = ["lines", "righe", "items", "articoli"] as const;

function linesOf(obj: Obj): unknown[] | undefined {
  const v = pick(obj, ...LINE_KEYS);
  return Array.isArray(v) ? v : undefined;
}

interface Payload {
  header: Obj;
  rawLines: unknown[];
  salvaged: boolean;
}

/** Trova lo scontrino dentro il testo: JSON puro, dentro un blocco di codice, dentro altro testo, o tagliato a metà. */
function extractPayload(text: string): Payload | undefined {
  const cleaned = text.replace(/```[A-Za-z]*/g, " ").trim();

  const whole = tryParse(cleaned);
  if (Array.isArray(whole) && whole.every(isObj)) return { header: {}, rawLines: whole, salvaged: false };
  if (isObj(whole)) {
    const lines = linesOf(whole);
    if (lines) return { header: whole, rawLines: lines, salvaged: false };
  }

  // un array di righe messo a sé, o un oggetto con le righe in mezzo ad altro testo
  const arrayStart = cleaned.indexOf("[");
  const objectStart = cleaned.indexOf("{");
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
    const arrayEnd = cleaned.lastIndexOf("]");
    if (arrayEnd > arrayStart) {
      const parsed = tryParse(cleaned.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isObj)) {
        return { header: {}, rawLines: parsed, salvaged: false };
      }
    }
  }
  for (const candidate of topLevelObjects(cleaned)) {
    const parsed = tryParse(candidate);
    if (isObj(parsed)) {
      const lines = linesOf(parsed);
      if (lines) return { header: parsed, rawLines: lines, salvaged: false };
    }
  }

  return salvage(cleaned);
}

/** Risposta tagliata o con un errore di sintassi: si recuperano le righe complete che si riescono a leggere. */
function salvage(text: string): Payload | undefined {
  const match = /"(?:lines|righe|items|articoli)"\s*:\s*\[/.exec(text);
  if (!match) return undefined;
  const afterBracket = match.index + match[0].length;
  const rawLines: unknown[] = [];
  for (const candidate of topLevelObjects(text, afterBracket)) {
    const parsed = tryParse(candidate);
    if (isObj(parsed)) rawLines.push(parsed);
  }
  // le intestazioni stanno prima dell'elenco delle righe: "{ ...,  " chiuso a mano
  const head = text.slice(0, match.index).replace(/[\s,]+$/, "");
  const parsedHead = tryParse(`${head.slice(head.indexOf("{"))}}`);
  return { header: isObj(parsedHead) ? parsedHead : {}, rawLines, salvaged: true };
}

// ---------------------------------------------------------------- lettura dei campi

const NULLISH = new Set(["", "null", "none", "n/d", "nd", "n.d.", "-", "—", "non leggibile", "illeggibile", "sconosciuto"]);

function readText(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (NULLISH.has(s.toLowerCase())) return undefined;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "si", "sì", "yes", "1", "vero"].includes(s)) return true;
    if (["false", "no", "0", "falso"].includes(s)) return false;
  }
  return undefined;
}

/** Data di calendario `YYYY-MM-DD` da "2026-11-14", "14/11/2026", "14-11-26", "14.11.2026". */
export function readReceiptDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/.exec(s);
    if (!match) return undefined;
    [d, m] = [Number(match[1]), Number(match[2])];
    y = Number(match[3]);
    if (match[3].length === 2) y += 2000;
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return undefined;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Fattore verso l'unità di base (g, ml, pz) per le sigle che compaiono sugli scontrini. */
const UNIT_TABLE: ReadonlyArray<readonly [RegExp, ReceiptUnit, number]> = [
  [/^(g|gr|grammi?)$/, "g", 1],
  [/^(kg|kgs|kilo|kili|chili|chilogrammi?)$/, "g", 1000],
  [/^(hg|etti|etto)$/, "g", 100],
  [/^(ml|millilitri?)$/, "ml", 1],
  [/^(cl|centilitri?)$/, "ml", 10],
  [/^(dl|decilitri?)$/, "ml", 100],
  [/^(l|lt|litri?)$/, "ml", 1000],
  [/^(pz|pezzi|pezzo|n|nr|n\.|conf|confezioni?|unita|unità|x)$/, "pz", 1],
];

type QuantityRead = { ok: true; quantity?: ReceiptQuantity } | { ok: false };

function readQuantity(valueRaw: unknown, unitRaw: unknown): QuantityRead {
  const value = parseDecimal(valueRaw);
  const unitText = readText(unitRaw, 20)?.toLowerCase().replace(/\.$/, "");
  if (value === undefined) {
    // nessuna quantità: va bene, a meno che il modello abbia scritto un valore illeggibile
    return valueRaw === undefined || valueRaw === null || valueRaw === "" ? { ok: true } : { ok: false };
  }
  if (!(value > 0)) return { ok: false };
  if (unitText === undefined) {
    return { ok: true, quantity: { value: Math.round(value * 1000) / 1000, unit: "pz" } };
  }
  const row = UNIT_TABLE.find(([pattern]) => pattern.test(unitText));
  if (!row) return { ok: false };
  const [, unit, factor] = row;
  const scaled = value * factor;
  const rounded = unit === "pz" ? Math.round(scaled * 1000) / 1000 : Math.round(scaled * 10) / 10;
  return rounded > 0 ? { ok: true, quantity: { value: rounded, unit } } : { ok: false };
}

const CATEGORY_SET = new Set<string>(RECEIPT_CATEGORY_KEYS);

const DISCOUNT_TEXT = /^\s*(sconto|sc\.|promo(zione)?\b|offerta|riduzione|coupon|buono sconto|risparmio)/i;
/** Sconti che riguardano tutto lo scontrino e non l'articolo che li precede. */
const GLOBAL_DISCOUNT_TEXT = /(totale|subtotale|fedelt|tessera|carta\b|cassa|scontrino|spesa|punti)/i;

// ---------------------------------------------------------------- interprete

function problem(
  problems: ReceiptProblem[],
  code: ProblemCode,
  message: string,
  extra: { severity?: "warning" | "info"; lineIndex?: number } = {},
): void {
  problems.push({ code, severity: extra.severity ?? "warning", message, lineIndex: extra.lineIndex });
}

function labelOf(index: number, name?: string): string {
  return name ? `Riga ${index + 1} («${name}»)` : `Riga ${index + 1}`;
}

/** Interpreta il testo restituito dal modello. Non lancia mai. */
export function parseReceiptResponse(text: string, options: ParseOptions = {}): ReceiptReading {
  const problems: ReceiptProblem[] = [];
  const reading: ReceiptReading = { lines: [], unattachedDiscountsCents: 0, problems };
  try {
    const payload = typeof text === "string" ? extractPayload(text) : undefined;
    if (!payload) {
      problem(problems, "no_json", "Nella risposta non ho trovato uno scontrino leggibile.");
      if (options.truncated) problem(problems, "truncated", "La risposta si è interrotta prima della fine.");
      return reading;
    }
    if (payload.salvaged) {
      problem(
        problems,
        "salvaged",
        "La risposta era incompleta: ho recuperato solo le righe che si leggevano. Controlla che non ne manchino in fondo.",
      );
    }
    if (options.truncated && !payload.salvaged) {
      problem(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza: potrebbero mancare delle righe.");
    }
    if (options.truncated && payload.salvaged) {
      problem(problems, "truncated", "La risposta si è interrotta per il limite di lunghezza.", { severity: "info" });
    }

    readHeader(payload.header, reading);
    readLines(payload.rawLines, reading);

    if (reading.lines.length === 0 && payload.rawLines.length === 0) {
      problem(problems, "no_lines", "Non ho trovato nessuna riga di articolo nello scontrino.");
    }
    const check = checkReceiptTotals(reading);
    if (check.status === "mismatch") {
      problem(
        problems,
        "total_mismatch",
        `La somma delle righe (${formatEuro(check.sumCents - check.generalDiscountsCents)}) non torna con il totale dello scontrino (${formatEuro(check.totalCents)}). Controlla prezzi e sconti, o righe mancanti.`,
      );
    }
  } catch {
    problem(problems, "unreadable", "Non sono riuscito a interpretare la risposta.");
  }
  return reading;
}

function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")} €`;
}

function readHeader(header: Obj, reading: ReceiptReading): void {
  reading.store = readText(pick(header, "store", "negozio", "insegna"));
  reading.chain = readText(pick(header, "chain", "catena"));
  const dateRaw = pick(header, "date", "data");
  if (dateRaw !== undefined) {
    const date = readReceiptDate(dateRaw);
    if (date) reading.date = date;
    else if (readText(dateRaw) !== undefined) {
      problem(reading.problems, "invalid_date", "La data dello scontrino non è leggibile: la scegli tu.");
    }
  }
  const centsRaw = pick(header, "totalCents", "total_cents");
  const total = centsRaw !== undefined ? readCentsField(centsRaw) : readEuroField(pick(header, "total", "totale"));
  if (total !== undefined && total >= 0) reading.totalCents = total;
}

function readLines(rawLines: readonly unknown[], reading: ReceiptReading): void {
  const { problems } = reading;
  let last: ReceiptLine | undefined;

  rawLines.forEach((entry, index) => {
    if (!isObj(entry)) {
      problem(problems, "line_skipped", `${labelOf(index)} non è leggibile: la salto.`, { lineIndex: index });
      return;
    }
    const raw = readText(pick(entry, "raw", "rawText", "original", "testo", "text"), 200) ?? "";
    const nameRead = readText(pick(entry, "name", "nome", "description", "descrizione"), 120);
    const kind = readText(pick(entry, "kind", "tipo", "type"), 20)?.toLowerCase();

    const centsRaw = pick(entry, "priceCents", "price_cents", "cents");
    const price =
      centsRaw !== undefined ? readCentsField(centsRaw) : readEuroField(pick(entry, "price", "prezzo", "importo", "amount"));

    const looksLikeDiscount =
      kind === "discount" ||
      kind === "sconto" ||
      (price !== undefined && price < 0) ||
      DISCOUNT_TEXT.test(nameRead ?? "") ||
      DISCOUNT_TEXT.test(raw);

    if (looksLikeDiscount) {
      attachDiscount(index, raw, nameRead, price, last, reading);
      return;
    }
    if (kind !== undefined && kind !== "item" && kind !== "articolo" && kind !== "product") {
      problem(problems, "line_skipped", `${labelOf(index, nameRead ?? raw)} non è un articolo: la salto.`, {
        severity: "info",
        lineIndex: index,
      });
      return;
    }

    let name = nameRead;
    if (name === undefined) {
      if (raw === "") {
        problem(problems, "line_skipped", `${labelOf(index)} non ha né nome né testo: la salto.`, { lineIndex: index });
        return;
      }
      name = raw;
      problem(problems, "name_from_raw", `${labelOf(index, raw)}: uso il testo stampato come nome.`, {
        severity: "info",
        lineIndex: index,
      });
    }

    const quantityRead = readQuantity(pick(entry, "quantity", "qty", "quantita", "quantità"), pick(entry, "unit", "unita", "unità"));
    let quantity: ReceiptQuantity | undefined;
    if (quantityRead.ok) quantity = quantityRead.quantity;
    else {
      problem(problems, "invalid_quantity", `${labelOf(index, name)}: la quantità non è chiara, la scrivi tu.`, { lineIndex: index });
    }

    let category: FoodCategory | undefined;
    const categoryText = readText(pick(entry, "category", "categoria"), 60);
    if (categoryText !== undefined) {
      if (CATEGORY_SET.has(categoryText)) category = categoryText as FoodCategory;
      else {
        problem(problems, "unknown_category", `${labelOf(index, name)}: la categoria «${categoryText}» non esiste, la scegli tu.`, {
          severity: "info",
          lineIndex: index,
        });
      }
    }
    const food = readBool(pick(entry, "isFood", "is_food", "food", "alimento")) ?? category !== undefined;
    if (!food && category !== undefined) {
      category = undefined;
    }

    if (price === undefined) {
      problem(problems, "missing_price", `${labelOf(index, name)}: manca il prezzo.`, { lineIndex: index });
    }

    const line: ReceiptLine = {
      raw,
      name,
      ...(quantity ? { quantity } : {}),
      ...(price !== undefined ? { priceCents: price } : {}),
      discountCents: 0,
      isFood: food,
      ...(category ? { category } : {}),
    };
    reading.lines.push(line);
    last = line;
  });
}

function attachDiscount(
  index: number,
  raw: string,
  name: string | undefined,
  price: number | undefined,
  last: ReceiptLine | undefined,
  reading: ReceiptReading,
): void {
  const { problems } = reading;
  const label = labelOf(index, name ?? raw);
  if (price === undefined || price === 0) {
    problem(problems, "line_skipped", `${label} è uno sconto senza importo: lo salto.`, { severity: "info", lineIndex: index });
    return;
  }
  const amount = Math.abs(price);
  const isGlobal = GLOBAL_DISCOUNT_TEXT.test(`${name ?? ""} ${raw}`);
  if (!last || last.priceCents === undefined || isGlobal) {
    reading.unattachedDiscountsCents += amount;
    problem(
      problems,
      "discount_unattached",
      `${label} è uno sconto di ${formatEuro(amount)} che non riguarda un articolo: lo tengo da parte per il totale.`,
      { severity: "info", lineIndex: index },
    );
    return;
  }
  if (amount > last.priceCents) {
    problem(problems, "discount_exceeds", `${label}: lo sconto supera il prezzo di «${last.name}». Controlla gli importi.`, {
      lineIndex: index,
    });
    last.discountCents += amount;
    last.priceCents = 0;
    return;
  }
  last.discountCents += amount;
  last.priceCents -= amount;
}

// ---------------------------------------------------------------- coerenza

interface TotalsBase {
  /** Somma dei prezzi delle righe, già al netto degli sconti di riga. */
  sumCents: number;
  /** Sconti generali (non legati a un articolo), positivi. */
  generalDiscountsCents: number;
  /** Righe senza prezzo: la somma è per difetto. */
  linesWithoutPrice: number;
}

export type TotalsCheck =
  | (TotalsBase & { status: "ok" | "mismatch"; totalCents: number; differenceCents: number })
  | (TotalsBase & { status: "no_total" })
  | (TotalsBase & { status: "no_lines" });

/** Margine per gli arrotondamenti di cassa. */
export const DEFAULT_TOLERANCE_CENTS = 2;

/**
 * Confronta la somma delle righe, meno gli sconti generali, con il totale dello scontrino.
 * `differenceCents` è somma meno totale: positivo se le righe superano il totale.
 */
export function checkReceiptTotals(
  reading: Pick<ReceiptReading, "lines" | "unattachedDiscountsCents" | "totalCents">,
  toleranceCents: number = DEFAULT_TOLERANCE_CENTS,
): TotalsCheck {
  let sum = 0;
  let missing = 0;
  for (const line of reading.lines) {
    if (line.priceCents === undefined) missing += 1;
    else sum += line.priceCents;
  }
  const base: TotalsBase = {
    sumCents: sum,
    generalDiscountsCents: reading.unattachedDiscountsCents,
    linesWithoutPrice: missing,
  };
  if (reading.lines.length === 0) return { ...base, status: "no_lines" };
  if (reading.totalCents === undefined) return { ...base, status: "no_total" };
  const differenceCents = sum - reading.unattachedDiscountsCents - reading.totalCents;
  return {
    ...base,
    status: Math.abs(differenceCents) <= toleranceCents ? "ok" : "mismatch",
    totalCents: reading.totalCents,
    differenceCents,
  };
}
