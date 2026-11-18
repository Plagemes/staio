// La ricerca del foglio «Aggiungi»: sul telefono, senza rete e senza intelligenza artificiale. Solo funzioni pure:
// i dati li passa chi la usa, già letti e già controllati (le ricette sono quelle che il ricettario mostra).
import { formatQuantity } from "@/core/units";
import { LOCATION_LABELS } from "../labels";
import { expiryTagView, type PantryEntry } from "../lots";
import { normalizeSearch } from "../pantry/filter";
import { groupEntries } from "../pantry/groups";

export interface SearchSources {
  /** Gli alimenti in casa, già valutati, nell'ordine «da mangiare prima». */
  pantry: readonly { lotId: string; name: string; detail: string }[];
  /**
   * Le ricette che il ricettario mostrerebbe, già passate dal suo controllo di allergeni ed esclusioni.
   * `note`: l'avviso che la ricetta porta nel ricettario, con le stesse parole.
   */
  recipes: readonly { id: string; title: string; href: string; note?: string }[];
  /** La riga che il ricettario mette sopra il suo elenco quando ci sono allergeni o esclusioni dichiarati. */
  recipesNote?: string;
  habits: readonly { habitId: string; title: string }[];
  pages: readonly { label: string; href: string; keywords: readonly string[] }[];
}

export interface SearchResult {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  action?: "addToShopping" | "addToPantry";
}

export type SearchAction = NonNullable<SearchResult["action"]>;

export interface SearchGroup {
  title: "In casa" | "Azioni" | "Ricette" | "Pasti abituali" | "Pagine";
  results: SearchResult[];
  /** Una riga sopra le righe del gruppo (o da sola, se il gruppo non ha righe). */
  note?: string;
  /** Una riga sotto le righe: dice che ce ne sono altre. */
  footnote?: string;
}

export const MIN_QUERY_LETTERS = 2;
export const MAX_PER_GROUP = 5;

const PANTRY_HREF = "/app/dispensa";
const CAPTURE_HREF = "/app/cattura";
const HABITS_HREF = "/app/pasti-abituali";

/** Il testo scritto, come va mostrato tra virgolette e passato alle azioni: senza spazi ai lati né doppi. */
export function queryText(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

/** Le parole da cercare; nessuna se le lettere scritte sono meno di due. */
function wordsOf(query: string): string[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  return words.join("").length < MIN_QUERY_LETTERS ? [] : words;
}

/** Con meno di due lettere la ricerca non parte: resta l'elenco delle azioni. */
export function isSearching(query: string): boolean {
  return wordsOf(query).length > 0;
}

const partsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Quanto un nome risponde alle parole scritte: `null` se non le contiene tutte (in qualunque ordine); altrimenti 0 se
 * comincia con la prima, 1 se ogni parola è l'inizio di una parola del nome, 2 se sta solo in mezzo («lat» in «cioccolato»).
 */
function nameRank(name: string, words: readonly string[]): number | null {
  const text = normalizeSearch(name);
  if (!words.every((word) => text.includes(word))) return null;
  if (text.startsWith(words[0])) return 0;
  const parts = partsOf(text);
  return words.every((word) => parts.some((part) => part.startsWith(word))) ? 1 : 2;
}

/** I nomi che rispondono, i più vicini a ciò che è scritto per primi; a parità resta l'ordine di partenza. */
function matchByName<T>(items: readonly T[], nameOf: (item: T) => string, words: readonly string[]): T[] {
  const hits: { item: T; rank: number; at: number }[] = [];
  items.forEach((item, at) => {
    const rank = nameRank(nameOf(item), words);
    if (rank !== null) hits.push({ item, rank, at });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.at - b.at).map((hit) => hit.item);
}

/** Le parole corte del nome di una pagina («dei», «le») non contano: con due lettere risponderebbero a tutto. */
const PAGE_WORD_MIN = 4;

/** Una pagina risponde se ogni parola scritta è l'inizio di una parola del suo nome o delle sue parole chiave. */
function pageMatches(page: SearchSources["pages"][number], words: readonly string[]): boolean {
  const parts = [page.label, ...page.keywords].flatMap((text) => partsOf(normalizeSearch(text))).filter((part) => part.length >= PAGE_WORD_MIN);
  return words.every((word) => parts.some((part) => part.startsWith(word)));
}

const NOT_IN_HOME = "Non ne hai in casa.";

/**
 * I risultati per ciò che è scritto, in gruppi: In casa, Azioni, Ricette, Pasti abituali, Pagine; al massimo cinque righe
 * per gruppo. Un gruppo vuoto non compare, tranne «In casa», che dice «Non ne hai in casa.»: è la risposta a «ce l'ho?».
 * Se ciò che è scritto trova soltanto pagine («tema») si stava cercando una pagina: le pagine vengono per prime, e sotto
 * restano le due azioni, con «Non ne hai in casa.» in una riga sola.
 */
export function search(query: string, sources: SearchSources): SearchGroup[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const text = queryText(query);
  const groups: SearchGroup[] = [];

  const inHome = matchByName(sources.pantry, (item) => item.name, words);
  const recipes = matchByName(sources.recipes, (recipe) => recipe.title, words).slice(0, MAX_PER_GROUP);
  const habits = matchByName(sources.habits, (habit) => habit.title, words).slice(0, MAX_PER_GROUP);
  const pages = sources.pages.filter((page) => pageMatches(page, words)).slice(0, MAX_PER_GROUP);

  const pagesGroup: SearchGroup = {
    title: "Pagine",
    results: pages.map((page) => ({ id: `page:${page.href}`, label: page.label, href: page.href })),
  };
  const actionsGroup: SearchGroup = {
    title: "Azioni",
    results: [
      { id: "action:shopping", label: `Aggiungi “${text}” alla spesa`, action: "addToShopping" },
      { id: "action:pantry", label: `Aggiungi “${text}” alla dispensa`, action: "addToPantry", href: `${CAPTURE_HREF}?nome=${encodeURIComponent(text)}` },
    ],
  };

  const onlyPages = pages.length > 0 && inHome.length === 0 && recipes.length === 0 && habits.length === 0;
  if (onlyPages) return [pagesGroup, { ...actionsGroup, note: NOT_IN_HOME }];

  const hiddenInHome = inHome.length - MAX_PER_GROUP;
  groups.push({
    title: "In casa",
    results: inHome.slice(0, MAX_PER_GROUP).map((item) => ({
      id: `lot:${item.lotId}`,
      label: item.name,
      detail: item.detail,
      href: `${PANTRY_HREF}?lotto=${encodeURIComponent(item.lotId)}`,
    })),
    ...(inHome.length === 0 ? { note: NOT_IN_HOME } : {}),
    ...(hiddenInHome > 0
      ? { footnote: hiddenInHome === 1 ? "Ce n'è un altro: cercalo in Dispensa." : `Ce ne sono altri ${hiddenInHome}: cercali in Dispensa.` }
      : {}),
  });

  groups.push(actionsGroup);

  if (recipes.length > 0) {
    groups.push({
      title: "Ricette",
      results: recipes.map((recipe) => ({
        id: `recipe:${recipe.id}`,
        label: recipe.title,
        ...(recipe.note ? { detail: recipe.note } : {}),
        href: recipe.href,
      })),
      ...(sources.recipesNote ? { note: sources.recipesNote } : {}),
    });
  }

  if (habits.length > 0) {
    groups.push({
      title: "Pasti abituali",
      results: habits.map((habit) => ({ id: `habit:${habit.habitId}`, label: habit.title, href: HABITS_HREF })),
    });
  }

  if (pages.length > 0) groups.push(pagesGroup);

  return groups;
}

/**
 * Gli alimenti in casa come li vuole la ricerca: una riga per alimento (le confezioni uguali insieme, come in Dispensa),
 * con quantità, luogo e scadenza; il tocco apre la confezione che scade prima. La tilde segna ciò che è una stima.
 */
export function pantrySources(entries: readonly PantryEntry[]): SearchSources["pantry"] {
  return groupEntries(entries).map((group) => {
    const entry = group.entries[0];
    const { lot } = entry;
    const amount = formatQuantity({ value: lot.remaining, unit: lot.unit });
    const quantity = group.entries.length > 1 ? `${group.entries.length} × ${amount}` : `${lot.remainingCertainty === "estimated" ? "~" : ""}${amount}`;
    const tag = expiryTagView(entry);
    const expiry = tag ? `${tag.estimated ? "~" : ""}${tag.text}` : "senza data";
    return { lotId: lot.lotId, name: lot.productRef, detail: [quantity, LOCATION_LABELS[lot.location], expiry].join(" · ") };
  });
}
