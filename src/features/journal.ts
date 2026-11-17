// Registro di oggi: gli eventi del giorno, in ordine di orario, già in parole.
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { sortEvents, type LedgerEvent, type LotPatch, type PantryState } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
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
  events: readonly LedgerEvent[],
  pantry: PantryState,
  today: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): JournalRow[] {
  const voided = new Set(pantry.voidedEventIds);
  const names = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const rows: JournalRow[] = [];

  for (const e of sortEvents(events)) {
    if (e.type === "void" || voided.has(e.id)) continue;
    if (dayOf(e.at, timeZone) !== today) continue;
    const name = ("lotId" in e ? names.get(e.lotId) : undefined) ?? (e.type === "purchase" || e.type === "declare" ? e.productRef : "alimento");
    const row = (title: string, value: string, estimated = false): JournalRow => ({
      id: e.id,
      time: formatTime(e.at, timeZone),
      description: `${title} · ${name}`,
      value,
      estimated,
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
