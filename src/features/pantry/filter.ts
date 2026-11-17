// Ricerca e divisione dell'elenco della Dispensa: solo funzioni pure.
import { isExpiring, type PantryEntry } from "../lots";
import type { LotGroup } from "./groups";

/** Minuscolo, senza accenti, spazi ridotti a uno e senza spazi ai lati. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Le voci il cui nome contiene tutte le parole scritte, in qualunque ordine. Testo vuoto: passano tutte, nello stesso ordine. */
export function filterEntries(entries: readonly PantryEntry[], query: string): PantryEntry[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const name = normalizeSearch(entry.lot.productRef);
    return words.every((word) => name.includes(word));
  });
}

export interface ExpirySplit {
  expiring: LotGroup[];
  rest: LotGroup[];
}

/** Una riga sta tra quelle «in scadenza» se lo è la sua confezione più vicina (la prima del gruppo); l'ordine non cambia. */
export function splitByExpiry(groups: readonly LotGroup[]): ExpirySplit {
  const expiring: LotGroup[] = [];
  const rest: LotGroup[] = [];
  for (const group of groups) (isExpiring(group.entries[0]) ? expiring : rest).push(group);
  return { expiring, rest };
}
