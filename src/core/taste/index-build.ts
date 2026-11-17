// Indice dei dati: ricerca per identificativo e per nome, vicini simmetrici.
import { foldText } from "../allergens";
import { nameTokens } from "../nutrition";
import type { TasteData, TasteFood, TasteSubject } from "./types";

export interface TasteLink {
  score: number;
  rank: number;
}

export interface TasteIndex {
  data: TasteData;
  byKey: ReadonlyMap<string, TasteFood>;
  /** Punteggio e valore d'ordine da una chiave a un'altra, nei due sensi. */
  links: ReadonlyMap<string, ReadonlyMap<string, TasteLink>>;
  /** Voci scartate perché mal formate o ambigue: per i test e la diagnosi, mai per l'utente. */
  problems: string[];
}

/**
 * Prepara i dati. I vicini sono letti nei due sensi con il valore d'ordine più alto: se B è tra i vicini di A, A è tra i
 * vicini di B. Un nome o un alias che porterebbe a due alimenti diversi non vale per nessuno dei due.
 */
export function createTasteIndex(data: TasteData): TasteIndex {
  const problems: string[] = [];
  const byKey = new Map<string, TasteFood>();
  for (const food of data.foods) {
    if (byKey.has(food.key)) problems.push(`chiave doppia: ${food.key}`);
    else byKey.set(food.key, food);
  }
  const links = new Map<string, Map<string, TasteLink>>();
  const link = (a: string, b: string, score: number, rank: number) => {
    let m = links.get(a);
    if (!m) links.set(a, (m = new Map()));
    const prev = m.get(b);
    if (!prev || rank > prev.rank || (rank === prev.rank && score > prev.score)) m.set(b, { score, rank });
  };
  for (const [from, list] of Object.entries(data.neighbors)) {
    if (!byKey.has(from)) {
      problems.push(`vicini di una chiave sconosciuta: ${from}`);
      continue;
    }
    for (const [to, score, order] of list) {
      const rank = order ?? score;
      if (!byKey.has(to) || to === from || !Number.isFinite(score) || score <= 0 || score > 1 || !Number.isFinite(rank)) {
        problems.push(`vicino non valido: ${from} -> ${to}`);
        continue;
      }
      link(from, to, score, rank);
      link(to, from, score, rank);
    }
  }
  return { data, byKey, links, problems };
}

const caches = new WeakMap<TasteIndex, { byFoodId: Map<string, string>; byName: Map<string, string | null> }>();

function lookups(index: TasteIndex) {
  let c = caches.get(index);
  if (c) return c;
  const byFoodId = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const food of index.data.foods) {
    for (const id of food.foodIds) if (!byFoodId.has(id)) byFoodId.set(id, food.key);
    for (const text of [food.name, ...(food.aliases ?? [])]) {
      const k = nameTokens(text).join(" ");
      if (k === "") continue;
      const prev = byName.get(k);
      byName.set(k, prev === undefined || prev === food.key ? food.key : null);
    }
  }
  c = { byFoodId, byName };
  caches.set(index, c);
  return c;
}

/**
 * L'alimento dell'elenco a cui corrisponde un ingrediente, o `undefined`. Prima l'identificativo della tabella
 * nutrizionale, poi il nome a parole uguali (singolare e plurale coincidono). Nessuna somiglianza approssimata:
 * «passata di pomodoro» senza identificativo non è «pomodoro».
 */
export function resolveTasteFood(index: TasteIndex, subject: TasteSubject): TasteFood | undefined {
  const { byFoodId, byName } = lookups(index);
  if (subject.foodId) {
    const key = byFoodId.get(subject.foodId);
    if (key) return index.byKey.get(key);
  }
  for (const text of [subject.name, ...(subject.aliases ?? [])]) {
    const key = byName.get(nameTokens(text).join(" "));
    if (key) return index.byKey.get(key);
  }
  return undefined;
}

/** Alimenti dell'elenco il cui nome (o un alias) comincia con le parole scritte. Vuoto se il testo è vuoto. */
export function searchTasteFoods(index: TasteIndex, query: string, limit = 8): TasteFood[] {
  const words = foldText(query).split(" ").filter((w) => w !== "");
  if (words.length === 0) return [];
  const scored: { food: TasteFood; rank: number }[] = [];
  for (const food of index.data.foods) {
    const texts = [food.name, ...(food.aliases ?? [])].map(foldText);
    let best = Infinity;
    for (const t of texts) {
      const tw = t.split(" ");
      if (!words.every((w) => tw.some((x) => x.startsWith(w)))) continue;
      best = Math.min(best, t === words.join(" ") ? 0 : tw[0]?.startsWith(words[0] as string) ? 1 : 2);
    }
    if (best < Infinity) scored.push({ food, rank: best });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.food.name.localeCompare(b.food.name, "it"))
    .slice(0, limit)
    .map((s) => s.food);
}
