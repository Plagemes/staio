// Registro di oggi: gli eventi del giorno, in ordine di orario, già in parole.
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { sortEvents, type LotPatch, type PantryState } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import type { AnyEvent } from "@/core/events";
import { ledgerEventsOf } from "./events";
import { dayOf, formatTime } from "./format";
import { DISCARD_REASON_LABELS, LOCATION_LABELS } from "./labels";

export interface JournalRow {
  id: string;
  /** "08:10" */
  time: string;
  description: string;
  value: string;
  /** La quantità è una stima: il valore si mostra con tilde e puntini. */
  estimated: boolean;
  /** L'evento si può annullare da qui. */
  canUndo: boolean;
  /** Perché non si può annullare, se è così. */
  undoBlocked?: string;
}

const PATCH_LABELS: Record<keyof LotPatch, string> = {
  expiry: "scadenza",
  productRef: "nome",
  category: "categoria",
  priceCents: "prezzo",
  store: "negozio",
};

/**
 * Eventi del giorno `today` (giorno di calendario di Roma). Restano fuori gli eventi annullati
 * e gli annullamenti stessi: il registro racconta ciò che è successo davvero.
 */
export function buildJournal(
  events: readonly AnyEvent[],
  pantry: PantryState,
  today: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): JournalRow[] {
  const voided = new Set(pantry.voidedEventIds);
  const names = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const lots = new Map(pantry.lots.map((l) => [l.lotId, l]));
  const rows: JournalRow[] = [];

  for (const e of sortEvents(ledgerEventsOf(events))) {
    if (e.type === "void" || voided.has(e.id)) continue;
    if (dayOf(e.at, timeZone) !== today) continue;
    const name = ("lotId" in e ? names.get(e.lotId) : undefined) ?? (e.type === "purchase" || e.type === "declare" ? e.productRef : "alimento");
    // annullare l'ingresso di un alimento lascerebbe senza lotto i movimenti che lo seguono
    const isCreation = e.type === "purchase" || e.type === "declare";
    const blocked =
      e.type === "consume" && e.mealId
        ? "Fa parte di un pasto: annulla il pasto da «Pasti di oggi», così tornano a posto anche gli altri alimenti."
        : isCreation && (lots.get(e.lotId)?.history.length ?? 0) > 1
          ? "Questo alimento ha già altri movimenti: annullali prima, poi potrai annullare l'ingresso."
          : undefined;
    const row = (title: string, value: string, estimated = false): JournalRow => ({
      id: e.id,
      time: formatTime(e.at, timeZone),
      description: `${title} · ${name}`,
      value,
      estimated,
      canUndo: blocked === undefined,
      ...(blocked ? { undoBlocked: blocked } : {}),
    });
    switch (e.type) {
      case "purchase":
      case "declare":
        rows.push(row("Entra", formatQuantity(e.quantity), e.certainty === "estimated"));
        break;
      case "consume":
        rows.push(row("Mangiato", formatQuantity(e.quantity), e.certainty === "estimated"));
        break;
      case "discard":
        rows.push(
          row(`Buttato, ${DISCARD_REASON_LABELS[e.reason].toLowerCase()}`, formatQuantity(e.quantity), e.certainty === "estimated"),
        );
        break;
      case "gift":
        rows.push(row("Regalato", formatQuantity(e.quantity), e.certainty === "estimated"));
        break;
      case "open":
        rows.push(row("Aperto", "—"));
        break;
      case "move":
        rows.push(row("Spostato", `→ ${LOCATION_LABELS[e.to]}`));
        break;
      case "adjust":
        rows.push(row("Riallineato", formatQuantity(e.remaining), e.certainty === "estimated"));
        break;
      case "updateLot": {
        const changed = (Object.keys(e.patch) as (keyof LotPatch)[]).filter((k) => e.patch[k] !== undefined);
        rows.push(row("Modificato", changed.map((k) => PATCH_LABELS[k]).join(", ") || "—"));
        break;
      }
    }
  }
  return rows;
}
