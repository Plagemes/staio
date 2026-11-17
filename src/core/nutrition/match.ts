// Ricerca di un alimento per nome. Principio: meglio nessun dato che un dato sbagliato.
// Il confronto è su insiemi di parole normalizzate (senza accenti, articoli, quantità, marche,
// plurali semplici); un nome ambiguo o troppo diverso non dà alcuna corrispondenza.

import type { FoodComposition } from "./types";

/** Parole che non distinguono un alimento da un altro. */
const STOPWORDS = new Set([
  "di", "del", "dello", "della", "dei", "degli", "delle", "dell", "d",
  "il", "lo", "la", "le", "i", "gli", "l", "un", "uno", "una", "un",
  "al", "allo", "alla", "ai", "agli", "alle", "all", "da", "dal", "dalla", "dall",
  "in", "nel", "nella", "nell", "con", "e", "ed", "a", "su", "sul", "sulla", "per", "x",
  "circa", "poco", "po", "bio", "biologico", "biologica", "biologici", "biologiche",
]);

/** Parole di quantità o di porzione: descrivono quanto, non che cosa. */
const QUANTITY_WORDS = new Set([
  "porzione", "porzioni", "fetta", "fette", "fettina", "fettine", "bicchiere", "bicchieri",
  "tazza", "tazze", "tazzina", "tazzine", "cucchiaio", "cucchiai", "cucchiaino", "cucchiaini",
  "pezzo", "pezzi", "etto", "etti", "scatola", "scatoletta", "confezione", "vasetto",
  "barattolo", "mezzo", "mezza", "mezzi", "mezze", "bustina", "grammi", "grammo", "litro", "litri",
]);

/** Marche comuni sul mercato italiano: si ignorano nella ricerca. Estendibili con `ignoreWords`. */
const BRANDS = [
  "barilla", "de cecco", "rummo", "divella", "la molisana", "garofalo", "voiello", "buitoni",
  "giovanni rana", "rana", "galbani", "president", "parmalat", "granarolo", "danone", "muller",
  "activia", "fage", "yomo", "vitasnella", "mulino bianco", "pavesi", "ferrero", "kinder",
  "loacker", "saiwa", "plasmon", "mellin", "esselunga", "coop", "conad", "carrefour", "lidl",
  "eurospin", "despar", "alpro", "valsoia", "amadori", "fileni", "veroni", "negroni", "beretta",
  "rovagnati", "citterio", "levoni", "bonduelle", "findus", "orogel", "cirio", "mutti", "knorr",
  "heinz", "kellogg", "nestle", "lindt", "san benedetto", "levissima", "ferrarelle", "lavazza",
  "illy", "segafredo", "kimbo",
];

/** Parole che differiscono solo per la vocale finale ma sono alimenti diversi: mai fuse. */
const PROTECTED = new Set(["pesce", "pesci", "pesca", "pesche"]);

/** Stato dell'alimento a cui si riferiscono i valori (`FoodComposition.state`). */
export type FoodState = NonNullable<FoodComposition["state"]>;

/** Parole che dichiarano lo stato nel nome: se la richiesta ne ha una, la preferenza non si applica. */
const STATE_WORDS = [
  "cotto", "cotta", "cotti", "cotte", "lessato", "lessata", "lessati", "lessate", "lesso", "lessa",
  "bollito", "bollita", "crudo", "cruda", "crudi", "crude", "secco", "secca", "secchi", "secche",
  "essiccato", "essiccata",
];

export interface MatchOptions {
  /**
   * Stati preferiti, in ordine di preferenza. Si applica SOLO tra voci con lo stesso `variantOf`
   * (lo stesso alimento in stati diversi, per esempio pasta secca e cotta): si cerca il nome
   * come se lo stato non esistesse e, se i migliori candidati sono tutti dello stesso gruppo, vale il
   * primo stato disponibile. Alimenti diversi o senza `variantOf` restano ambigui o non toccati.
   * Con preferenza `cooked` e solo la voce secca nel gruppo l'esito è `state_unavailable`; con solo
   * il crudo si usa il crudo con `honored: false`. Non si applica se il nome dichiara già lo stato
   * ("pasta cotta"). Si può passare anche per singola ricerca.
   */
  preferStates?: FoodState | readonly FoodState[];
  /** Fiducia minima per accettare una corrispondenza, da 0 a 1. Predefinito 0,75. */
  threshold?: number;
  /** Parole da ignorare, per esempio la marca letta dal codice a barre. */
  ignoreWords?: readonly string[];
  /** Due alimenti con fiducia più vicina di così sono ambigui. Predefinito 0,02. */
  ambiguityMargin?: number;
}

export const DEFAULT_MATCH_THRESHOLD = 0.75;
const DEFAULT_AMBIGUITY_MARGIN = 0.02;

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function stem(t: string): string {
  if (t.length <= 3 || /\d/.test(t) || PROTECTED.has(t)) return t;
  const s = t.replace(/chi$/, "co").replace(/ghi$/, "go");
  const stripped = /(ia|ie|io)$/.test(s) ? s.slice(0, -2) : /[aeio]$/.test(s) ? s.slice(0, -1) : s;
  return stripped.length >= 3 ? stripped : t;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parole significative di un nome: minuscolo, senza accenti, quantità, articoli e marche,
 * ciascuna ridotta alla radice così che singolare e plurale coincidano. Le percentuali restano
 * ("0%" distingue due yogurt); i numeri iniziali sono quantità ("2 uova"), quelli finali no
 * ("farina 00").
 */
export function nameTokens(name: string, ignoreWords: readonly string[] = []): string[] {
  let s = fold(name)
    .replace(/yoghurt|yoghourt|yogourt|jogurt/g, "yogurt")
    .replace(/[’'`´]/g, " ")
    .replace(/(\d+)(?:[.,](\d+))?\s*%/g, (_m, i: string, f?: string) => ` ${i}${f ? "p" + f : ""}pct `)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|hg|mg|gr|g|ml|cl|dl|lt|l|pz|pezzi|pezzo)\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\b\d+\s*x\b|\bx\s*\d+\b/g, " ");
  for (const phrase of [...BRANDS, ...ignoreWords.map(fold)]) {
    if (phrase === "") continue;
    s = s.replace(new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`, "g"), " ");
  }
  const raw = s.split(/[^a-z0-9]+/).filter((t) => t !== "");
  while (raw.length > 1 && /^\d+$/.test(raw[0])) raw.shift();
  return raw.filter((t) => !STOPWORDS.has(t) && !QUANTITY_WORDS.has(t)).map(stem);
}

/** Forma normalizzata di un nome, per confronti e diagnosi. */
export function normalizeName(name: string, ignoreWords: readonly string[] = []): string {
  return nameTokens(name, ignoreWords).join(" ");
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

const FUZZY_WEIGHT = 0.8;
const MIN_QUERY_COVERAGE = 0.75;

function tokenWeight(a: string, b: string): number {
  if (a === b) return 1;
  if (/\d/.test(a) || /\d/.test(b) || PROTECTED.has(a) || PROTECTED.has(b)) return 0;
  if (a.length >= 5 && b.length >= 5 && editDistanceAtMostOne(a, b)) return FUZZY_WEIGHT;
  return 0;
}

/** Somiglianza tra due insiemi di parole, da 0 a 1 (coefficiente di Dice con refusi pesati meno). */
function similarity(query: readonly string[], candidate: readonly string[]): number {
  if (query.length === 0 || candidate.length === 0) return 0;
  const usedC = new Set<number>();
  const usedQ = new Set<number>();
  let matched = 0;
  for (const pass of [1, FUZZY_WEIGHT]) {
    query.forEach((q, qi) => {
      if (usedQ.has(qi)) return;
      for (let ci = 0; ci < candidate.length; ci++) {
        if (usedC.has(ci)) continue;
        if (tokenWeight(q, candidate[ci]) === pass) {
          usedQ.add(qi);
          usedC.add(ci);
          matched += pass;
          return;
        }
      }
    });
  }
  const qw = matched / query.length;
  const cw = matched / candidate.length;
  const dice = qw + cw === 0 ? 0 : (2 * qw * cw) / (qw + cw);
  // Parole della richiesta che l'alimento non ha: possono essere una marca ignota, ma anche un
  // qualificativo che cambia l'alimento ("parzialmente scremato"). Se sono troppe, si penalizza.
  return qw >= MIN_QUERY_COVERAGE ? dice : dice * qw;
}

export interface StatePreference {
  preferred: readonly FoodState[];
  /** Vero se l'alimento scelto ha uno degli stati preferiti. */
  honored: boolean;
}

export interface FoodMatch {
  food: FoodComposition;
  /** Da 0 a 1: 1 è un nome uguale a meno di maiuscole, accenti, plurali e ordine delle parole. */
  confidence: number;
  matchedOn: "name" | "alias";
  /** Il nome o l'alias che ha prodotto la corrispondenza. */
  matchedText: string;
  /** Presente se si è applicata una preferenza di stato (solo per alimenti con `variantOf`). */
  statePreference?: StatePreference;
  /** Alimento a cui il nome corrispondeva prima che la preferenza di stato scegliesse questo. */
  stateSwitchedFrom?: FoodComposition;
}

export interface FindOptions {
  preferStates?: FoodState | readonly FoodState[];
}

export type MatchOutcome =
  | { status: "match"; match: FoodMatch; runnerUp?: FoodMatch }
  /** Più alimenti ugualmente plausibili: non si sceglie. */
  | { status: "ambiguous"; candidates: FoodMatch[] }
  /**
   * L'alimento è riconosciuto ma, tra le sue voci, manca quella dello stato richiesto e usare
   * un'altra darebbe un valore molto diverso: con preferenza `cooked` e solo la voce secca.
   */
  | { status: "state_unavailable"; reason: "missing_cooked_entry"; candidates: FoodMatch[] }
  /** Nessun alimento sopra la soglia; `best` è il più vicino, solo a titolo informativo. */
  | { status: "none"; best?: FoodMatch };

/** Un candidato per l'interfaccia: da mostrare all'utente perché scelga. */
export interface FoodCandidate {
  food: FoodComposition;
  /** Da 0 a 1, come `FoodMatch.confidence`. */
  confidence: number;
  state?: FoodState;
  /** Gruppo dello stesso alimento in stati diversi. */
  variantOf?: string;
  matchedOn: "name" | "alias";
  matchedText: string;
  /** Vero se compare solo perché gemello (stesso `variantOf`) di un altro candidato. */
  viaGroup: boolean;
}

export interface SearchOptions {
  /** Fiducia minima per un candidato. Predefinito: la soglia del matcher. */
  minConfidence?: number;
  /** Numero massimo di alimenti o gruppi; un gruppo non si spezza. Predefinito 10. */
  limit?: number;
}

export interface FoodMatcher {
  /**
   * Candidati per il testo scritto dall'utente, per farli scegliere: sempre, anche se ambigui.
   * Ordinati dal migliore; le voci dello stesso gruppo `variantOf` stanno una accanto all'altra
   * e compaiono tutte (anche se una sola corrisponde al testo), il gruppo si ordina per la sua
   * voce migliore. Non applica preferenze di stato.
   */
  search(query: string, options?: SearchOptions): FoodCandidate[];
  /** Esito completo, con ambiguità e candidati. */
  find(query: string, options?: FindOptions): MatchOutcome;
  /** Solo la corrispondenza, se univoca e sopra la soglia. */
  match(query: string, options?: FindOptions): FoodMatch | undefined;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const STATE_STEMS = new Set(STATE_WORDS.map(stem));
const toList = (v: FoodState | readonly FoodState[] | undefined): readonly FoodState[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

/** Prepara l'indice una volta sola: conviene quando si cercano molte voci. */
export function createFoodMatcher(
  foods: readonly FoodComposition[],
  options: MatchOptions = {},
): FoodMatcher {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const margin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  const ignore = options.ignoreWords ?? [];
  const index = foods.map((food) => ({
    food,
    entries: [
      { text: food.name, on: "name" as const },
      ...(food.aliases ?? []).map((text) => ({ text, on: "alias" as const })),
    ]
      .map((e) => ({ ...e, tokens: nameTokens(e.text, ignore) }))
      .filter((e) => e.tokens.length > 0),
  }));

  function rankFoods(q: readonly string[]): FoodMatch[] {
    const ranked: FoodMatch[] = [];
    for (const { food, entries } of index) {
      let best: FoodMatch | undefined;
      for (const e of entries) {
        const confidence = round3(similarity(q, e.tokens));
        if (confidence > 0 && (!best || confidence > best.confidence)) {
          best = { food, confidence, matchedOn: e.on, matchedText: e.text };
        }
      }
      if (best) ranked.push(best);
    }
    // L'ordinamento è stabile: a pari punteggio resta l'ordine della tabella.
    return ranked.sort((a, b) => b.confidence - a.confidence);
  }

  function search(query: string, searchOptions: SearchOptions = {}): FoodCandidate[] {
    const q = nameTokens(query, ignore);
    if (q.length === 0) return [];
    const min = searchOptions.minConfidence ?? threshold;
    const limit = searchOptions.limit ?? 10;
    const ranked = rankFoods(q);
    const own = new Map(ranked.map((r) => [r.food, r]));
    const out: FoodCandidate[] = [];
    const seen = new Set<FoodComposition>();
    let units = 0;
    for (const r of ranked) {
      if (r.confidence < min) break;
      if (seen.has(r.food)) continue;
      if (units >= limit) break;
      units++;
      const group = r.food.variantOf;
      const members =
        group === undefined ? [r.food] : foods.filter((f) => f.variantOf === group);
      const ordered = members
        .map((food) => ({ food, score: own.get(food)?.confidence ?? 0 }))
        .sort((a, b) => b.score - a.score);
      for (const { food } of ordered) {
        if (seen.has(food)) continue;
        seen.add(food);
        const m = own.get(food);
        const base = m ?? { food, confidence: 0, matchedOn: "name" as const, matchedText: food.name };
        out.push({
          food,
          confidence: base.confidence,
          ...(food.state !== undefined ? { state: food.state } : {}),
          ...(food.variantOf !== undefined ? { variantOf: food.variantOf } : {}),
          matchedOn: base.matchedOn,
          matchedText: base.matchedText,
          viaGroup: food !== r.food && base.confidence < min,
        });
      }
    }
    return out;
  }

  function find(query: string, findOptions: FindOptions = {}): MatchOutcome {
    const q = nameTokens(query, ignore);
    if (q.length === 0) return { status: "none" };
    const ranked = rankFoods(q);
    const top = ranked[0];
    if (!top || top.confidence < threshold) return { status: "none", ...(top ? { best: top } : {}) };
    const close = ranked.filter((r) => top.confidence - r.confidence <= margin + 1e-9);
    const runnerUp = ranked[1];

    const preferred = toList(findOptions.preferStates ?? options.preferStates);
    if (preferred.length === 0 || q.some((t) => STATE_STEMS.has(t))) {
      if (close.length > 1) return { status: "ambiguous", candidates: close };
      return { status: "match", match: top, ...(runnerUp ? { runnerUp } : {}) };
    }

    // La preferenza di stato vale solo tra voci dello stesso alimento in stati diversi
    // (`variantOf` uguale): se i migliori candidati sono alimenti diversi, o senza `variantOf`,
    // si resta con la regola normale.
    const group = top.food.variantOf;
    const sameGroup = group !== undefined && close.every((c) => c.food.variantOf === group);
    if (!sameGroup) {
      if (close.length > 1) return { status: "ambiguous", candidates: close };
      return { status: "match", match: top, ...(runnerUp ? { runnerUp } : {}) };
    }

    // Le voci del gruppo che corrispondono al nome, qualunque ne sia lo stato.
    const members = ranked.filter((r) => r.food.variantOf === group && r.confidence >= threshold);
    const rank = (f: FoodComposition): number => {
      const i = f.state === undefined ? -1 : preferred.indexOf(f.state);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    };
    const best = Math.min(...members.map((m) => rank(m.food)));

    if (Number.isFinite(best)) {
      const winners = members.filter((m) => rank(m.food) === best);
      if (winners.length > 1) return { status: "ambiguous", candidates: winners };
      const [winner] = winners;
      return {
        status: "match",
        match: {
          ...winner,
          statePreference: { preferred, honored: true },
          ...(winner.food !== top.food ? { stateSwitchedFrom: top.food } : {}),
        },
        runnerUp: winner === top ? runnerUp : top,
      };
    }

    // Nessuna voce del gruppo ha uno stato preferito. Un alimento secco da cuocere non si usa al
    // posto del cotto (la pasta secca pesa meno di metà della cotta): meglio nessun dato.
    if (preferred.includes("cooked") && members.some((m) => m.food.state === "dried")) {
      return { status: "state_unavailable", reason: "missing_cooked_entry", candidates: members };
    }
    // Con più voci a pari merito e nessuna preferenza applicabile non si sceglie a caso.
    if (close.length > 1) return { status: "ambiguous", candidates: close };
    // Altrimenti si usa ciò che c'è (per esempio carne cruda in un pasto), dichiarando che lo stato
    // preferito non c'era.
    return {
      status: "match",
      match: { ...top, statePreference: { preferred, honored: false } },
      ...(runnerUp ? { runnerUp } : {}),
    };
  }

  return {
    find,
    search,
    match(query, findOptions) {
      const out = find(query, findOptions);
      return out.status === "match" ? out.match : undefined;
    },
  };
}

/** Corrispondenza migliore per un nome scritto dall'utente, o `undefined`. */
export function matchFood(
  query: string,
  foods: readonly FoodComposition[],
  options: MatchOptions = {},
): FoodMatch | undefined {
  return createFoodMatcher(foods, options).match(query);
}

/**
 * Ricerca pensata per l'interfaccia: dato il testo scritto dall'utente, i candidati ordinati
 * (alimento, punteggio, stato, gruppo `variantOf`), anche se ambigui, perché l'utente scelga.
 * Le voci dello stesso gruppo `variantOf` compaiono tutte e vicine. Per molte ricerche conviene
 * `createFoodMatcher(...).search`.
 */
export function searchFoods(
  query: string,
  foods: readonly FoodComposition[],
  options: MatchOptions & SearchOptions = {},
): FoodCandidate[] {
  return createFoodMatcher(foods, options).search(query, options);
}
