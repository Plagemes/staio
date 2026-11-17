// Raggruppamento dei lotti uguali in Dispensa: solo presentazione, nel registro ogni confezione resta un lotto.
import { formatQuantity } from "@/core/units";
import { formatCalendarDate } from "../format";
import type { PantryEntry } from "../lots";

export interface LotGroup {
  key: string;
  /** Nell'ordine in cui arrivano: la prima è quella che scade prima. */
  entries: PantryEntry[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** Una confezione intatta e chiusa: solo queste si raggruppano. */
function groupKeyOf(entry: PantryEntry): string | null {
  const { lot } = entry;
  if (lot.openedAt !== undefined || lot.remaining !== lot.initial || lot.remaining <= 0) return null;
  const product = lot.barcode ? `c:${lot.barcode}` : `n:${nameKey(lot.productRef)}`;
  return `${product}|${lot.location}|${lot.unit}|${lot.initial}`;
}

/**
 * Unisce i lotti uguali (stesso prodotto o codice, luogo e quantità, chiusi e interi) in un gruppo; gli altri restano soli.
 * L'ordine è quello di arrivo: un gruppo sta dove sta la sua confezione che scade prima.
 */
export function groupEntries(entries: readonly PantryEntry[]): LotGroup[] {
  const groups: LotGroup[] = [];
  const byKey = new Map<string, LotGroup>();
  for (const entry of entries) {
    const key = groupKeyOf(entry);
    if (key === null) {
      groups.push({ key: `lot:${entry.lot.lotId}`, entries: [entry] });
      continue;
    }
    const found = byKey.get(key);
    if (found) found.entries.push(entry);
    else {
      const group: LotGroup = { key, entries: [entry] };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

/** La data che conta per un lotto: quella effettiva (in etichetta o stimata). */
export const entryDate = (entry: PantryEntry): string | undefined => entry.expiry?.date ?? entry.lot.expiry?.date;

export interface ExpiryCount {
  date: string | undefined;
  count: number;
}

/** Quante confezioni per scadenza, dalla più vicina; quelle senza data in fondo. */
export function expiryBreakdown(group: LotGroup): ExpiryCount[] {
  const counts = new Map<string | undefined, number>();
  for (const e of group.entries) counts.set(entryDate(e), (counts.get(entryDate(e)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date === undefined ? 1 : b.date === undefined ? -1 : a.date.localeCompare(b.date)));
}

/** «2 entro il 20 nov 2026 · 3 entro il 28 nov 2026»; vuoto se la data è una sola. */
export function breakdownText(group: LotGroup): string {
  const parts = expiryBreakdown(group);
  if (parts.length < 2) return "";
  return parts.map((p) => `${p.count} ${p.date ? `entro il ${formatCalendarDate(p.date)}` : "senza data"}`).join(" · ");
}

/** Nome della riga: «Budino · 5 × 125 g» per un gruppo, il nome com'è per un lotto solo. */
export function groupName(group: LotGroup): string {
  const first = group.entries[0].lot;
  if (group.entries.length < 2) return first.productRef;
  return `${first.productRef} · ${group.entries.length} × ${formatQuantity({ value: first.initial, unit: first.unit })}`;
}

/** Confezioni di un gruppo da consumare prima: ordinate per scadenza, quelle senza data dopo. */
export function byNearestExpiry(entries: readonly PantryEntry[]): PantryEntry[] {
  return [...entries].sort((a, b) => {
    const da = entryDate(a);
    const db = entryDate(b);
    if (da === db) return 0;
    if (da === undefined) return 1;
    if (db === undefined) return -1;
    return da.localeCompare(db);
  });
}
