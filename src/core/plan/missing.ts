// «Che cosa manca» per un insieme di voci del piano: ciò che servono, meno ciò che c'è in dispensa. Un solo calcolo,
// per chi lo mostra (Piano, Oggi). Nessuna conversione di unità: «pasta, 80 g» si confronta con la pasta in grammi, non
// con quella in pezzi. Non scala la dispensa: dice soltanto che cosa manca.

import type { Quantity } from "../ledger";
import { roundQty, type ExpandRef } from "./refs";
import type { PlannedEntry, PlannedItem } from "./types";

export type QuantityUnit = Quantity["unit"];

export interface StockLine {
  name: string;
  unit: QuantityUnit;
  quantity: number;
}

export interface MissingOptions {
  /** Come si espande una ricetta o una preparazione negli ingredienti (lo stesso di `computeNeeds`). */
  expand: ExpandRef;
  /** Ciò che c'è in dispensa, per nome e unità. */
  stock: readonly StockLine[];
  /** Porzioni già pronte di una preparazione: coprono le voci che la chiedono. */
  portionsLeft?: (prepId: string) => number;
  /** Il nome di una voce, per dire «per che cosa» serve un ingrediente. Senza, vale il nome dell'alimento o l'identificativo. */
  nameOf?: (item: PlannedItem) => string;
}

export interface MissingLine {
  /** Nome piegato e unità: stabile, adatto come chiave di una riga. */
  key: string;
  name: string;
  foodId?: string;
  unit: QuantityUnit;
  needed: number;
  have: number;
  missing: number;
  /** I nomi delle voci del piano che lo chiedono. */
  for: string[];
}

export interface MissingResult {
  /** Gli ingredienti che mancano (del tutto o in parte), per nome. */
  lines: MissingLine[];
  /** Quelli che la dispensa copre: servono per dire «hai già: …». */
  covered: MissingLine[];
  /** Voci che non si sanno espandere (ricetta o preparazione sparita): i loro ingredienti non sono nel conto. */
  unresolved: PlannedEntry[];
}

const EPS = 1e-9;

export const foldName = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const byName = (a: MissingLine, b: MissingLine): number => a.name.localeCompare(b.name, "it") || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0);

const defaultName = (item: PlannedItem): string => (item.kind === "food" ? item.name : item.kind === "recipe" ? item.recipeId : item.prepId);

export function missingFor(entries: readonly PlannedEntry[], options: MissingOptions): MissingResult {
  const nameOf = options.nameOf ?? defaultName;
  const needs = new Map<string, MissingLine>();
  const unresolved: PlannedEntry[] = [];

  const add = (ing: { name: string; foodId?: string; quantity: Quantity }, forNames: readonly string[]): void => {
    if (!(ing.quantity.value > 0)) return;
    const folded = foldName(ing.name);
    if (folded === "") return;
    const unit = ing.quantity.unit;
    const key = `${folded}\u0000${unit}`;
    const cur = needs.get(key);
    if (cur) {
      cur.needed = roundQty(cur.needed + ing.quantity.value);
      for (const n of forNames) if (!cur.for.includes(n)) cur.for.push(n);
      if (cur.foodId === undefined && ing.foodId) cur.foodId = ing.foodId;
    } else {
      needs.set(key, {
        key,
        name: ing.name.trim(),
        ...(ing.foodId ? { foodId: ing.foodId } : {}),
        unit,
        needed: roundQty(ing.quantity.value),
        have: 0,
        missing: 0,
        for: [...forNames],
      });
    }
  };

  // le preparazioni si sommano per preparazione: due voci da una porzione con una sola porzione pronta chiedono gli ingredienti di una
  const preps = new Map<string, { servings: number; entries: PlannedEntry[] }>();

  for (const entry of entries) {
    const item = entry.item;
    if (item.kind === "food") {
      add({ name: item.name, ...(item.foodId ? { foodId: item.foodId } : {}), quantity: item.quantity }, [nameOf(item)]);
    } else if (item.kind === "recipe") {
      const ingredients = options.expand({ kind: "recipe", id: item.recipeId }, item.servings);
      if (!ingredients) {
        unresolved.push(entry);
        continue;
      }
      const forNames = [nameOf(item)];
      for (const ing of ingredients) add(ing, forNames);
    } else {
      const cur = preps.get(item.prepId) ?? { servings: 0, entries: [] };
      cur.servings = roundQty(cur.servings + item.servings);
      cur.entries.push(entry);
      preps.set(item.prepId, cur);
    }
  }

  for (const [prepId, group] of preps) {
    const ready = Math.max(0, options.portionsLeft?.(prepId) ?? 0);
    const rest = roundQty(group.servings - ready);
    if (rest <= EPS) continue;
    const ingredients = options.expand({ kind: "prep", id: prepId }, rest);
    if (!ingredients) {
      unresolved.push(...group.entries);
      continue;
    }
    const forNames = [...new Set(group.entries.map((e) => nameOf(e.item)))];
    for (const ing of ingredients) add(ing, forNames);
  }

  const stock = new Map<string, number>();
  for (const s of options.stock) {
    const key = `${foldName(s.name)}\u0000${s.unit}`;
    stock.set(key, roundQty((stock.get(key) ?? 0) + s.quantity));
  }

  const lines: MissingLine[] = [];
  const covered: MissingLine[] = [];
  for (const need of needs.values()) {
    need.have = stock.get(need.key) ?? 0;
    need.missing = Math.max(0, roundQty(need.needed - need.have));
    (need.missing > EPS ? lines : covered).push(need);
  }
  return { lines: lines.sort(byName), covered: covered.sort(byName), unresolved };
}
