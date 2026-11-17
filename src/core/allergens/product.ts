// Il controllo di un prodotto di Open Food Facts contro gli allergeni e le esclusioni dichiarati.
// Open Food Facts è scritto da volontari: i dati possono mancare o essere sbagliati. Per questo qui non esiste un esito
// «compatibile»: il caso migliore è `not_found`, «non risulta dai dati», e l'etichetta resta l'ultima parola.
// Nel dubbio vince sempre l'esito più prudente.
import { allergensInText, assessItem, assessText, canonicalAllergens, matchExclusion, uncertainAllergensInText } from "./engine";
import { foldText } from "./normalize";
import { analyzeTag, collectiveGroups, sharesWord } from "./offTags";

/** Ciò che serve sapere di un prodotto (`Product` del catalogo lo soddisfa). */
export interface ProductFacts {
  name?: string;
  /** Allergeni dichiarati: tag di Open Food Facts senza lingua («milk», «gluten»), o testo se non li conosciamo. */
  allergens?: readonly string[];
  /** Tracce dichiarate, nello stesso formato. */
  traces?: readonly string[];
  ingredientsText?: string;
  /** Lingua dell'elenco degli ingredienti. Solo «it» è letto con piena fiducia. */
  ingredientsLang?: string;
  /** Il testo degli ingredienti è stato tagliato: la fine dell'elenco manca. */
  ingredientsTruncated?: boolean;
  /** La scheda è stata letta chiedendo ingredienti e tracce. Senza, non si può mai dire «non risulta». */
  safetyFields?: boolean;
}

export interface ProductCriteria {
  allergens?: readonly string[];
  excludedFoods?: readonly string[];
}

/**
 * `contains` trovato; `traces` solo tracce; `uncertain` non si può dire; `not_found` non risulta dai dati (non è mai
 * «compatibile»).
 */
export type ProductVerdict = "contains" | "traces" | "uncertain" | "not_found";

/**
 * Perché: `tag` dichiarato tra gli allergeni; `ingredients` trovato nel testo degli ingredienti; `name` trovato nel nome;
 * `traces_tag` e `traces_text` tracce; `group_tag` e `group_traces` il tag indica un gruppo che può includere ciò che
 * l'utente ha dichiarato; `unknown_tag` tag non riconosciuto; `generic` ingredienti generici; `mixed_script` alfabeti
 * mescolati; `stale` scheda salvata prima di ingredienti e tracce; `no_data` dati assenti; `truncated` testo tagliato;
 * `foreign_text` ingredienti in un'altra lingua; `not_in_data` nulla trovato nei dati disponibili.
 */
export type ProductReason =
  | "tag"
  | "ingredients"
  | "name"
  | "traces_tag"
  | "traces_text"
  | "group_tag"
  | "group_traces"
  | "group_text"
  | "traces_unreadable"
  | "unknown_tag"
  | "generic"
  | "mixed_script"
  | "stale"
  | "no_data"
  | "truncated"
  | "foreign_text"
  | "not_in_data";

export interface ProductOutcome {
  kind: "allergen" | "exclusion";
  /** Com'è stato dichiarato dall'utente. */
  declared: string;
  /** Il nome da mostrare («Lattosio» → «latte»). */
  label: string;
  verdict: ProductVerdict;
  reason: ProductReason;
  /** La voce trovata (tag o parola degli ingredienti), se c'è. */
  term?: string;
  /** La frase da mostrare, in italiano. */
  text: string;
}

export interface ProductAssessment {
  /** Il peggiore tra gli esiti; `none` se non c'è nulla di dichiarato. */
  verdict: ProductVerdict | "none";
  outcomes: ProductOutcome[];
}

/** Perché l'esito non è un via libera: sta sempre accanto a `not_found` e `uncertain`. */
export const PRODUCT_CHECK_NOTICE = "Il dato viene da Open Food Facts, scritto da volontari: non sostituisce l'etichetta.";

const RANK: Record<ProductVerdict, number> = { not_found: 0, uncertain: 1, traces: 2, contains: 3 };

function outcomeText(o: Pick<ProductOutcome, "label" | "reason" | "term">): string {
  const term = o.term ?? o.label;
  switch (o.reason) {
    case "tag":
      return `Contiene ${o.label}: è tra gli allergeni dichiarati.`;
    case "ingredients":
      return `Contiene ${o.label}: negli ingredienti c'è «${term}».`;
    case "name":
      return `Contiene ${o.label}: lo dice il nome («${term}»).`;
    case "traces_tag":
    case "traces_text":
      return `Può contenere tracce di ${o.label}.`;
    case "group_tag":
      return `Tra gli allergeni c'è «${term}», che può includere ${o.label}. Controlla l'etichetta.`;
    case "group_traces":
      return `Può contenere tracce di «${term}», che può includere ${o.label}. Controlla l'etichetta.`;
    case "group_text":
      return `Gli ingredienti nominano «${term}», che può includere ${o.label}. Controlla l'etichetta.`;
    case "traces_unreadable":
      return `C'è una frase sulle tracce che non riesco a leggere: non so se riguarda ${o.label}. Controlla l'etichetta.`;
    case "unknown_tag":
      return `Open Food Facts riporta «${term}»: non lo riconosco, forse riguarda ${o.label}. Controlla l'etichetta.`;
    case "generic":
      return `Tra gli ingredienti c'è qualcosa di generico (come aromi o spezie): non so se c'è ${o.label}. Controlla l'etichetta.`;
    case "mixed_script":
      return "Nel testo ci sono lettere di alfabeti diversi: non posso leggerlo bene. Controlla l'etichetta.";
    case "stale":
      return "Scheda salvata prima: mancano ingredienti e tracce. Riprova con la rete e controlla l'etichetta.";
    case "no_data":
      return "Dati assenti: Open Food Facts non riporta ingredienti né allergeni. Controlla l'etichetta.";
    case "truncated":
      return `L'elenco degli ingredienti è molto lungo ed è stato tagliato: non posso dire se c'è ${o.label}. Controlla l'etichetta.`;
    case "foreign_text":
      return "Gli ingredienti sono in un'altra lingua e non posso leggerli bene. Controlla l'etichetta.";
    case "not_in_data":
      return "Non risulta dai dati di Open Food Facts. Controlla l'etichetta.";
  }
}

/* ---------- frasi sulle tracce dentro il testo degli ingredienti ---------- */

const APOS = "['’´`]?";
// la frase finisce a «)», «;», a capo o a un punto di fine frase: il resto è fatto di ingredienti
const LONG_MARKERS = [
  `pu[oòó]${APOS}\\s+(?:anche\\s+)?contenere`,
  "potrebbe\\s+contenere",
  "contiene\\s+(?:anche\\s+)?tracce",
  "(?:eventuali|possibili)\\s+tracce",
  "tracce\\s*:",
  "(?:prodotto|lavorato|confezionato|realizzato|fabbricato|preparato)\\s+in\\s+(?:uno\\s+|un\\s+)?(?:stabilimento|azienda|laboratorio|impianto)",
  `nell(?:o|['’])\\s*(?:stabilimento|azienda|laboratorio|impianto)`,
  "(?:nel|in\\s+questo)\\s+(?:nostro\\s+)?(?:stabilimento|laboratorio|impianto)",
  "(?:may|might)\\s+contain",
  "traces\\s+of",
  "(?:produced|manufactured|made|processed|packed)\\s+in\\s+(?:a|an|our|the)\\s+(?:facility|factory|plant|site)",
];
// «tracce di latte» in mezzo all'elenco finisce anche alla virgola
const SHORT_MARKERS = ["tracce\\s+(?:di|possibili|non\\s+intenzionali)"];
const MARKER = new RegExp(`(?<long>${LONG_MARKERS.join("|")})|(?<short>${SHORT_MARKERS.join("|")})`, "gi");

function spanEnd(text: string, from: number, stopAtComma: boolean): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === ")" || ch === "]" || ch === ";" || ch === "\n" || ch === "\r" || (stopAtComma && ch === ",")) return i;
    // il punto decimale («0.5») non chiude la frase
    if (ch === "." && !/\d/.test(text[i + 1] ?? "")) return i;
    // «…TRACCE DI SOIA INGREDIENTI: LATTE»: l'elenco riprende
    if (!/\p{L}/u.test(text[i - 1] ?? " ") && /^ingredient(?:i|s)\b/i.test(text.slice(i, i + 12))) return i;
  }
  return text.length;
}

/** Le frasi «può contenere tracce di…» non sono ingredienti: vanno a parte, e ciò che le segue resta un ingrediente. */
function splitTraceSentences(text: string): { ingredients: string; traces: string; spans: string[] } {
  const found: string[] = [];
  let ingredients = "";
  let cursor = 0;
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(text); m !== null; m = MARKER.exec(text)) {
    if (m.index < cursor) continue;
    const end = spanEnd(text, m.index + m[0].length, m.groups?.short !== undefined);
    ingredients += `${text.slice(cursor, m.index)} ; `;
    found.push(text.slice(m.index, end));
    cursor = end;
    MARKER.lastIndex = Math.max(end, m.index + 1);
  }
  ingredients += text.slice(cursor);
  return { ingredients, traces: found.join(" ; "), spans: found };
}

/** La frase senza la formula iniziale («può contenere tracce di»): resta ciò che si dichiara. */
function spanContent(span: string): string {
  MARKER.lastIndex = 0;
  const m = MARKER.exec(span);
  MARKER.lastIndex = 0;
  return m !== null && m.index === 0 ? span.slice(m[0].length) : span;
}

/** Parole di contorno delle frasi sulle tracce: non dicono nulla sugli allergeni. */
const SPAN_FILLER: ReadonlySet<string> = new Set([
  "che", "utilizza", "utilizzano", "usa", "usano", "lavora", "lavorano", "lavorati", "lavorazione", "anche", "altri", "altre", "prodotti",
  "prodotto", "contenenti", "contenente", "contengono", "contiene", "base", "presente", "presenti", "soprattutto", "quali", "quale",
  "come", "tra", "cui", "si", "ci", "sono", "possono", "essere", "tracce", "traccia", "allergeni", "allergene", "alimenti", "alimento",
  "that", "uses", "use", "also", "other", "products", "product", "containing", "contains", "contain", "any", "foods", "including",
  "such", "as", "may", "might", "be", "present", "traces", "trace", "is", "are", "in", "on", "we", "our", "it", "which", "handles",
  "handle", "process", "processes", "processed", "made", "produced", "packed", "facility", "factory", "plant", "site", "a", "an", "the",
]);

/* ---------- tag ---------- */

const clean = (list: readonly string[] | undefined): string[] => (list ?? []).map((t) => t.trim()).filter((t) => foldText(t) !== "");

type TagMatch = "exact" | "group" | "unknown" | "none";

interface Declared {
  text: string;
  /** I gruppi che la dichiarazione è per intero («latte»). */
  whole: readonly string[];
  /** I gruppi a cui appartiene, se è una voce specifica («nocciole» → frutta a guscio). */
  member: readonly string[];
}

/**
 * `exact`: il tag indica ciò che è dichiarato; `group`: il tag indica un gruppo che può includerlo («nuts» per
 * «nocciole»); `unknown`: il tag non si riconosce, quindi non si può escludere; `none`: indica altro.
 */
function matchTag(tag: string, d: Declared): TagMatch {
  const a = analyzeTag(tag);
  // «milk free», «sans lactose»: non dice che c'è, ma nemmeno si può contare su un tag scritto così
  if (a.negated) return "unknown";
  if (foldText(tag) === foldText(d.text) || sharesWord(tag, d.text)) return "exact";
  if (a.groups.length === 0) return "unknown";
  if (a.groups.some((g) => d.whole.includes(g))) return "exact";
  if (a.groups.some((g) => d.member.includes(g))) return "group";
  // un tag con parole che nessun sinonimo spiega («noix de coco») potrebbe parlare d'altro: non si esclude
  return a.residue ? "unknown" : "none";
}

interface Source {
  tags: string[];
  traceTags: string[];
  name: string;
  ingredients: string;
  traceText: string;
  /** Le singole frasi sulle tracce trovate nel testo. */
  spans: string[];
  hasIngredients: boolean;
  italian: boolean;
  truncated: boolean;
  complete: boolean;
}

const NON_LATIN = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Thai}]/u;

function check(kind: ProductOutcome["kind"], declaredText: string, source: Source): ProductOutcome {
  const whole = canonicalAllergens(declaredText);
  const d: Declared = { text: declaredText, whole, member: [...new Set([...whole, ...allergensInText(declaredText)])] };
  const label = kind === "allergen" ? (whole.length === 1 ? (whole[0] as string) : foldText(declaredText) || declaredText) : declaredText;
  const make = (verdict: ProductVerdict, reason: ProductReason, term?: string): ProductOutcome => {
    const o = { kind, declared: declaredText, label, verdict, reason, ...(term !== undefined ? { term } : {}) };
    return { ...o, text: outcomeText(o) };
  };
  const inText = (text: string): string | undefined => {
    if (text.trim() === "") return undefined;
    if (kind === "allergen") return assessText(text, [declaredText])[0]?.term;
    return matchExclusion(text, declaredText);
  };
  const mixedScript = (text: string): boolean =>
    NON_LATIN.test(text) && assessItem({ name: text }, [declaredText]).findings.some((f) => f.reason === "mixed_script");

  // 1. trovato
  const tags = source.tags.map((tag) => [tag, matchTag(tag, d)] as const);
  const exactTag = tags.find(([, m]) => m === "exact");
  if (exactTag) return make("contains", "tag", exactTag[0]);
  const inIngredients = inText(source.ingredients);
  if (inIngredients !== undefined) return make("contains", "ingredients", inIngredients);
  const inName = inText(source.name);
  if (inName !== undefined) return make("contains", "name", inName);

  // 2. solo tracce
  const traceTags = source.traceTags.map((tag) => [tag, matchTag(tag, d)] as const);
  const exactTrace = traceTags.find(([, m]) => m === "exact");
  if (exactTrace) return make("traces", "traces_tag", exactTrace[0]);
  const inTraces = inText(source.traceText);
  if (inTraces !== undefined) return make("traces", "traces_text", inTraces);
  // una frase che il motore non legge («May contain nuts») si legge con la mappa dei tag
  const spans = source.spans.map((span) => {
    const content = spanContent(span);
    const a = analyzeTag(content, SPAN_FILLER);
    const collective = collectiveGroups(content);
    return { named: [...a.named, ...collective.map((c) => c.key)], read: a.groups.length > 0 || collective.length > 0, residue: a.residue };
  });
  const wholeTrace = spans.flatMap((s) => s.named).find((g) => d.whole.includes(g));
  if (wholeTrace !== undefined) return make("traces", "traces_text", wholeTrace);

  // 3. dubbi che i dati o il motore segnalano
  if (mixedScript(source.ingredients) || mixedScript(source.name)) return make("uncertain", "mixed_script");
  if (kind === "allergen" && whole.length > 0 && source.ingredients.trim() !== "" && uncertainAllergensInText(source.ingredients).some((k) => whole.includes(k))) {
    return make("uncertain", "generic");
  }
  // un gruppo che può includere la voce dichiarata («nuts» per «nocciole»): nei tag, nelle tracce e nel testo
  const groupKey = (tag: string): string => analyzeTag(tag).groups.find((g) => d.member.includes(g)) ?? tag;
  const groupTag = tags.find(([, m]) => m === "group");
  if (groupTag) return make("uncertain", "group_tag", groupKey(groupTag[0]));
  const groupTrace = traceTags.find(([, m]) => m === "group");
  if (groupTrace) return make("uncertain", "group_traces", groupKey(groupTrace[0]));
  const groupText = collectiveGroups(source.ingredients).find((c) => d.member.includes(c.key));
  if (groupText) return make("uncertain", "group_text", groupText.phrase);
  const spanGroup = spans.flatMap((s) => s.named).find((g) => d.member.includes(g));
  if (spanGroup !== undefined) return make("uncertain", "group_traces", spanGroup);
  // anche se il resto si legge, una parte non capita («May contain milk and coconut») lascia il dubbio sulle altre voci
  if (spans.some((s) => !s.read || s.residue)) return make("uncertain", "traces_unreadable");
  const unknown = [...tags, ...traceTags].find(([, m]) => m === "unknown");
  if (unknown) return make("uncertain", "unknown_tag", unknown[0]);

  // 4. nulla trovato: senza un elenco di ingredienti completo e letto bene non si dice mai «non risulta»
  if (!source.complete) return make("uncertain", "stale");
  if (!source.hasIngredients) return make("uncertain", "no_data");
  if (source.truncated) return make("uncertain", "truncated");
  if (!source.italian) return make("uncertain", "foreign_text");
  return make("not_found", "not_in_data");
}

/**
 * Controlla un prodotto di Open Food Facts contro gli allergeni e le esclusioni dichiarati, uno per uno.
 * Presente nei tag o negli ingredienti → `contains`; solo nelle tracce → `traces`; dato dubbio, mancante o
 * incompleto → `uncertain`; elenco completo e nulla trovato → `not_found`, che non è un via libera.
 * I tag possono solo alzare l'esito, mai abbassarlo.
 */
export function assessProduct(product: ProductFacts, criteria: ProductCriteria): ProductAssessment {
  const split = splitTraceSentences(product.ingredientsText ?? "");
  const source: Source = {
    tags: clean(product.allergens),
    traceTags: clean(product.traces),
    name: product.name ?? "",
    ingredients: split.ingredients,
    traceText: split.traces,
    spans: split.spans,
    hasIngredients: foldText(split.ingredients) !== "",
    italian: product.ingredientsLang?.toLowerCase() === "it",
    truncated: product.ingredientsTruncated === true,
    complete: product.safetyFields === true,
  };
  const outcomes: ProductOutcome[] = [];
  const seen = new Set<string>();
  const add = (kind: ProductOutcome["kind"], list: readonly string[] | undefined) => {
    for (const raw of list ?? []) {
      const declared = raw.trim();
      const key = foldText(declared);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      outcomes.push(check(kind, declared, source));
    }
  };
  add("allergen", criteria.allergens);
  add("exclusion", criteria.excludedFoods);
  const verdict = outcomes.reduce<ProductVerdict | "none">((worst, o) => (worst === "none" || RANK[o.verdict] > RANK[worst] ? o.verdict : worst), "none");
  return { verdict, outcomes };
}
