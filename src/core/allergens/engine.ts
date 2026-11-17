// Il motore unico del controllo di allergeni ed esclusioni, usato dal ricettario, dal piano e dalle idee generate.
// Tre esiti: `contains` (trovato), `uncertain` (non si può sapere), `clear`.
//
// Regola invertita, per gli allergeni dichiarati: un ingrediente è `clear` solo se il suo nome è riconosciuto come
// alimento semplice di un elenco chiuso (`knownFoods.ts`) e nessuna tabella lo tocca. Un nome che non si riconosce è
// `uncertain` con il motivo «nome non riconosciuto»; un ingrediente generico o composto («crema», «salame») è
// `uncertain` con il motivo «ingrediente generico o composto».
//
// Le esclusioni scritte a mano NON seguono la regola invertita: lì l'utente nomina una cosa precisa («funghi»,
// «maiale») e il motore cerca quella cosa, i suoi iponimi e i prodotti che la contengono di solito; un nome che non la
// rivela non è sospetto.
import { HYPONYM_GROUPS } from "./hyponyms";
import {
  CITRUS_WORDS,
  DISH_HEAD_WORDS,
  DISH_NAMES,
  KNOWN_FOOD_SOURCES,
  MODIFIER_WORDS,
  PREPARATION_WORDS,
  PROCESSED_WORDS,
  PURPOSE_WORDS,
  SULFITE_WORDS,
  TEXTURE_WORDS,
  type FoodKind,
} from "./knownFoods";
import { OF_WORDS, STOPWORDS, foldText, segments, stemWord, words, type Segment, type Token } from "./normalize";
import { ALLERGEN_KEYS, ALLERGEN_TABLES, COMPOSITES, GENERIC_MASKS, GENERIC_TERMS, HIDDEN_CONTENTS, type AllergenKey } from "./tables";

export type Verdict = "contains" | "uncertain" | "clear";

/** Dove si è trovato: nome o nota dell'ingrediente, identificativo dell'alimento, alimento di dispensa collegato, prodotto, etichetta. */
export type FindingOrigin = "name" | "note" | "food" | "linked" | "product" | "label";

/**
 * Perché: `table` voce delle tabelle; `label` etichetta; `typo` parola a una lettera da una voce delle tabelle;
 * `generic` ingrediente generico o composto (anche una riga che nomina più alimenti o una preparazione);
 * `unrecognized` nome non riconosciuto; `gluten_free_claim` prodotto dichiarato «senza glutine» (la dichiarazione va
 * verificata in etichetta); `processed` prodotto lavorato, confezionato, conservato o essiccato.
 */
export type FindingReason = "table" | "label" | "typo" | "generic" | "unrecognized" | "gluten_free_claim" | "processed";

/** Il motivo detto all'utente. */
export const FINDING_REASON_TEXT: Readonly<Record<FindingReason, string>> = {
  table: "contiene l'allergene di norma",
  label: "dichiarato in etichetta",
  typo: "nome scritto quasi come un alimento che lo contiene",
  generic: "ingrediente generico o composto",
  unrecognized: "nome non riconosciuto",
  gluten_free_claim: "dichiarato senza glutine: va verificato in etichetta",
  processed: "prodotto lavorato o confezionato: va verificato in etichetta",
};

export interface Finding {
  /** L'allergene come chiave delle tabelle, o la parola dichiarata se le tabelle non la conoscono. */
  allergen: string;
  verdict: "contains" | "uncertain";
  /** La voce delle tabelle che ha fatto scattare il controllo (per esempio «cotoletta»), o le parole non riconosciute. */
  term: string;
  origin: FindingOrigin;
  /** Il testo in cui l'ha trovata. */
  text: string;
  reason: FindingReason;
  /** Con `typo`: «forse intendevi «mozzarella»?». */
  note?: string;
}

/** Ciò che si sa di un ingrediente o di un alimento. Tutto ciò che c'è viene controllato. */
export interface ItemSubject {
  name: string;
  note?: string;
  /** Identificativo dell'alimento della tabella nutrizionale («pasta-semola-secca»): conta come nome. */
  foodId?: string;
  /** Nomi degli alimenti di dispensa collegati all'ingrediente. */
  linkedNames?: readonly string[];
  /** Nome del prodotto, se noto (per esempio dal codice a barre). */
  productName?: string;
  /** Allergeni dichiarati in etichetta («en:milk», «latte»…). La loro assenza non prova nulla. */
  labelAllergens?: readonly string[];
}

export interface ItemAssessment {
  verdict: Verdict;
  /** Al più una per allergene: `contains` se c'è, altrimenti `uncertain`. */
  findings: Finding[];
}

/** Testo fisso per le schermate: che cosa il controllo fa e che cosa non può fare. */
export const ALLERGEN_CHECK_NOTICE =
  "Il controllo degli allergeni guarda i nomi di ingredienti, alimenti e prodotti: aiuta, ma non sostituisce la lettura dell'etichetta. Non rileva le tracce né le contaminazioni.";

/* ---------- compilazione delle voci ---------- */

type Part =
  | { kind: "exact"; form: string }
  | { kind: "prefix"; raw: string }
  | { kind: "infix"; raw: string }
  | { kind: "stem"; stem: string };

interface Pattern {
  source: string;
  parts: Part[];
}

function compile(entry: string): Pattern | undefined {
  let s = entry.trim();
  let mode: "stem" | "exact" | "prefix" | "infix" = "stem";
  if (s.startsWith("=")) {
    mode = "exact";
    s = s.slice(1);
  } else if (s.startsWith("~")) {
    mode = "infix";
    s = s.slice(1);
  } else if (s.endsWith("*")) {
    mode = "prefix";
    s = s.slice(0, -1);
  }
  const ws = words(s);
  const content = ws.filter((w) => !STOPWORDS.has(w));
  const used = content.length > 0 ? content : ws;
  if (used.length === 0) return undefined;
  const last = used.length - 1;
  const parts = used.map((w, i): Part => {
    if (mode === "exact") return { kind: "exact", form: w };
    if (mode === "infix" && used.length === 1) return { kind: "infix", raw: w };
    if (mode === "prefix" && i === last) return { kind: "prefix", raw: w };
    return { kind: "stem", stem: stemWord(w) };
  });
  return { source: ws.join(" "), parts };
}

const compileAll = (entries: readonly string[]): Pattern[] => entries.map(compile).filter((p): p is Pattern => p !== undefined);

function partMatches(part: Part, t: Token): boolean {
  switch (part.kind) {
    case "exact":
      return t.raw === part.form;
    case "prefix":
      return t.raw.startsWith(part.raw);
    case "infix":
      return t.raw.includes(part.raw);
    case "stem":
      return t.stem === part.stem || (part.stem.length >= 5 && t.stem.startsWith(part.stem));
  }
}

function patternMatches(seg: Segment, p: Pattern, masked: ReadonlySet<number>): boolean {
  return p.parts.every((part) => seg.tokens.some((t) => !t.at.some((i) => masked.has(i)) && partMatches(part, t)));
}

/** Nelle eccezioni la radice deve coincidere: niente inizi di parola, che allargherebbero l'eccezione. */
function maskPartMatches(part: Part, word: string, stem: string): boolean {
  if (part.kind === "exact") return word === part.form;
  if (part.kind === "stem") return stem === part.stem;
  return part.kind === "prefix" ? word.startsWith(part.raw) : word.includes(part.raw);
}

/** Le eccezioni valgono parola per parola, nell'ordine, con in mezzo al più due preposizioni «di». */
function maskedIndices(seg: Segment, masks: readonly Pattern[], into: Set<number>): void {
  const stems = seg.words.map(stemWord);
  for (const m of masks) {
    for (let start = 0; start < seg.words.length; start++) {
      let pos = start;
      let ok = true;
      for (let k = 0; k < m.parts.length && ok; k++) {
        if (k > 0) {
          let skipped = 0;
          while (pos < seg.words.length && OF_WORDS.has(seg.words[pos] as string) && skipped < 2) {
            pos++;
            skipped++;
          }
        }
        const w = seg.words[pos];
        const st = stems[pos];
        ok = w !== undefined && st !== undefined && maskPartMatches(m.parts[k] as Part, w, st);
        pos++;
      }
      // «latte di mandorla e di vacca»: la coordinazione riprende la prima parola («latte di vacca»), che non è più
      // coperta dall'eccezione
      if (ok && m.parts.length > 1 && CONJUNCTIONS.has(seg.words[pos] as string) && OF_WORDS.has(seg.words[pos + 1] as string)) ok = false;
      if (ok) for (let i = start; i < pos; i++) into.add(i);
    }
  }
}

const CONJUNCTIONS: ReadonlySet<string> = new Set(["e", "ed", "o", "od", "oppure", "ovvero", "and", "or"]);

const TEXTURE: ReadonlySet<string> = new Set(TEXTURE_WORDS);

/** «Patate a pasta gialla», «formaggio a pasta filata»: «a pasta» seguito da una consistenza non è la pasta. */
function textureIndices(words: readonly string[], into: Set<number>): void {
  for (let i = 1; i + 1 < words.length; i++) {
    if (words[i] === "pasta" && words[i - 1] === "a" && TEXTURE.has(words[i + 1] as string)) {
      into.add(i);
      into.add(i + 1);
    }
  }
}

/** Cereali che contengono glutine per natura: «farro senza glutine» non esiste, la dichiarazione non vale. */
const GLUTEN_BY_NATURE: ReadonlySet<string> = new Set(
  ["seitan", "farro", "orzo", "segale", "frumento", "grano", "kamut", "spelta", "bulgur", "triticale", "khorasan", "freekeh", "wheat", "barley", "rye", "spelt"].map(stemWord),
);

/**
 * «Pasta senza glutine», «pane gluten free»: la dichiarazione vale per la parola che la precede, che qui viene
 * segnata. Non vale per un cereale che il glutine lo contiene per natura. Chi chiama non dà mai `clear` per ciò che
 * è segnato qui: al più `uncertain`, perché la dichiarazione si verifica solo in etichetta.
 */
function glutenFreeIndices(seg: Segment, into: Set<number>): void {
  const ws = seg.words;
  const prevContent = (j: number): number | undefined => {
    for (let i = j - 1; i >= 0; i--) if (!STOPWORDS.has(ws[i] as string)) return i;
    return undefined;
  };
  for (let j = 0; j < ws.length; j++) {
    const w = ws[j];
    const next = ws[j + 1];
    let span: number[] | undefined;
    if (w === "senza" && (next === "glutine" || next === "gluten")) span = [j, j + 1];
    else if (w === "gluten" && next === "free") span = [j, j + 1];
    else if (w === "glutenfree") span = [j];
    if (!span) continue;
    for (const i of span) into.add(i);
    const head = prevContent(j);
    if (head !== undefined && !GLUTEN_BY_NATURE.has(stemWord(ws[head] as string))) into.add(head);
  }
}

/* ---------- bersagli: allergeni dichiarati ed esclusioni ---------- */

interface Target {
  /** Chiave delle tabelle o parola dichiarata. */
  label: string;
  key?: AllergenKey;
  contains: Pattern[];
  masks: Pattern[];
  /** Composti che per questo allergene sono incerti: non subiscono le eccezioni. */
  uncertain: Pattern[];
  glutenFree: boolean;
}

const GENERIC = compileAll(GENERIC_TERMS);
const GENERIC_MASK = compileAll(GENERIC_MASKS);

const stemKey = (s: string): string =>
  words(s.trim().toLowerCase().replace(/^[a-z]{2}:/, ""))
    .filter((w) => !STOPWORDS.has(w) && !IGNORED_IN_DECLARATIONS.has(w))
    .map(stemWord)
    .join(" ");

/** Parole che non cambiano l'allergene dichiarato: «allergia al latte» = «latte». */
const IGNORED_IN_DECLARATIONS: ReadonlySet<string> = new Set([
  "allergia", "allergie", "allergico", "allergica", "intolleranza", "intolleranze", "intollerante", "senza", "no",
  "niente", "evitare", "allergy", "free",
]);

const ALIAS_INDEX: ReadonlyMap<string, readonly AllergenKey[]> = (() => {
  const m = new Map<string, AllergenKey[]>();
  for (const t of ALLERGEN_TABLES) {
    for (const alias of [t.key, ...t.aliases]) {
      const k = stemKey(alias);
      if (k === "") continue;
      const list = m.get(k) ?? [];
      if (!list.includes(t.key)) list.push(t.key);
      m.set(k, list);
    }
  }
  return m;
})();

/** Una parola sola delle dichiarazioni («latte» in «latte vaccino intero») basta a riconoscere l'allergene. */
const SINGLE_WORD_ALIASES: ReadonlyMap<string, readonly AllergenKey[]> = new Map([...ALIAS_INDEX].filter(([k]) => !k.includes(" ")));

/**
 * Gli allergeni delle tabelle che un valore dichiarato indica, letto in modo tollerante: maiuscole, accenti, singolare
 * e plurale, prefissi di lingua («en:milk»), inglese, «allergia a…». Vuoto se non lo riconosce.
 */
export function canonicalAllergens(value: string): AllergenKey[] {
  const k = stemKey(value);
  if (k === "") return [];
  const exact = ALIAS_INDEX.get(k);
  if (exact) return [...exact];
  const out: AllergenKey[] = [];
  for (const w of k.split(" ")) for (const key of SINGLE_WORD_ALIASES.get(w) ?? []) if (!out.includes(key)) out.push(key);
  return out;
}

/** La chiave delle tabelle di un valore dichiarato, se lo riconosce con certezza (il primo, se ne indica più d'uno). */
export function canonicalAllergen(value: string): AllergenKey | undefined {
  const k = stemKey(value);
  return k === "" ? undefined : ALIAS_INDEX.get(k)?.[0];
}

const keyTargets = new Map<AllergenKey, Target>();
function keyTarget(key: AllergenKey): Target {
  const cached = keyTargets.get(key);
  if (cached) return cached;
  const table = ALLERGEN_TABLES.find((t) => t.key === key) as (typeof ALLERGEN_TABLES)[number];
  const composites = COMPOSITES.filter((c) => c.contains.includes(key)).map((c) => c.term);
  const uncertain = COMPOSITES.filter((c) => c.uncertain === "all" || c.uncertain.includes(key)).map((c) => c.term);
  const target: Target = {
    label: key,
    key,
    contains: compileAll([...table.terms, ...composites]),
    masks: compileAll(table.masks),
    uncertain: compileAll(uncertain),
    glutenFree: key === "glutine",
  };
  keyTargets.set(key, target);
  return target;
}

const literalTargets = new Map<string, Target>();
function literalTarget(label: string): Target {
  const cached = literalTargets.get(label);
  if (cached) return cached;
  const single = !label.includes(" ");
  const target: Target = {
    label,
    contains: compileAll(single ? [label, `${label}*`] : [label]),
    masks: [],
    uncertain: compileAll(COMPOSITES.filter((c) => c.uncertain === "all").map((c) => c.term)),
    glutenFree: false,
  };
  literalTargets.set(label, target);
  return target;
}

/** I bersagli degli allergeni dichiarati, senza doppioni e nell'ordine: chiavi note, poi le parole che non conosce. */
function resolve(allergens: readonly string[]): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const push = (t: Target) => {
    if (seen.has(t.label)) return;
    seen.add(t.label);
    out.push(t);
  };
  for (const requested of allergens) {
    const literal = foldText(requested);
    if (literal === "") continue;
    const exact = ALIAS_INDEX.get(stemKey(requested));
    if (exact) {
      for (const key of exact) push(keyTarget(key));
      continue;
    }
    for (const key of canonicalAllergens(requested)) push(keyTarget(key));
    push(literalTarget(literal));
  }
  return out;
}

/** L'etichetta con cui un allergene dichiarato compare nei risultati («Lattosio» → «latte»). */
export function allergenLabels(allergens: readonly string[]): string[] {
  return resolve(allergens).map((t) => t.label);
}

/* ---------- scansione ---------- */

interface Scan {
  verdict: Verdict;
  term?: string;
  reason?: FindingReason;
}

function scan(text: string, target: Target, withUncertain: boolean): Scan {
  let uncertain: Scan | undefined;
  for (const seg of segments(text)) {
    const texture = new Set<number>();
    textureIndices(seg.words, texture);
    const masked = new Set(texture);
    maskedIndices(seg, target.masks, masked);
    let claimMasked: Set<number> | undefined;
    if (target.glutenFree) {
      claimMasked = new Set(masked);
      glutenFreeIndices(seg, claimMasked);
    }
    const hit = target.contains.find((p) => patternMatches(seg, p, claimMasked ?? masked));
    if (hit) return { verdict: "contains", term: hit.source, reason: "table" };
    if (!withUncertain || uncertain !== undefined) continue;
    // «pane senza glutine»: senza la dichiarazione sarebbe `contains`; con la dichiarazione è al più `uncertain`
    const claimed = claimMasked ? target.contains.find((p) => patternMatches(seg, p, masked)) : undefined;
    if (claimed) {
      uncertain = { verdict: "uncertain", term: `${claimed.source} senza glutine`, reason: "gluten_free_claim" };
      continue;
    }
    const composite = target.uncertain.find((p) => patternMatches(seg, p, texture));
    if (composite) {
      uncertain = { verdict: "uncertain", term: composite.source, reason: "generic" };
      continue;
    }
    const genericMasked = new Set<number>();
    for (const i of texture) genericMasked.add(i);
    maskedIndices(seg, GENERIC_MASK, genericMasked);
    const generic = GENERIC.find((p) => patternMatches(seg, p, genericMasked));
    if (generic) uncertain = { verdict: "uncertain", term: generic.source, reason: "generic" };
  }
  return uncertain ?? { verdict: "clear" };
}

/* ---------- alimenti semplici riconosciuti (regola invertita) ---------- */

interface KnownEntry {
  /** Allergeni per cui il nome non vale: li contiene (o può contenerli) l'alimento da cui viene. */
  bad: Set<AllergenKey>;
  /** Il nome non vale per nessun allergene (salumi, prodotti lavorati, piatti). */
  allBad: boolean;
  kinds: Set<FoodKind>;
}

/**
 * La chiave di una parola nell'elenco: la radice, o la parola intera se la radice è corta («uva» e «uvo» hanno la
 * stessa radice «uv»: solo la parola scritta così vale).
 */
const wordKey = (w: string): string => {
  const st = stemWord(w);
  return st.length <= 3 || ambiguousStems.has(st) ? `=${w}` : st;
};

/**
 * Radici condivise da alimenti di gruppi diversi («pesca» e «pesce»), o da un alimento semplice e da un prodotto
 * («galletti», funghi, e «gallette» di riso): lì vale solo la parola scritta così. Si calcolano dall'elenco stesso,
 * prima dell'indice.
 */
const ambiguousStems: Set<string> = (() => {
  const signatures = new Map<string, Set<string>>();
  const simpleWords = new Map<string, Set<string>>();
  const otherWords = new Map<string, Set<string>>();
  for (const src of KNOWN_FOOD_SOURCES) {
    const simple = src.simple && src.implied !== "all";
    const sig = simple ? [...src.implied].sort().join(",") : "";
    // solo i nomi di una parola: è lì che una radice indica da sola alimenti diversi
    for (const phrase of src.phrases) {
      const ws = words(phrase).filter((w) => !STOPWORDS.has(w));
      if (ws.length !== 1) continue;
      const w = ws[0] as string;
      const st = stemWord(w);
      const byStem = simple ? simpleWords : otherWords;
      byStem.set(st, (byStem.get(st) ?? new Set<string>()).add(w));
      if (simple) signatures.set(st, (signatures.get(st) ?? new Set<string>()).add(sig));
    }
  }
  const out = new Set([...signatures].filter(([, sigs]) => sigs.size > 1).map(([st]) => st));
  for (const [st, ws] of otherWords) {
    const known = simpleWords.get(st);
    if (known && [...ws].some((w) => !known.has(w))) out.add(st);
  }
  return out;
})();

const phraseKey = (ws: readonly string[]): string =>
  ws
    .filter((w) => !STOPWORDS.has(w))
    .map(wordKey)
    .join(" ");

const MODIFIER_STEMS: ReadonlySet<string> = new Set(MODIFIER_WORDS.flatMap((w) => words(w)).map(stemWord));
const PROCESSED: ReadonlySet<string> = new Set(PROCESSED_WORDS);
const SULFITE: ReadonlySet<string> = new Set(SULFITE_WORDS);
const PREPARATION: ReadonlySet<string> = new Set(PREPARATION_WORDS);
const DISH_HEAD: ReadonlySet<string> = new Set(DISH_HEAD_WORDS);
const MAX_PHRASE_WORDS = 5;

/** Una parola sola che è anche un aggettivo innocuo («romano», «cotto», «coste») conta come aggettivo, non come alimento. */
const isModifierPhrase = (ws: readonly string[]): boolean => ws.length === 1 && MODIFIER_STEMS.has(stemWord(ws[0] as string));

let knownIndex: Map<string, KnownEntry> | undefined;
let fullNames: Map<string, KnownEntry> | undefined;

/** L'indice dei nomi di alimenti semplici, costruito alla prima richiesta (serve `scan` per sapere che cosa contengono). */
function knownFoods(): Map<string, KnownEntry> {
  if (knownIndex) return knownIndex;
  // Per ogni nome: gli allergeni del gruppo (o dell'elenco) di TUTTE le voci semplici che lo usano, più quelli che il
  // nome completo rivela in TUTTE le voci che lo usano. Così «rosso d'uovo» non vale per le uova, mentre «riso», alias
  // anche di voci che nel nome dicono «a grana lunga», non diventa sospetto di latte.
  const implied = new Map<string, Set<AllergenKey>>();
  const derived = new Map<string, Set<AllergenKey>>();
  const kinds = new Map<string, Set<FoodKind>>();
  const names = new Map<string, KnownEntry>();
  for (const src of KNOWN_FOOD_SOURCES) {
    if (!src.simple || src.implied === "all") continue;
    const fromName = new Set<AllergenKey>();
    if (src.name !== "") {
      for (const key of ALLERGEN_KEYS) if (scan(src.name, keyTarget(key), true).verdict !== "clear") fromName.add(key);
      const bad = new Set([...src.implied, ...fromName]);
      names.set(foldText(src.name), { bad, allBad: bad.size === ALLERGEN_KEYS.length, kinds: new Set(src.kind ? [src.kind] : []) });
    }
    for (const phrase of src.phrases) {
      const ws = words(phrase);
      if (isModifierPhrase(ws.filter((w) => !STOPWORDS.has(w)))) continue;
      const k = phraseKey(ws);
      if (k === "") continue;
      const imp = implied.get(k) ?? new Set<AllergenKey>();
      for (const key of src.implied) imp.add(key);
      implied.set(k, imp);
      const prev = derived.get(k);
      derived.set(k, prev ? new Set([...prev].filter((key) => fromName.has(key))) : new Set(fromName));
      const ks = kinds.get(k) ?? new Set<FoodKind>();
      if (src.kind) ks.add(src.kind);
      kinds.set(k, ks);
    }
  }
  const index = new Map<string, KnownEntry>();
  for (const [k, imp] of implied) {
    const bad = new Set([...imp, ...(derived.get(k) ?? [])]);
    index.set(k, { bad, allBad: bad.size === ALLERGEN_KEYS.length, kinds: kinds.get(k) ?? new Set() });
  }
  // I nomi delle voci non semplici («pomodori pelati», «pane», «fichi secchi») bloccano il loro intervallo: non si
  // spezzano in nomi più corti che varrebbero. Un nome che è anche di una voce semplice («pomodori», «riso») resta valido.
  for (const src of KNOWN_FOOD_SOURCES) {
    if (src.simple && src.implied !== "all") continue;
    for (const phrase of src.phrases) {
      const ws = words(phrase);
      if (isModifierPhrase(ws.filter((w) => !STOPWORDS.has(w)))) continue;
      const k = phraseKey(ws);
      if (k !== "" && !index.has(k)) index.set(k, { bad: new Set(ALLERGEN_KEYS), allBad: true, kinds: new Set() });
    }
  }
  knownIndex = index;
  fullNames = names;
  return index;
}

const allowedFor = (e: KnownEntry, target: Target): boolean => !e.allBad && (target.key === undefined || !e.bad.has(target.key));
const onlyKinds = (e: KnownEntry, allowed: readonly FoodKind[]): boolean => e.kinds.size > 0 && [...e.kinds].every((k) => allowed.includes(k));
// «filetto» è anche alias del filetto di manzo, ma da solo non dice di che animale è: un taglio resta un taglio
const isCut = (e: KnownEntry): boolean => e.kinds.has("cut");
const isMeat = (e: KnownEntry): boolean => onlyKinds(e, ["meat", "cut"]);

interface Recognition {
  recognized: boolean;
  /** Le parole (o i gruppi di parole) che non sono alimenti semplici riconosciuti per questo allergene. */
  unknown: string[];
  /** Fatto di parole note ma non un alimento semplice: più alimenti, una preparazione, un prodotto lavorato. */
  flag?: { reason: "generic" | "processed"; term: string };
}

/** Le voci di un elenco nella stessa riga: «sale e pepe», «carote, sedano e cipolla» (le virgole le separa `segments`). */
function itemsOf(seg: Segment): string[][] {
  const out: string[][] = [[]];
  for (const w of seg.words) {
    if (CONJUNCTIONS.has(w)) out.push([]);
    else (out[out.length - 1] as string[]).push(w);
  }
  return out.filter((it) => it.length > 0);
}

/**
 * Il nome nomina UN alimento semplice noto (per questo allergene), più quantità, tagli e aggettivi innocui? Un elenco
 * («sale e pepe») vale voce per voce. Non basta un taglio da solo («petto», «coda»). Un nome noto di più parole che
 * non vale per l'allergene («fiocchi di mais» per il glutine) non si spezza in parole più corte che varrebbero.
 */
const PURPOSE: ReadonlySet<string> = new Set(PURPOSE_WORDS);
const CITRUS: ReadonlySet<string> = new Set(CITRUS_WORDS.map(stemWord));
const JUICE: ReadonlySet<string> = new Set(["succo", "spremuta", "spremute", "spremuto"]);
const FRESH: ReadonlySet<string> = new Set(["fresco", "fresca", "spremuto", "spremuta", "spremute", "appena"]);
const COUNT_WORDS: ReadonlySet<string> = new Set(["un", "uno", "una", "mezzo", "mezza", "due", "tre", "quattro", "cinque", "sei"]);
const AND_WORDS: ReadonlySet<string> = new Set(["e", "ed", "and"]);

/**
 * Toglie dalla voce ciò che non è da mangiare o non cambia l'alimento: lo scopo («per friggere», «per l'acqua»), la
 * consistenza («a pasta gialla»), e «succo» davanti a un agrume spremuto al momento («succo di 1 limone»).
 */
function edibleWords(item: readonly string[]): string[] {
  const skip = new Set<number>();
  for (let j = 0; j < item.length; j++) {
    if (item[j] !== "per") continue;
    let k = j + 1;
    while (k < item.length && STOPWORDS.has(item[k] as string)) k++;
    if (PURPOSE.has(item[k] as string)) for (let x = j; x <= k; x++) skip.add(x);
  }
  textureIndices(item, skip);
  const rest = item.filter((_, j) => !skip.has(j));
  if (!rest.some((w) => JUICE.has(w))) return rest;
  const fresh = rest.some((w) => /\d/.test(w) || COUNT_WORDS.has(w) || FRESH.has(w));
  const content = rest.filter((w) => !STOPWORDS.has(w) && !/\d/.test(w) && !JUICE.has(w) && !FRESH.has(w));
  const citrus = content.filter((w) => CITRUS.has(stemWord(w)));
  const onlyCitrus = citrus.length === 1 && content.every((w) => CITRUS.has(stemWord(w)) || MODIFIER_STEMS.has(stemWord(w)));
  return fresh && onlyCitrus ? rest.filter((w) => !JUICE.has(w) && w !== "appena") : rest;
}

let dishKeys: string[][] | undefined;

/** La riga nomina un piatto noto («pasta e fagioli»), o lega con «e» un cereale a una verdura, un legume, un pesce? */
function isDish(seg: Segment, found: readonly (readonly KnownEntry[])[]): boolean {
  if (!seg.words.some((w) => AND_WORDS.has(w))) return false;
  const keyOf = (ws: readonly string[]): string[] =>
    ws.filter((w) => AND_WORDS.has(w) || !STOPWORDS.has(w)).map((w) => (AND_WORDS.has(w) ? "&" : wordKey(w)));
  dishKeys ??= DISH_NAMES.map((d) => keyOf(words(d)));
  const keys = keyOf(seg.words.filter((w) => !/\d/.test(w)));
  const at = (d: readonly string[], i: number): boolean => d.every((k, j) => keys[i + j] === k);
  if (dishKeys.some((d) => keys.some((_, i) => at(d, i)))) return true;
  const grain = found.some((es) => es.some((e) => onlyKinds(e, ["grain"])));
  const other = found.some((es) => es.some((e) => e.kinds.has("produce") || e.kinds.has("legume") || e.kinds.has("fish")));
  return grain && other;
}

function recognize(text: string, target: Target): Recognition {
  const index = knownFoods();
  const full = fullNames?.get(foldText(text));
  if (full && allowedFor(full, target)) return { recognized: true, unknown: [] };
  const unknown: string[] = [];
  let flag: Recognition["flag"];
  let foods = 0;
  let cutOnly: string | undefined;
  let anchored = false;
  for (const seg of segments(text)) {
    const segFound: KnownEntry[][] = [];
    for (const raw of itemsOf(seg)) {
      const term = raw.join(" ");
      const item = edibleWords(raw);
      const ws = item.filter((w) => !STOPWORDS.has(w) && !/\d/.test(w));
      const st = ws.map(wordKey);
      const found: KnownEntry[] = [];
      let prepared = DISH_HEAD.has(ws[0] as string) && OF_WORDS.has(item[item.indexOf(ws[0] as string) + 1] as string);
      let processed = false;
      let dried = false;
      let i = 0;
      while (i < ws.length) {
        // «senza lattosio», «senza buccia»: non aggiunge niente da riconoscere
        if (ws[i] === "senza") {
          i += 2;
          continue;
        }
        let matched = 0;
        let entry: KnownEntry | undefined;
        let blocked = 0;
        for (let len = Math.min(MAX_PHRASE_WORDS, ws.length - i); len >= 1; len--) {
          const e = index.get(st.slice(i, i + len).join(" "));
          if (!e) continue;
          if (allowedFor(e, target)) {
            matched = len;
            entry = e;
            break;
          }
          if (blocked === 0) blocked = len;
        }
        if (entry && matched >= blocked) {
          found.push(entry);
          i += matched;
          continue;
        }
        if (blocked > 0) {
          unknown.push(ws.slice(i, i + blocked).join(" "));
          i += blocked;
          continue;
        }
        const w = ws[i] as string;
        if (PREPARATION.has(w)) prepared = true;
        else if (PROCESSED.has(w)) processed ||= !(ws[i - 1] === "non" && w.startsWith("trattat"));
        else if (SULFITE.has(w)) dried = true;
        else if (!MODIFIER_STEMS.has(stemWord(w))) unknown.push(w);
        i++;
      }
      foods += found.length;
      segFound.push(found);
      const main = found.filter((e) => !isCut(e));
      if (main.some((e) => onlyKinds(e, ["meat", "fish", "cut"]))) anchored = true;
      let itemFlag: Recognition["flag"];
      if (prepared || (main.length > 1 && !main.every(isMeat))) itemFlag = { reason: "generic", term };
      else if (processed) itemFlag = { reason: "processed", term };
      else if (dried && target.key === "solfiti" && found.some((e) => e.kinds.has("produce") || e.kinds.has("fish"))) itemFlag = { reason: "processed", term };
      else if (found.length > 0 && main.length === 0) cutOnly ??= term;
      flag ??= itemFlag;
    }
    if (segFound.length > 1 && isDish(seg, segFound)) flag ??= { reason: "generic", term: seg.words.join(" ") };
  }
  if (!flag && cutOnly !== undefined && !anchored) flag = { reason: "generic", term: cutOnly };
  return { recognized: unknown.length === 0 && foods > 0 && !flag, unknown, ...(flag ? { flag } : {}) };
}

/* ---------- errori di battitura ---------- */

interface TypoCandidate {
  raw: string;
  stem: string;
}

const typoCandidates = new Map<Target, TypoCandidate[]>();
function candidatesOf(target: Target): TypoCandidate[] {
  const cached = typoCandidates.get(target);
  if (cached) return cached;
  const out: TypoCandidate[] = [];
  for (const p of target.contains) {
    const part = p.parts[0];
    if (p.parts.length !== 1 || !part || (part.kind !== "stem" && part.kind !== "exact")) continue;
    if (p.source.includes(" ") || p.source.length < 6) continue;
    out.push({ raw: p.source, stem: stemWord(p.source) });
  }
  typoCandidates.set(target, out);
  return out;
}

/** Al più una modifica: una lettera in più, in meno, diversa, o due lettere vicine scambiate. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

let vocabulary: Set<string> | undefined;

/** Le radici di tutte le parole che le tabelle e l'elenco degli alimenti conoscono: quelle non sono refusi. */
function knownVocabulary(): Set<string> {
  if (vocabulary) return vocabulary;
  const entries = [
    ...ALLERGEN_TABLES.flatMap((t) => [...t.terms, ...t.masks, ...t.aliases]),
    ...COMPOSITES.map((c) => c.term),
    ...GENERIC_TERMS,
    ...GENERIC_MASKS,
    ...HYPONYM_GROUPS.flatMap((g) => [...g.names, ...g.members]),
    ...KNOWN_FOOD_SOURCES.flatMap((k) => k.phrases),
  ];
  vocabulary = new Set(entries.flatMap((e) => words(e)).map(stemWord));
  return vocabulary;
}

/** La voce delle tabelle (di almeno 6 lettere) da cui la parola dista una lettera: «mozarella» → «mozzarella». */
function typoOf(word: string, target: Target): string | undefined {
  if (word.length < 5 || word.includes(" ")) return undefined;
  const st = stemWord(word);
  if (knownVocabulary().has(st)) return undefined;
  for (const c of candidatesOf(target)) {
    if (withinOneEdit(word, c.raw) || (c.stem.length >= 5 && withinOneEdit(st, c.stem))) return c.raw;
  }
  return undefined;
}

const labelMatches = (target: Target, declared: readonly string[]): string | undefined =>
  declared.find((d) => (target.key ? canonicalAllergens(d).includes(target.key) : foldText(d) === target.label));

function sourcesOf(item: ItemSubject): { origin: FindingOrigin; text: string }[] {
  const out: { origin: FindingOrigin; text: string }[] = [{ origin: "name", text: item.name }];
  if (item.note) out.push({ origin: "note", text: item.note });
  if (item.foodId) out.push({ origin: "food", text: item.foodId });
  for (const n of item.linkedNames ?? []) if (n.trim() !== "") out.push({ origin: "linked", text: n });
  if (item.productName) out.push({ origin: "product", text: item.productName });
  return out;
}

function assessResolved(item: ItemSubject, targets: readonly Target[]): ItemAssessment {
  const findings: Finding[] = [];
  const sources = sourcesOf(item);
  for (const target of targets) {
    const declared = labelMatches(target, item.labelAllergens ?? []);
    if (declared !== undefined) {
      findings.push({ allergen: target.label, verdict: "contains", term: declared, origin: "label", text: declared, reason: "label" });
      continue;
    }
    let uncertain: Finding | undefined;
    let found: Finding | undefined;
    for (const s of sources) {
      const r = scan(s.text, target, true);
      const reason = r.reason ?? "table";
      if (r.verdict === "contains") {
        found = { allergen: target.label, verdict: "contains", term: r.term as string, origin: s.origin, text: s.text, reason };
        break;
      }
      if (r.verdict === "uncertain" && !uncertain) uncertain = { allergen: target.label, verdict: "uncertain", term: r.term as string, origin: s.origin, text: s.text, reason };
    }
    // regola invertita: nome, alimento collegato e prodotto devono essere alimenti semplici riconosciuti
    if (!found) {
      for (const s of sources) {
        if ((s.origin !== "name" && s.origin !== "linked" && s.origin !== "product") || s.text.trim() === "") continue;
        const rec = recognize(s.text, target);
        if (rec.recognized) continue;
        const typo = rec.unknown.map((w) => [w, typoOf(w, target)] as const).find(([, t]) => t !== undefined);
        if (typo) {
          const [word, entry] = typo as readonly [string, string];
          found = { allergen: target.label, verdict: "contains", term: entry, origin: s.origin, text: s.text, reason: "typo", note: `«${word}»: forse intendevi «${entry}»?` };
          break;
        }
        if (!uncertain) {
          if (rec.unknown.length === 0 && rec.flag) {
            uncertain = { allergen: target.label, verdict: "uncertain", term: rec.flag.term, origin: s.origin, text: s.text, reason: rec.flag.reason };
          } else {
            const term = rec.unknown.length > 0 ? rec.unknown.join(", ") : foldText(s.text);
            uncertain = { allergen: target.label, verdict: "uncertain", term, origin: s.origin, text: s.text, reason: "unrecognized" };
          }
        }
      }
    }
    if (found) findings.push(found);
    else if (uncertain) findings.push(uncertain);
  }
  const verdict: Verdict = findings.some((f) => f.verdict === "contains") ? "contains" : findings.length > 0 ? "uncertain" : "clear";
  return { verdict, findings };
}

/** Controlla un ingrediente o un alimento contro gli allergeni dichiarati: nome, nota, alimento collegato, prodotto, etichetta. */
export function assessItem(item: ItemSubject, allergens: readonly string[]): ItemAssessment {
  return assessResolved(item, resolve(allergens));
}

/**
 * Controlla un testo libero (un passo, un titolo): solo `contains`. Un passo che dice «aggiungi la salsa» non rende
 * incerta la ricetta: l'ingrediente «salsa» lo fa già, nella lista degli ingredienti.
 */
export function assessText(text: string, allergens: readonly string[]): Finding[] {
  const out: Finding[] = [];
  for (const target of resolve(allergens)) {
    const r = scan(text, target, false);
    if (r.verdict === "contains") out.push({ allergen: target.label, verdict: "contains", term: r.term as string, origin: "name", text, reason: "table" });
  }
  return out;
}

/** Gli allergeni delle tabelle che il testo contiene di sicuro (senza gli incerti). */
export function allergensInText(text: string): AllergenKey[] {
  return ALLERGEN_KEYS.filter((key) => scan(text, keyTarget(key), false).verdict === "contains");
}

/** Gli allergeni delle tabelle di cui il testo è un ingrediente generico o composto, senza contenerli di sicuro. */
export function uncertainAllergensInText(text: string): AllergenKey[] {
  return ALLERGEN_KEYS.filter((key) => scan(text, keyTarget(key), true).verdict === "uncertain");
}

/* ---------- esclusioni ---------- */

const exclusionTargets = new Map<string, Target>();
function exclusionTarget(term: string): Target | undefined {
  const label = foldText(term);
  if (label === "") return undefined;
  const cached = exclusionTargets.get(label);
  if (cached) return cached;
  const k = stemKey(term);
  const entries: string[] = [label];
  if (!label.includes(" ")) entries.push(`${label}*`);
  for (const g of HYPONYM_GROUPS) if (g.names.some((n) => stemKey(n) === k)) entries.push(...g.members);
  const contains = compileAll(entries);
  const masks: Pattern[] = [];
  for (const key of ALIAS_INDEX.get(k) ?? []) {
    const t = keyTarget(key);
    contains.push(...t.contains);
    masks.push(...t.masks);
  }
  const target: Target = { label, contains, masks, uncertain: [], glutenFree: false };
  // i prodotti composti che di solito contengono l'alimento escluso («pinoli» → pesto)
  const hidden = HIDDEN_CONTENTS.filter((h) => h.probes.some((probe) => scan(probe, target, false).verdict === "contains"));
  contains.push(...compileAll(hidden.map((h) => h.stem)));
  exclusionTargets.set(label, target);
  return target;
}

/**
 * La voce che fa ricadere il testo in un'esclusione scritta a mano: la parola stessa (singolare, plurale, accenti), i suoi
 * iponimi («maiale» → salsiccia, prosciutto…), e se è un allergene le sue tabelle. Undefined se non c'è.
 */
export function matchExclusion(text: string, excluded: string): string | undefined {
  const target = exclusionTarget(excluded);
  if (!target) return undefined;
  const r = scan(text, target, false);
  return r.verdict === "contains" ? r.term : undefined;
}

/** Come `matchExclusion`, su tutto ciò che si sa di un ingrediente. */
export function itemMatchesExclusion(item: ItemSubject, excluded: string): { term: string; origin: FindingOrigin; text: string } | undefined {
  for (const s of sourcesOf(item)) {
    const term = matchExclusion(s.text, excluded);
    if (term !== undefined) return { term, origin: s.origin, text: s.text };
  }
  return undefined;
}

/* ---------- ricetta intera ---------- */

export interface RecipeSubject {
  title?: string;
  ingredients: readonly ItemSubject[];
  steps?: readonly string[];
}

export interface IngredientHit {
  index: number;
  name: string;
  term: string;
  origin: FindingOrigin;
  text: string;
  /** Per gli allergeni: perché (voce delle tabelle, etichetta, nome non riconosciuto…). Assente per le esclusioni. */
  reason?: FindingReason;
  note?: string;
}

export interface TextHit {
  index: number;
  text: string;
  term: string;
}

export interface AllergenOutcome {
  allergen: string;
  verdict: "contains" | "uncertain";
  ingredients: IngredientHit[];
  steps: TextHit[];
  title?: { term: string };
}

export interface ExclusionOutcome {
  excluded: string;
  ingredients: IngredientHit[];
  steps: TextHit[];
  title?: { term: string };
}

export interface RecipeAssessment {
  verdict: Verdict;
  allergens: AllergenOutcome[];
  exclusions: ExclusionOutcome[];
}

/**
 * Controlla una ricetta: ingredienti (con tutto ciò che si sa di ciascuno) per `contains` e `uncertain`, passi e titolo
 * per `contains`. Un allergene trovato da qualche parte vince sull'incerto.
 */
export function assessRecipe(
  recipe: RecipeSubject,
  criteria: { allergens?: readonly string[]; excludedFoods?: readonly string[] },
): RecipeAssessment {
  const targets = resolve(criteria.allergens ?? []);
  const allergens: AllergenOutcome[] = [];
  if (targets.length > 0) {
    const perIngredient = recipe.ingredients.map((ing) => assessResolved(ing, targets).findings);
    for (const target of targets) {
      const ingredientHits = (verdict: "contains" | "uncertain"): IngredientHit[] =>
        perIngredient.flatMap((fs, index) =>
          fs
            .filter((f) => f.allergen === target.label && f.verdict === verdict)
            .map((f) => ({
              index,
              name: (recipe.ingredients[index] as ItemSubject).name,
              term: f.term,
              origin: f.origin,
              text: f.text,
              reason: f.reason,
              ...(f.note !== undefined ? { note: f.note } : {}),
            })),
        );
      const steps: TextHit[] = [];
      (recipe.steps ?? []).forEach((text, index) => {
        const r = scan(text, target, false);
        if (r.verdict === "contains") steps.push({ index, text, term: r.term as string });
      });
      const titleScan = recipe.title ? scan(recipe.title, target, false) : undefined;
      const title = titleScan?.verdict === "contains" ? { term: titleScan.term as string } : undefined;
      const contains = ingredientHits("contains");
      if (contains.length > 0 || steps.length > 0 || title) {
        allergens.push({ allergen: target.label, verdict: "contains", ingredients: contains, steps, ...(title ? { title } : {}) });
        continue;
      }
      const uncertain = ingredientHits("uncertain");
      if (uncertain.length > 0) allergens.push({ allergen: target.label, verdict: "uncertain", ingredients: uncertain, steps: [] });
    }
  }

  const exclusions: ExclusionOutcome[] = [];
  for (const excluded of criteria.excludedFoods ?? []) {
    if (foldText(excluded) === "") continue;
    const ingredients: IngredientHit[] = [];
    recipe.ingredients.forEach((ing, index) => {
      const m = itemMatchesExclusion(ing, excluded);
      if (m) ingredients.push({ index, name: ing.name, ...m });
    });
    const steps: TextHit[] = [];
    (recipe.steps ?? []).forEach((text, index) => {
      const term = matchExclusion(text, excluded);
      if (term !== undefined) steps.push({ index, text, term });
    });
    const titleTerm = recipe.title ? matchExclusion(recipe.title, excluded) : undefined;
    if (ingredients.length > 0 || steps.length > 0 || titleTerm !== undefined) {
      exclusions.push({ excluded, ingredients, steps, ...(titleTerm !== undefined ? { title: { term: titleTerm } } : {}) });
    }
  }

  const verdict: Verdict =
    exclusions.length > 0 || allergens.some((a) => a.verdict === "contains") ? "contains" : allergens.length > 0 ? "uncertain" : "clear";
  return { verdict, allergens, exclusions };
}
