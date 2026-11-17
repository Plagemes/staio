// Scelte dell'utente sulla lista: ogni funzione restituisce un nuovo valore da salvare. Logica pura.
import { addDays } from "@/core/diary";
import type { ListItem, RejectionMemory } from "@/core/shopping";
import { rejectItem } from "@/core/shopping";
import { DISMISS_DAYS, type Decisions } from "./settings";
import type { ManualItem } from "./manual";

export function confirm(d: Decisions, id: string, quantity: number): Decisions {
  return { ...d, confirmed: { ...d.confirmed, [id]: true }, quantities: { ...d.quantities, [id]: quantity } };
}

export function confirmAll(d: Decisions, items: ReadonlyArray<{ id: string; quantity: number }>): Decisions {
  let next = d;
  for (const i of items) next = confirm(next, i.id, i.quantity);
  return next;
}

export function setQuantity(d: Decisions, id: string, quantity: number): Decisions {
  return { ...d, quantities: { ...d.quantities, [id]: quantity } };
}

/** Toglie la conferma e la quantità scelta: la voce torna a essere una proposta. */
export function unconfirm(d: Decisions, id: string): Decisions {
  const confirmed = { ...d.confirmed };
  delete confirmed[id];
  const quantities = { ...d.quantities };
  delete quantities[id];
  return { ...d, confirmed, quantities };
}

export function dismiss(d: Decisions, id: string, today: string): Decisions {
  const unconfirmed = unconfirm(d, id);
  return { ...unconfirmed, dismissed: { ...unconfirmed.dismissed, [id]: today } };
}

export function restore(d: Decisions, id: string): Decisions {
  const dismissed = { ...d.dismissed };
  delete dismissed[id];
  return { ...d, dismissed };
}

export const isDismissed = (d: Decisions, id: string, today: string): boolean => {
  const on = d.dismissed[id];
  return on !== undefined && addDays(on, DISMISS_DAYS) > today;
};

/** Toglie le scelte di voci che non esistono più: confermate e rifiuti scaduti. */
export function prune(d: Decisions, liveIds: ReadonlySet<string>, today: string): Decisions {
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => liveIds.has(id)));
  return {
    confirmed: keep(d.confirmed) as Decisions["confirmed"],
    quantities: keep(d.quantities),
    dismissed: Object.fromEntries(Object.entries(d.dismissed).filter(([, on]) => addDays(on, DISMISS_DAYS) > today)),
  };
}

/** Il rifiuto di una voce: lo ricorda (per ragione) e la toglie dalla lista per qualche giorno. */
export function reject(
  decisions: Decisions,
  memory: RejectionMemory,
  item: Pick<ListItem, "id" | "key" | "unit" | "reasons">,
  today: string,
): { decisions: Decisions; memory: RejectionMemory } {
  return { decisions: dismiss(decisions, item.id, today), memory: rejectItem(memory, item, today) };
}

/** Dimentica i rifiuti di una voce: la proposta torna con la sua forza. */
export function forgetRejections(memory: RejectionMemory, id: string): RejectionMemory {
  return { entries: memory.entries.filter((e) => e.id !== id) };
}

/** Le aggiunte a mano che corrispondono a una voce della lista (stesso prodotto e unità). */
export function manualIdsOf(manual: readonly ManualItem[], itemId: string, keyOf: (name: string) => string): string[] {
  return manual.filter((m) => m.quantity !== undefined && `${keyOf(m.product)}|${m.quantity.unit}` === itemId).map((m) => m.id);
}
