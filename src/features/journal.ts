// I movimenti della dispensa di un giorno, in ordine di orario, già in parole: la riga «Dispensa» del diario di Oggi.
import { QUICK_CONSUME_NOTE } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { sortEvents, type LotPatch, type PantryState } from "@/core/ledger";
import { formatQuantity, type Quantity } from "@/core/units";
import type { AnyEvent } from "@/core/events";
import { ledgerEventsOf } from "./events";
import { dayOf, formatTime } from "./format";
import { DISCARD_REASON_LABELS, LOCATION_LABELS } from "./labels";

export interface JournalRow {
  id: string;
  /** Gli eventi che la riga racconta: più d'uno se sono uguali e alla stessa ora (`id` è il primo). */
  ids: string[];
  /** "08:10" */
  time: string;
  description: string;
  value: string;
  /** La quantità è una stima: il valore si mostra con tilde e puntini. */
  estimated: boolean;
  /** La riga si può togliere da qui. */
  canUndo: boolean;
  /** Perché non si può togliere, se è così. */
  undoBlocked?: string;
}

interface RawRow extends JournalRow {
  /** Titolo e nome separati, e la quantità, per poter unire le righe uguali. */
  title: string;
  name: string;
  quantity?: Quantity;
}

/**
 * Righe uguali (stesso titolo, prodotto, quantità e minuto) diventano una: «Entra · Mousse · 3 × 170 g».
 * Annullare la riga annulla tutti i suoi eventi; si può solo se si può annullare ciascuno.
 */
function mergeEqualRows(rows: readonly RawRow[]): JournalRow[] {
  const out: JournalRow[] = [];
  const byKey = new Map<string, RawRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = [r.time, r.title, r.name, r.value].join("");
    const list = byKey.get(key);
    if (list) list.push(r);
    else {
      byKey.set(key, [r]);
      order.push(key);
    }
  }
  for (const key of order) {
    const group = byKey.get(key) as RawRow[];
    const first = group[0];
    const { title: _title, name: _name, quantity: _quantity, ...base } = first;
    void _title;
    void _name;
    void _quantity;
    if (group.length === 1) {
      out.push(base);
      continue;
    }
    const total = first.quantity
      ? formatQuantity({ value: Math.round(group.reduce((s, r) => s + (r.quantity?.value ?? 0), 0) * 1e6) / 1e6, unit: first.quantity.unit })
      : first.value;
    const blocked = group.find((r) => !r.canUndo);
    out.push({
      ...base,
      ids: group.flatMap((r) => r.ids),
      description: `${first.title} · ${first.name} · ${group.length} × ${first.value}`,
      value: first.quantity ? total : first.value,
      canUndo: blocked === undefined,
      ...(blocked?.undoBlocked ? { undoBlocked: blocked.undoBlocked } : {}),
    });
  }
  return out;
}

const PATCH_LABELS: Record<keyof LotPatch, string> = {
  expiry: "scadenza",
  productRef: "nome",
  category: "categoria",
  barcode: "codice a barre",
  priceCents: "prezzo",
  store: "negozio",
};

export interface JournalOptions {
  /**
   * Lascia fuori i consumi che fanno parte di un pasto (quelli con `mealId`): nel diario di Oggi stanno già nel loro
   * momento, e nella riga «Dispensa» sarebbero doppi.
   */
  withoutMealConsumes?: boolean;
}

/**
 * Eventi del giorno `today` (giorno di calendario di Roma). Restano fuori gli eventi annullati
 * e gli annullamenti stessi: il registro racconta ciò che è successo davvero.
 */
export function buildJournal(
  events: readonly AnyEvent[],
  pantry: PantryState,
  today: string,
  timeZone: string = DEFAULT_TIME_ZONE,
  options: JournalOptions = {},
): JournalRow[] {
  const voided = new Set(pantry.voidedEventIds);
  const names = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const lots = new Map(pantry.lots.map((l) => [l.lotId, l]));
  const rows: RawRow[] = [];

  for (const e of sortEvents(ledgerEventsOf(events))) {
    if (e.type === "void" || voided.has(e.id)) continue;
    if (dayOf(e.at, timeZone) !== today) continue;
    if (options.withoutMealConsumes && e.type === "consume" && e.mealId) continue;
    const name = ("lotId" in e ? names.get(e.lotId) : undefined) ?? (e.type === "purchase" || e.type === "declare" ? e.productRef : "alimento");
    // annullare l'ingresso di un alimento lascerebbe senza lotto i movimenti che lo seguono
    const isCreation = e.type === "purchase" || e.type === "declare";
    const blocked =
      e.type === "consume" && e.mealId && e.note === QUICK_CONSUME_NOTE
        ? "Sta nel momento in cui l'hai segnato: lo togli o lo sposti da «Diario di oggi»."
        : e.type === "consume" && e.mealId
        ? "Fa parte di un pasto: togli il pasto da «Diario di oggi», così tornano a posto anche gli altri alimenti."
        : isCreation && (lots.get(e.lotId)?.history.length ?? 0) > 1
          ? "Questo alimento ha già altri movimenti: toglili prima, poi potrai togliere l'ingresso."
          : undefined;
    const row = (title: string, value: string, estimated = false, quantity?: Quantity): RawRow => ({
      id: e.id,
      ids: [e.id],
      time: formatTime(e.at, timeZone),
      title,
      name,
      ...(quantity ? { quantity } : {}),
      description: `${title} · ${name}`,
      value,
      estimated,
      canUndo: blocked === undefined,
      ...(blocked ? { undoBlocked: blocked } : {}),
    });
    switch (e.type) {
      case "purchase":
      case "declare":
        rows.push(row("Entra", formatQuantity(e.quantity), e.certainty === "estimated", e.quantity));
        break;
      case "consume":
        rows.push(row("Mangiato", formatQuantity(e.quantity), e.certainty === "estimated", e.quantity));
        break;
      case "discard":
        rows.push(
          row(`Buttato, ${DISCARD_REASON_LABELS[e.reason].toLowerCase()}`, formatQuantity(e.quantity), e.certainty === "estimated", e.quantity),
        );
        break;
      case "gift":
        rows.push(row("Regalato", formatQuantity(e.quantity), e.certainty === "estimated", e.quantity));
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
  return mergeEqualRows(rows);
}
