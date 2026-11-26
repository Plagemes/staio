// Ricerca, ordine, etichette e tempo del ricettario stanno nell'indirizzo: tornando dalla scheda si ritrovano.
// `?q=pasta&ordina=scade&etichette=veloce,forno&tempo=30`. Funzioni pure: l'indirizzo è la sola fonte.
import { SORT_LABELS, type SortKey } from "./list";

export const TIME_OPTIONS = [20, 30, 45, 60] as const;

export interface RecipesQuery {
  q: string;
  sort: SortKey;
  tags: string[];
  maxMinutes?: number;
}

const SORT_PARAM: Record<SortKey, string> = { title: "nome", pantry: "casa", expiring: "scade", favorites: "preferite" };
const SORT_OF_PARAM = new Map<string, SortKey>(Object.entries(SORT_PARAM).map(([key, param]) => [param, key as SortKey]));

export const DEFAULT_RECIPES_QUERY: RecipesQuery = { q: "", sort: "title", tags: [] };

/** Legge l'indirizzo (con o senza `?`). Un valore che non si capisce vale come se non ci fosse. */
export function parseRecipesQuery(search: string | URLSearchParams): RecipesQuery {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const sort = SORT_OF_PARAM.get(params.get("ordina") ?? "") ?? DEFAULT_RECIPES_QUERY.sort;
  const tags = [...new Set((params.get("etichette") ?? "").split(",").map((t) => t.trim()).filter((t) => t !== ""))];
  const time = Number(params.get("tempo"));
  const maxMinutes = (TIME_OPTIONS as readonly number[]).includes(time) ? time : undefined;
  return { q: params.get("q") ?? "", sort, tags, ...(maxMinutes !== undefined ? { maxMinutes } : {}) };
}

/** L'indirizzo per uno stato: solo ciò che non è il valore di partenza. Vuoto se non c'è niente. Comincia con `?`. */
export function recipesQueryString(state: RecipesQuery): string {
  const params = new URLSearchParams();
  if (state.q.trim() !== "") params.set("q", state.q);
  if (state.sort !== DEFAULT_RECIPES_QUERY.sort) params.set("ordina", SORT_PARAM[state.sort]);
  if (state.tags.length > 0) params.set("etichette", state.tags.join(","));
  if (state.maxMinutes !== undefined) params.set("tempo", String(state.maxMinutes));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** Il riassunto della riga «Ordina e filtra»: «Per usare ciò che scade · fino a 30 minuti», o «Nome» se niente è scelto. */
export function sortFilterSummary(state: RecipesQuery): string {
  const parts: string[] = [SORT_LABELS[state.sort]];
  if (state.maxMinutes !== undefined) parts.push(`fino a ${state.maxMinutes} minuti`);
  if (state.tags.length > 0) parts.push(state.tags.join(", "));
  return parts.join(" · ");
}
