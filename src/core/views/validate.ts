// Il validatore: accetta solo ciò che è nel catalogo e scarta il resto, dicendo cosa e perché. Non lancia mai.
// Ogni blocco è valido per intero o scartato per intero; un campo sconosciuto rende scartato l'oggetto che lo porta.
import { getQuery } from "./catalog";
import {
  ACTIONS,
  ACTION_IDS,
  BLOCK_TYPES,
  VIEW_LIMITS,
  type ActionId,
  type BlockSpec,
  type ProblemCode,
  type QuerySpec,
  type ValidationResult,
  type ViewProblem,
  type ViewSpec,
} from "./spec";
import type { ParamDef, ParamValue, ResultKind } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Una breve citazione, senza caratteri di controllo, per dire cosa non è stato capito. */
function quote(value: unknown): string {
  const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : Array.isArray(value) ? "[…]" : value === null ? "null" : typeof value === "object" ? "{…}" : "?";
  const clean = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return `«${clean.length > 30 ? `${clean.slice(0, 30)}…` : clean}»`;
}

/** Il testo di un'intelligenza artificiale come testo semplice: niente caratteri di controllo, né invisibili, spazi compressi. */
export function plainText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNITS = "uno|due|tre|quattro|cinque|sei|sette|otto|nove";
const TENS = "vent|trent|quarant|cinquant|sessant|settant|ottant|novant";
const SPELLED = new Set([
  // italiano: numeri, quantità approssimate, frazioni
  "zero", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici",
  "quindici", "sedici", "diciassette", "diciotto", "diciannove", "mille", "mila", "milione", "milioni", "miliardo", "miliardi",
  "mezzo", "mezza", "mezzi", "mezze", "meta", "metà", "decina", "decine", "dozzina", "dozzine", "centinaio", "centinaia",
  "migliaio", "migliaia", "percento", "paio", "paia", "coppia", "coppie", "doppio", "doppia", "doppi", "doppie", "triplo", "tripla",
  // misure e valute usate come quantità
  "etto", "etti", "chilo", "chili", "kilo", "kg", "mg", "ml", "cl", "dl", "kcal", "caloria", "calorie", "euro", "centesimo", "centesimi",
  // inglese
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "billion", "half", "halves", "dozen", "dozens", "double",
  "triple", "quarter", "quarters", "third", "thirds", "percent", "twice", "thrice", "couple", "pair",
]);
const SPELLED_PATTERNS: readonly RegExp[] = [
  // venti, ventuno, trentatre; ventina, trentina
  new RegExp(`^(?:${TENS})(?:a|i)?(?:${UNITS})?$`),
  new RegExp(`^(?:${TENS})ina$`),
  new RegExp(`^(?:${UNITS})?cento[a-z]*$`),
  new RegExp(`^(?:${UNITS})mila$`),
  // frazioni e ordinali usati come frazioni: un terzo, un quarto, un quinto…
  /^(?:terz|quart|quint|sest|settim|ottav|non|decim|centesim|millesim)[oaie]$/,
  // raddoppiato, triplicato, quadruplo, dimezzato, moltiplicato
  /^(?:raddopp|tripl|quadrupl|quintupl|sestupl|moltiplic|dimezz|dopp)[a-z]*$/,
  /^percent[a-z]*$/,
  // misure: grammo, chilogrammi, ettogrammi, litro, millilitri
  /^(?:chilo|kilo|etto|milli|centi|deci)?(?:gramm|litr)[a-z]*$/,
];
// numeri romani isolati e in maiuscolo (almeno due lettere: «I» e «L» sono anche articoli e lettere apostrofate)
const ROMAN = /^(?=[MDCLXVI]{2,}$)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/**
 * Un numero o una quantità scritti a lettere («dodici», «una ventina», «un paio», «un terzo», «raddoppiato», «un etto»,
 * «twelve», «half», «XII», «per cento»), o con il segno di percentuale. Si escludono «un», «uno», «una»: sono anche
 * articoli e renderebbero inutilizzabile la maggior parte delle frasi. Meglio un rifiuto in più: il testo è facoltativo.
 */
export function findNumberWord(text: string): string | undefined {
  if (text.includes("%")) return "%";
  for (const raw of text.split(/[^\p{L}]+/u)) {
    if (raw === "") continue;
    if (ROMAN.test(raw)) return raw;
    const token = raw.toLowerCase();
    const plain = token.normalize("NFD").replace(/\p{M}/gu, "");
    if (SPELLED.has(token) || SPELLED.has(plain) || SPELLED_PATTERNS.some((re) => re.test(plain))) return token;
  }
  return undefined;
}

const NAME_CHARS = /^[\p{L}\p{N} '’-]+$/u;

type Text = { ok: true; value: string } | { ok: false; code: ProblemCode; message: string };

/** Un testo libero: stringa, non vuota, non lunga, e (se `digits` è falso) senza cifre. */
function readText(value: unknown, max: number, what: string, digits = false): Text {
  if (typeof value !== "string") return { ok: false, code: "bad_type", message: `${what} deve essere un testo.` };
  if (value.length > max * 2 || plainText(value).length > max) {
    return { ok: false, code: "too_long", message: `${what} è troppo lungo (al massimo ${max} caratteri).` };
  }
  const clean = plainText(value);
  if (clean === "") return { ok: false, code: "empty_text", message: `${what} è vuoto.` };
  if (!digits && /\p{N}/u.test(clean)) {
    return { ok: false, code: "digits_in_text", message: `${what} contiene dei numeri (${quote(clean)}): i numeri li calcola solo l'app, non si scrivono a parole.` };
  }
  const spelled = digits ? undefined : findNumberWord(clean);
  if (spelled !== undefined) {
    return { ok: false, code: "number_words", message: `${what} contiene un numero scritto a lettere (${quote(spelled)}): i numeri li calcola solo l'app.` };
  }
  return { ok: true, value: clean };
}

class Collector {
  readonly problems: ViewProblem[] = [];
  add(path: string, code: ProblemCode, message: string): void {
    this.problems.push({ path, code, message });
  }
}

function unknownFields(obj: Obj, allowed: readonly string[], path: string, out: Collector): boolean {
  let bad = false;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      out.add(path === "" ? key : `${path}.${key}`, "unknown_field", `Campo non previsto: ${quote(key)}.`);
      bad = true;
    }
  }
  return bad;
}

function readParam(def: ParamDef, value: unknown): { ok: true; value: ParamValue } | { ok: false; message: string } {
  switch (def.kind) {
    case "enum":
      if (typeof value === "string" && def.values.includes(value)) return { ok: true, value };
      return { ok: false, message: `valore non ammesso ${quote(value)}.` };
    case "int":
      if (typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max) return { ok: true, value };
      return { ok: false, message: `serve un numero intero da ${def.min} a ${def.max}, non ${quote(value)}.` };
    case "text": {
      const text = readText(value, def.maxLength, "il valore", true);
      if (!text.ok) return { ok: false, message: text.message };
      if (typeof value !== "string" || !NAME_CHARS.test(value.trim()) || text.value.length < 2) return { ok: false, message: `ammesse solo lettere, cifre, spazi, apostrofi e trattini (almeno 2 caratteri): ${quote(text.value)}.` };
      return { ok: true, value: text.value };
    }
  }
}

function readQuery(raw: unknown, path: string, expect: ResultKind, out: Collector): QuerySpec | undefined {
  if (!isObj(raw)) {
    out.add(path, "bad_type", "L'interrogazione deve essere un oggetto con un nome.");
    return undefined;
  }
  if (unknownFields(raw, ["name", "params"], path, out)) return undefined;
  if (typeof raw.name !== "string") {
    out.add(`${path}.name`, "missing_field", "Manca il nome dell'interrogazione.");
    return undefined;
  }
  const def = getQuery(raw.name);
  if (!def) {
    out.add(`${path}.name`, "unknown_query", `Interrogazione inesistente: ${quote(raw.name)}.`);
    return undefined;
  }
  if (def.result !== expect) {
    out.add(`${path}.name`, "result_mismatch", `${quote(raw.name)} dà ${def.result === "number" ? "un numero" : def.result === "rows" ? "un elenco" : "una serie"}, non va bene per questo blocco.`);
    return undefined;
  }
  const given = raw.params === undefined ? {} : raw.params;
  if (!isObj(given)) {
    out.add(`${path}.params`, "bad_type", "I parametri devono essere un oggetto.");
    return undefined;
  }
  let ok = true;
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(def.params, key)) {
      out.add(`${path}.params.${key}`, "unknown_param", `Parametro non previsto per ${def.name}: ${quote(key)}.`);
      ok = false;
    }
  }
  const params: Record<string, ParamValue> = {};
  for (const [key, pdef] of Object.entries(def.params)) {
    const value = Object.hasOwn(given, key) ? given[key] : undefined;
    if (value === undefined) {
      if (pdef.kind !== "text" && pdef.default !== undefined) params[key] = pdef.default;
      else {
        out.add(`${path}.params.${key}`, "missing_param", `Manca il parametro ${quote(key)} di ${def.name}.`);
        ok = false;
      }
      continue;
    }
    const read = readParam(pdef, value);
    if (read.ok) params[key] = read.value;
    else {
      out.add(`${path}.params.${key}`, "bad_param", `Parametro ${quote(key)} di ${def.name}: ${read.message}`);
      ok = false;
    }
  }
  return ok ? { name: def.name, params } : undefined;
}

function readLabel(obj: Obj, path: string, required: boolean, out: Collector): { ok: boolean; value?: string } {
  if (obj.label === undefined) {
    if (required) out.add(`${path}.label`, "missing_field", "Manca l'etichetta.");
    return { ok: !required };
  }
  const text = readText(obj.label, VIEW_LIMITS.labelChars, "L'etichetta");
  if (!text.ok) {
    out.add(`${path}.label`, text.code, text.message);
    return { ok: false };
  }
  return { ok: true, value: text.value };
}

function readBlock(raw: unknown, path: string, out: Collector): BlockSpec | undefined {
  if (!isObj(raw)) {
    out.add(path, "bad_type", "Ogni blocco deve essere un oggetto.");
    return undefined;
  }
  const type = raw.type;
  if (typeof type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(type)) {
    out.add(`${path}.type`, "unknown_block", `Tipo di blocco inesistente: ${quote(type)}.`);
    return undefined;
  }
  switch (type) {
    case "figure": {
      if (unknownFields(raw, ["type", "label", "query"], path, out)) return undefined;
      const label = readLabel(raw, path, true, out);
      const query = readQuery(raw.query, `${path}.query`, "number", out);
      return label.ok && label.value !== undefined && query ? { type, label: label.value, query } : undefined;
    }
    case "list":
    case "chart": {
      if (unknownFields(raw, ["type", "label", "query"], path, out)) return undefined;
      const label = readLabel(raw, path, false, out);
      const query = readQuery(raw.query, `${path}.query`, type === "list" ? "rows" : "series", out);
      if (!label.ok || !query) return undefined;
      return label.value !== undefined ? { type, label: label.value, query } : { type, query };
    }
    case "text": {
      if (unknownFields(raw, ["type", "text"], path, out)) return undefined;
      const text = readText(raw.text, VIEW_LIMITS.textChars, "Il testo");
      if (!text.ok) {
        out.add(`${path}.text`, text.code, text.message);
        return undefined;
      }
      return { type, text: text.value };
    }
    default: {
      if (unknownFields(raw, ["type", "action", "item"], path, out)) return undefined;
      if (typeof raw.action !== "string" || !(ACTION_IDS as readonly string[]).includes(raw.action)) {
        out.add(`${path}.action`, "unknown_action", `Azione non ammessa: ${quote(raw.action)}.`);
        return undefined;
      }
      const action = raw.action as ActionId;
      if (action !== "add_to_shopping") {
        if (raw.item !== undefined) {
          out.add(`${path}.item`, "unknown_field", `${ACTIONS[action].label} non ha bisogno di «item».`);
          return undefined;
        }
        return { type: "action", action };
      }
      const item = readText(raw.item, VIEW_LIMITS.itemChars, "L'alimento da aggiungere", true);
      if (!item.ok) {
        out.add(`${path}.item`, item.code === "bad_type" ? "missing_field" : item.code, item.code === "bad_type" ? "Manca cosa aggiungere alla spesa." : item.message);
        return undefined;
      }
      if (!NAME_CHARS.test((raw.item as string).trim()) || item.value.length < 2) {
        out.add(`${path}.item`, "bad_param", `Nome non ammesso: ${quote(item.value)} (solo lettere, cifre, spazi, apostrofi e trattini).`);
        return undefined;
      }
      return { type: "action", action, item: item.value };
    }
  }
}

/** Valida una vista già letta da JSON. Dà la vista ripulita (solo blocchi validi) e l'elenco di ciò che è stato scartato. */
export function validateView(input: unknown): ValidationResult {
  const out = new Collector();
  try {
    if (!isObj(input)) {
      out.add("", "not_object", "La risposta non è una vista: serve un oggetto con «title» e «blocks».");
      return { ok: false, problems: out.problems };
    }
    const strangers = unknownFields(input, ["title", "blocks"], "", out);
    const title = input.title === undefined ? undefined : readText(input.title, VIEW_LIMITS.titleChars, "Il titolo");
    if (!title) out.add("title", "missing_field", "Manca il titolo.");
    else if (!title.ok) out.add("title", title.code, title.message);
    if (input.blocks === undefined) out.add("blocks", "missing_field", "Mancano i blocchi.");
    else if (!Array.isArray(input.blocks)) out.add("blocks", "bad_type", "«blocks» deve essere un elenco.");
    if (strangers || !title || !title.ok || !Array.isArray(input.blocks)) return { ok: false, problems: out.problems };

    const raw: unknown[] = input.blocks;
    if (raw.length > VIEW_LIMITS.maxBlocks) {
      out.add("blocks", "too_many_blocks", `Troppi blocchi (${raw.length}): ne tengo al massimo ${VIEW_LIMITS.maxBlocks}.`);
    }
    const blocks: BlockSpec[] = [];
    raw.slice(0, VIEW_LIMITS.maxBlocks).forEach((b, i) => {
      const block = readBlock(b, `blocks[${i}]`, out);
      if (block) blocks.push(block);
    });
    if (blocks.length === 0) {
      out.add("blocks", "no_valid_blocks", "Nessun blocco della risposta è valido.");
      return { ok: false, problems: out.problems };
    }
    const view: ViewSpec = { title: title.value, blocks };
    return { ok: true, view, problems: out.problems };
  } catch {
    return { ok: false, problems: [{ path: "", code: "not_object", message: "La risposta non si può leggere." }] };
  }
}
