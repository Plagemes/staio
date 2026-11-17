// Storico dei prodotti letti in una sessione dello scaffale: solo in memoria, si perde alla chiusura
// della pagina. Logica pura: ogni funzione dà un nuovo elenco, il più recente in cima.

import type { Product } from "@/core/catalog";
import type { LookupFailure } from "../barcode/offClient";
import { COMPARE_MAX } from "./compare";

export type ShelfEntry =
  | { code: string; status: "loading" }
  | { code: string; status: "found"; product: Product; from: "memory" | "service" }
  | { code: string; status: "not_found" }
  | { code: string; status: "failed"; reason: LookupFailure };

export function startEntry(entries: readonly ShelfEntry[], code: string): ShelfEntry[] {
  return [{ code, status: "loading" }, ...entries.filter((e) => e.code !== code)];
}

export function resolveEntry(entries: readonly ShelfEntry[], resolved: ShelfEntry): ShelfEntry[] {
  return entries.map((e) => (e.code === resolved.code ? resolved : e));
}

/** Un codice già in storico non si cerca di nuovo: sale in cima. */
export function bringToTop(entries: readonly ShelfEntry[], code: string): ShelfEntry[] {
  const hit = entries.find((e) => e.code === code);
  return hit ? [hit, ...entries.filter((e) => e.code !== code)] : [...entries];
}

export function removeEntry(entries: readonly ShelfEntry[], code: string): ShelfEntry[] {
  return entries.filter((e) => e.code !== code);
}

/** Aggiunge o toglie dal confronto; al massimo `COMPARE_MAX` prodotti, gli altri restano fuori. */
export function toggleSelected(selected: readonly string[], code: string): string[] {
  if (selected.includes(code)) return selected.filter((c) => c !== code);
  return selected.length >= COMPARE_MAX ? [...selected] : [...selected, code];
}

/** Prodotti trovati scelti per il confronto, nell'ordine dello storico. */
export function selectedProducts(entries: readonly ShelfEntry[], selected: readonly string[]): Product[] {
  return entries.flatMap((e) => (e.status === "found" && selected.includes(e.code) ? [e.product] : []));
}
