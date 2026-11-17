// Lettura dei dati strutturati di una pagina web (schema.org, JSON-LD) da una stringa HTML.
// Solo analisi di testo: nulla della pagina viene eseguito o caricato. Non lancia mai.
// Il codice evita le espressioni regolari con ricerche annidate sul documento intero: su una pagina
// ostile (migliaia di tag mai chiusi) il tempo deve restare lineare.

import { parseIsoDuration, stepDurationFromText } from "./duration";
import { parseIngredientLine, type ParsedIngredient } from "./ingredient";
import { RECIPE_LIMITS, type RecipeSource, type RecipeStep, type RecipeTimes } from "./types";

/** Ricetta letta da una pagina: una bozza da rivedere, non ancora un evento. */
export interface ExtractedRecipe {
  title: string;
  description?: string;
  /** Assente se la pagina non lo dice in modo chiaro. */
  servings?: number;
  ingredients: ParsedIngredient[];
  steps: RecipeStep[];
  times?: RecipeTimes;
  equipment: string[];
  tags: string[];
  origin: RecipeSource;
}

export type ExtractionResult =
  | { found: true; recipe: ExtractedRecipe; alternatives: ExtractedRecipe[] }
  /** Nessun dato strutturato: titolo e testo principale ripuliti, per una lettura assistita. */
  | { found: false; title?: string; text: string };

export interface ExtractOptions {
  /** Indirizzo della pagina, usato come fonte della ricetta. */
  url?: string;
  maxHtmlChars?: number;
  maxTextChars?: number;
}

/** L'estrattore legge solo l'inizio della pagina: il resto è scartato. */
const DEFAULT_MAX_HTML = 500_000;
const MAX_TAG_CHARS = 600;
const MAX_STEP_SOURCE = 50_000;
const DEFAULT_MAX_TEXT = 20_000;
const MAX_JSON_BLOCK = 2_000_000;
const MAX_BLOCKS = 40;
const MAX_NODES = 20_000;
const MAX_DEPTH = 24;

// ---------------------------------------------------------------- entità e testo

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  shy: "", zwnj: "", zwj: "", euro: "€", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘",
  rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", deg: "°", middot: "·", bull: "•",
  frac12: "½", frac14: "¼", frac34: "¾", times: "×", copy: "©", reg: "®", trade: "™",
  agrave: "à", aacute: "á", egrave: "è", eacute: "é", igrave: "ì", iacute: "í", ograve: "ò",
  oacute: "ó", ugrave: "ù", uacute: "ú", Agrave: "À", Egrave: "È", Eacute: "É", Igrave: "Ì",
  Ograve: "Ò", Ugrave: "Ù", ccedil: "ç", ntilde: "ñ", ouml: "ö", uuml: "ü", auml: "ä",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
};

/** Decodifica le entità HTML in un solo passaggio (`&amp;lt;` diventa `&lt;`, non `<`). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,9});/gi, (m, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return " ";
      }
      if (code < 0x20 && code !== 9 && code !== 10) return " ";
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return v ?? m;
  });
}

const BLOCK_TAG_NAMES: ReadonlySet<string> = new Set([
  "br", "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th", "section",
  "article", "main", "header", "table", "blockquote", "dd", "dt", "dl", "figure", "figcaption", "pre", "hr",
]);

const isAsciiLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAsciiAlnum = (c: number): boolean => isAsciiLetter(c) || (c >= 48 && c <= 57);

/**
 * Toglie i tag con UNA scansione lineare, senza espressioni regolari: ogni `<` e ogni `>` si
 * guardano una volta sola (un tag non chiuso consuma il resto del testo, come fa un browser).
 * Con `blocks` i tag di blocco e `<br>` diventano un a capo, gli altri spariscono; senza, ogni tag
 * diventa uno spazio.
 */
function markupToText(html: string, blocks: boolean): string {
  const out: string[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    if (lt > i) out.push(html.slice(i, lt));
    const c = html.charCodeAt(lt + 1);
    if (!(isAsciiLetter(c) || c === 47 || c === 33 || c === 63)) {
      out.push("<");
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf(">", lt + 2);
    if (gt < 0) break;
    if (!blocks) out.push(" ");
    else {
      let j = lt + 1;
      if (c === 47) j++;
      let k = j;
      while (k < gt && k - j < 12 && isAsciiAlnum(html.charCodeAt(k))) k++;
      const end = html.charCodeAt(k);
      const boundary = k >= gt || end === 32 || end === 47 || (end >= 9 && end <= 13);
      if (boundary && k > j && BLOCK_TAG_NAMES.has(html.slice(j, k).toLowerCase())) out.push("\n");
    }
    i = gt + 1;
  }
  return out.join("");
}

const collapse = (s: string): string => s.replace(/[\s ]+/g, " ").trim();

/** Righe di testo di un frammento HTML (una per blocco), senza righe vuote. */
function textLines(html: string): string[] {
  return decodeEntities(markupToText(html, true))
    .split("\n")
    .map(collapse)
    .filter((l) => l !== "");
}

/** Testo di un frammento HTML su una riga: tag tolti, entità decodificate, spazi compattati. */
function inlineText(html: string): string {
  return collapse(decodeEntities(markupToText(html, false)));
}

/** Come `inlineText` ma conserva gli a capo dei blocchi e dei `<br>`. */
function blockText(html: string): string {
  return textLines(html).join("\n");
}

// ---------------------------------------------------------------- scansione lineare

/** Tag il cui contenuto non è testo: se non sono chiusi, si taglia fino alla fine del documento. */
const CUT_IF_UNCLOSED = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "canvas"]);

/**
 * Toglie script, stili, menu, piè di pagina e simili. Un blocco non chiuso di un tag "di codice"
 * taglia fino alla fine; un `<head>` non chiuso taglia fino a `<body`; gli altri restano com'è.
 */
function removeBlocks(html: string): string {
  const open =
    /<(script|style|noscript|template|svg|iframe|object|embed|canvas|head|nav|footer|aside|form|button|select|dialog)(?=[\s>/])/gi;
  const closers = new Map<string, RegExp>();
  const unclosed = new Set<string>();
  const bodyRe = /<body(?=[\s>/])/gi;
  let out = "";
  let pos = 0;
  for (;;) {
    const m = open.exec(html);
    if (!m) break;
    const tag = (m[1] as string).toLowerCase();
    if (unclosed.has(tag) || m.index < pos) continue;
    let closer = closers.get(tag);
    if (!closer) {
      closer = new RegExp(`</${tag}\\s*>`, "gi");
      closers.set(tag, closer);
    }
    closer.lastIndex = m.index + m[0].length;
    const c = closer.exec(html);
    if (c) {
      out += html.slice(pos, m.index);
      pos = c.index + c[0].length;
      open.lastIndex = pos;
    } else if (CUT_IF_UNCLOSED.has(tag)) {
      out += html.slice(pos, m.index);
      pos = html.length;
      break;
    } else if (tag === "head") {
      bodyRe.lastIndex = m.index;
      const body = bodyRe.exec(html);
      if (body) {
        out += html.slice(pos, m.index);
        pos = body.index;
        open.lastIndex = pos;
      } else unclosed.add(tag);
    } else unclosed.add(tag);
  }
  return out + html.slice(pos);
}

function stripComments(html: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const i = html.indexOf("<!--", pos);
    if (i < 0) break;
    out += html.slice(pos, i);
    const j = html.indexOf("-->", i + 4);
    if (j < 0) return out;
    pos = j + 3;
  }
  return out + html.slice(pos);
}

/** Primo blocco `<tag>…</tag>` del documento (interno compreso), se chiuso. */
function firstBlock(html: string, tag: string): string | undefined {
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "i").exec(html);
  if (!open) return undefined;
  const start = html.indexOf(">", open.index);
  if (start < 0) return undefined;
  const close = new RegExp(`</${tag}\\s*>`, "i");
  const rest = html.slice(start + 1);
  const c = close.exec(rest);
  return c ? rest.slice(0, c.index) : rest;
}

/** Attributi di un tag. Si leggono solo i primi caratteri: un attributo lunghissimo non deve costare tempo. */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const head = tag.slice(0, MAX_TAG_CHARS);
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,40})\s{0,4}=\s{0,4}(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(head)) && guard++ < 30) {
    out[(m[1] as string).toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function pageTitle(html: string): string | undefined {
  const metaOpen = /<meta(?=[\s>/])/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = metaOpen.exec(html)) && guard++ < 100) {
    const end = html.indexOf(">", m.index);
    if (end < 0) break;
    const a = attrsOf(html.slice(m.index, end + 1));
    metaOpen.lastIndex = end + 1;
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if ((key === "og:title" || key === "twitter:title") && a.content) {
      const t = inlineText(a.content);
      if (t) return t.slice(0, 200);
    }
  }
  const title = firstBlock(html, "title");
  if (title !== undefined) {
    const t = inlineText(title);
    if (t) return t.slice(0, 200);
  }
  const h1 = firstBlock(html, "h1");
  if (h1 !== undefined) {
    const t = inlineText(h1);
    if (t) return t.slice(0, 200);
  }
  return undefined;
}

/** Testo principale di una pagina, ripulito (senza script, stili, menu, piè di pagina). */
function mainText(html: string, maxChars: number): string {
  const cleaned = removeBlocks(stripComments(html));
  const body = firstBlock(cleaned, "body") ?? cleaned;
  const main = firstBlock(body, "main") ?? firstBlock(body, "article");
  const mainTxt = main !== undefined ? blockText(main) : "";
  const text = mainTxt.length >= 200 ? mainTxt : blockText(body);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const nl = cut.lastIndexOf("\n");
  return (nl > maxChars * 0.6 ? cut.slice(0, nl) : cut).trim();
}

// ---------------------------------------------------------------- JSON-LD

function ldJsonBlocks(html: string): string[] {
  const out: string[] = [];
  const open = /<script(?=[\s>/])/gi;
  const close = /<\/script(?=[\s>/])/gi;
  let m: RegExpExecArray | null;
  while (out.length < MAX_BLOCKS && (m = open.exec(html))) {
    const tagEnd = html.indexOf(">", m.index);
    if (tagEnd < 0) break;
    const attrs = attrsOf(html.slice(m.index, Math.min(tagEnd + 1, m.index + MAX_TAG_CHARS)));
    close.lastIndex = tagEnd + 1;
    const c = close.exec(html);
    const end = c ? c.index : html.length;
    if (/^application\/(?:ld\+json|json\+ld)\b/i.test((attrs.type ?? "").trim())) {
      out.push(html.slice(tagEnd + 1, end).slice(0, MAX_JSON_BLOCK));
    }
    if (!c) break;
    open.lastIndex = c.index + 8;
  }
  return out;
}

/** Rende leggibile JSON "quasi valido": a capo dentro le stringhe, virgole finali, commenti HTML intorno. */
function repairJson(src: string): string {
  // Solo confronti di testa e coda: nessuna espressione regolare su contenuto non fidato.
  let s = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  s = s.trim();
  if (s.startsWith("<!--")) s = s.slice(4);
  if (s.endsWith("-->")) s = s.slice(0, -3);
  s = s.trim();
  let head = s;
  if (head.startsWith("//")) head = head.slice(2).trimStart();
  if (head.startsWith("<![CDATA[")) {
    s = head.slice(9).trimEnd();
    if (s.endsWith("]]>")) s = s.slice(0, -3).trimEnd();
    if (s.endsWith("//")) s = s.slice(0, -2);
    s = s.trim();
  }
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (inStr) {
      if (ch === "\\") {
        out += ch + (s[i + 1] ?? "");
        i++;
      } else if (ch === '"') {
        inStr = false;
        out += ch;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch < " ") out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      else out += ch;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < s.length && (s[j] === " " || s[j] === "\n" || s[j] === "\r" || s[j] === "\t")) j++;
      if (s[j] !== "}" && s[j] !== "]") out += ch;
    } else out += ch;
  }
  return out;
}

function parseJsonTolerant(src: string): unknown {
  const attempts = [() => src, () => repairJson(src), () => repairJson(decodeEntities(src))];
  for (const make of attempts) {
    try {
      return JSON.parse(make());
    } catch {
      // si prova la riparazione successiva
    }
  }
  return undefined;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function typesOf(node: Obj): string[] {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list
    .filter((x): x is string => typeof x === "string")
    .map((x) => (x.split(/[/#:]/).pop() ?? "").toLowerCase());
}

interface Graph {
  index: Map<string, Obj>;
  recipes: Obj[];
}

function walkGraph(roots: readonly unknown[]): Graph {
  const index = new Map<string, Obj>();
  const recipes: Obj[] = [];
  const seen = new Set<object>();
  let budget = MAX_NODES;
  const visit = (v: unknown, depth: number): void => {
    if (budget-- <= 0 || depth > MAX_DEPTH || typeof v !== "object" || v === null) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const node = v as Obj;
    const id = node["@id"];
    if (typeof id === "string" && Object.keys(node).length > 1 && !index.has(id)) index.set(id, node);
    if (typesOf(node).includes("recipe")) recipes.push(node);
    for (const key of Object.keys(node)) {
      if (key === "@context") continue;
      visit(node[key], depth + 1);
    }
  };
  for (const r of roots) visit(r, 0);
  return { index, recipes };
}

// ---------------------------------------------------------------- campi della ricetta

function deref(v: unknown, g: Graph): unknown {
  if (isObj(v)) {
    const id = v["@id"];
    if (typeof id === "string" && Object.keys(v).length === 1) return g.index.get(id) ?? v;
  }
  return v;
}

function textOf(v: unknown, g: Graph, depth = 0): string {
  if (depth > 4) return "";
  const d = deref(v, g);
  if (typeof d === "string") return inlineText(d);
  if (typeof d === "number" && Number.isFinite(d)) return String(d);
  if (Array.isArray(d)) return textOf(d[0], g, depth + 1);
  if (isObj(d)) return textOf(d.name ?? d.text ?? d["@value"], g, depth + 1);
  return "";
}

function parseYield(v: unknown, g: Graph): number | undefined {
  const d = deref(v, g);
  const candidates: unknown[] = Array.isArray(d) ? d : [d];
  const ok = (n: number): number | undefined =>
    Number.isFinite(n) && n > 0 && n <= RECIPE_LIMITS.servingsMax ? n : undefined;
  for (const c of candidates) {
    if (typeof c === "number") {
      const n = ok(c);
      if (n !== undefined) return n;
      continue;
    }
    const s = textOf(c, g).slice(0, 100);
    const m = /(\d{1,3}(?:[.,]\d+)?)(?!\d)\s*(?:[-–]\s*\d+)?\s*([a-zà-ù]*)/i.exec(s);
    if (!m) continue;
    // "250 g di salsa" è una massa, non un numero di porzioni.
    if (/^(?:g|gr|kg|ml|l|lt|oz|lb|cl|dl)$/i.test(m[2] as string)) continue;
    const n = ok(parseFloat((m[1] as string).replace(",", ".")));
    if (n !== undefined) return n;
  }
  return undefined;
}

function stringList(v: unknown, g: Graph): string[] {
  const d = deref(v, g);
  const raw: string[] = [];
  if (typeof d === "string") raw.push(...d.slice(0, 5000).split(/[,;\n]/).slice(0, 200));
  else if (Array.isArray(d)) for (const x of d.slice(0, 200)) raw.push(typeof x === "string" ? x : textOf(x, g));
  else if (isObj(d)) raw.push(textOf(d, g));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = inlineText(r).slice(0, 60);
    const k = t.toLowerCase();
    if (t === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

function authorOf(v: unknown, g: Graph): string | undefined {
  const d = deref(v, g);
  const first = Array.isArray(d) ? d[0] : d;
  const t = textOf(first, g).slice(0, 100);
  return t === "" ? undefined : t;
}

function ingredientLines(v: unknown, g: Graph): string[] {
  const d = deref(v, g);
  const raw: string[] = [];
  if (typeof d === "string") raw.push(...textLines(d.slice(0, MAX_STEP_SOURCE)).slice(0, 600));
  else if (Array.isArray(d)) {
    for (const x of d.slice(0, 600)) {
      const t = typeof x === "string" ? inlineText(x) : textOf(x, g);
      if (t !== "") raw.push(t);
    }
  }
  return raw.filter((s) => s.trim() !== "").slice(0, RECIPE_LIMITS.ingredientsMax);
}

function splitInstructionText(s: string): string[] {
  const chunks = textLines(s.slice(0, MAX_STEP_SOURCE));
  if (chunks.length === 1) {
    const only = chunks[0] as string;
    // "1. Mescolare. 2. Cuocere." su una riga sola (il testo è già a spazi singoli).
    const parts = only.split(/ (?=\d{1,2}[.)] \S)/);
    if (parts.length >= 2 && /^1[.)] /.test(parts[0] as string)) return parts.map((p) => p.trim());
  }
  return chunks;
}

function collectSteps(v: unknown, g: Graph, out: RecipeStep[], depth = 0): void {
  if (depth > 6 || out.length >= RECIPE_LIMITS.stepsMax) return;
  const d = deref(v, g);
  if (typeof d === "string") {
    for (const t of splitInstructionText(d)) pushStep(out, t);
    return;
  }
  if (Array.isArray(d)) {
    for (const x of d) collectSteps(x, g, out, depth + 1);
    return;
  }
  if (!isObj(d)) return;
  if (d.itemListElement !== undefined) {
    collectSteps(d.itemListElement, g, out, depth + 1);
    return;
  }
  if (d.item !== undefined && d.text === undefined) {
    collectSteps(d.item, g, out, depth + 1);
    return;
  }
  const raw = typeof d.text === "string" && d.text.trim() !== "" ? d.text : d.name;
  if (typeof raw !== "string") return;
  const pieces = splitInstructionText(raw);
  const performed = parseIsoDuration(d.performTime);
  for (const t of pieces) pushStep(out, t, pieces.length === 1 ? performed : undefined);
}

function pushStep(out: RecipeStep[], text: string, performed?: number): void {
  const t = text.slice(0, 2100).replace(/^\s*(?:(?:passo|step)\s*)?\d{1,2}\s*[.):]\s+/i, "").trim().slice(0, 2000);
  if (t.length < 2 || out.length >= RECIPE_LIMITS.stepsMax) return;
  const d = performed ?? stepDurationFromText(t);
  out.push({ text: t, ...(d !== undefined ? { durationMinutes: d } : {}) });
}

function safeUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(s)) return undefined;
  return s;
}

function recipeFromNode(node: Obj, g: Graph, pageUrl: string | undefined): ExtractedRecipe | null {
  const title = (textOf(node.name, g) || textOf(node.headline, g)).slice(0, 200);
  const ingredients: ParsedIngredient[] = [];
  for (const line of ingredientLines(node.recipeIngredient ?? node.ingredients, g)) {
    const p = parseIngredientLine(line);
    if (p) ingredients.push(p);
  }
  const steps: RecipeStep[] = [];
  collectSteps(node.recipeInstructions, g, steps);
  if (title === "" || (ingredients.length === 0 && steps.length === 0)) return null;

  const times: RecipeTimes = {};
  const prep = parseIsoDuration(deref(node.prepTime, g));
  const cook = parseIsoDuration(deref(node.cookTime, g));
  const total = parseIsoDuration(deref(node.totalTime, g));
  if (prep !== undefined) times.prepMinutes = prep;
  if (cook !== undefined) times.cookMinutes = cook;
  if (total !== undefined) times.totalMinutes = total;

  const servings = parseYield(node.recipeYield, g);
  const description = textOf(node.description, g).slice(0, 500);
  const tags = stringList(
    [
      ...stringList(node.recipeCategory, g),
      ...stringList(node.recipeCuisine, g),
      ...stringList(node.keywords, g),
    ],
    g,
  );
  const equipment = stringList(node.tool ?? node.recipeEquipment, g);
  const author = authorOf(node.author, g);
  const url = pageUrl ?? safeUrl(node.url);

  return {
    title,
    ...(description !== "" ? { description } : {}),
    ...(servings !== undefined ? { servings } : {}),
    ingredients,
    steps,
    ...(Object.keys(times).length > 0 ? { times } : {}),
    equipment,
    tags,
    origin: { ...(url ? { url } : {}), ...(author ? { author } : {}) },
  };
}

const completeness = (r: ExtractedRecipe): number => r.ingredients.length * 2 + r.steps.length;

/**
 * Cerca una ricetta schema.org (JSON-LD, anche dentro `@graph`, anche più d'una) in una pagina HTML.
 * Se la trova restituisce la più completa e le altre; altrimenti "non trovata" con il titolo e il
 * testo principale ripuliti, da passare a una lettura assistita. Non lancia mai.
 */
export function extractRecipeFromHtml(html: string, options: ExtractOptions = {}): ExtractionResult {
  const maxHtml = options.maxHtmlChars ?? DEFAULT_MAX_HTML;
  const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT;
  let source = "";
  try {
    source = typeof html === "string" ? html.slice(0, maxHtml) : "";
    const pageUrl = safeUrl(options.url);
    const roots: unknown[] = [];
    for (const block of ldJsonBlocks(source)) {
      const parsed = parseJsonTolerant(block);
      if (parsed !== undefined) roots.push(parsed);
    }
    const graph = walkGraph(roots);
    const found: ExtractedRecipe[] = [];
    const keys = new Set<string>();
    for (const node of graph.recipes) {
      let r: ExtractedRecipe | null = null;
      try {
        r = recipeFromNode(node, graph, pageUrl);
      } catch {
        r = null;
      }
      if (!r) continue;
      const key = `${r.title.toLowerCase()}|${r.ingredients.length}|${r.steps.length}`;
      if (keys.has(key)) continue;
      keys.add(key);
      found.push(r);
    }
    if (found.length > 0) {
      let best = 0;
      found.forEach((r, i) => {
        if (completeness(r) > completeness(found[best] as ExtractedRecipe)) best = i;
      });
      const recipe = found[best] as ExtractedRecipe;
      return { found: true, recipe, alternatives: found.filter((_, i) => i !== best) };
    }
  } catch {
    // si ricade sul testo semplice
  }
  try {
    const title = pageTitle(source);
    return { found: false, ...(title ? { title } : {}), text: mainText(source, maxText) };
  } catch {
    return { found: false, text: "" };
  }
}
