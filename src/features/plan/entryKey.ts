// Come si ritrova una voce del piano quando la settimana viene riletta dall'archivio. L'indice non va bene: un altro
// telefono può aver aggiunto o tolto voci e gli indici scorrono. La chiave dice che cosa è la voce (giorno, pasto, tipo,
// riferimento o nome piegato, quantità o porzioni, nota). Due voci identiche nello stesso pasto hanno la stessa chiave:
// si distinguono per l'ordine tra le uguali (la prima, la seconda…), che è quello in cui la settimana le elenca.
import type { PlannedEntry } from "@/core/plan";

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export function entryKey(entry: PlannedEntry): string {
  const item = entry.item;
  const what =
    item.kind === "food"
      ? ["food", fold(item.name), item.quantity.value, item.quantity.unit]
      : item.kind === "recipe"
        ? ["recipe", item.recipeId, item.servings]
        : ["prep", item.prepId, item.servings];
  return JSON.stringify([entry.date, entry.meal, ...what, fold(entry.note ?? "")]);
}

export interface EntryRef {
  key: string;
  /** Quante voci con la stessa chiave la precedono nell'elenco. */
  nth: number;
}

/** I riferimenti di tutte le voci di un elenco, nello stesso ordine. */
export function entryRefs(entries: readonly PlannedEntry[]): EntryRef[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const key = entryKey(entry);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return { key, nth };
  });
}

/** Dove sta la voce nell'elenco riletto, oppure -1 se non c'è più. */
export function findEntry(entries: readonly PlannedEntry[], ref: EntryRef): number {
  let seen = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entryKey(entries[i]) !== ref.key) continue;
    if (seen === ref.nth) return i;
    seen++;
  }
  return -1;
}

/** L'ultima voce con quella chiave (per «Togli» di ciò che si è appena aggiunto). */
export function findLastEntry(entries: readonly PlannedEntry[], key: string): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entryKey(entries[i]) === key) return i;
  return -1;
}
