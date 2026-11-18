// I testi della schermata «In negozio»: riga di stato, pulsanti, righe di «Metti in dispensa», confronto. Logica pura.
import { diffDays } from "@/core/expiry";
import type { Location } from "@/core/ledger";
import type { TripState } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { estimatedExpiryDate } from "../barcode/directAdd";
import { dayOf, formatPrice, relativeDay } from "../format";
import { FOOD_CATEGORY_LABELS, LOCATION_LABELS } from "../labels";
import { isFoodCategory } from "../lots";
import { parseManualLines, type ManualInput } from "./manual";
import type { AlreadyRow, MissingField, PurchaseRow, ReconcileView, TripTotals } from "./trip";

export interface TripEstimate {
  cents: number;
  priced: number;
  unpriced: number;
}

/** Stima di tutta la spesa: le voci in lista con un prezzo osservato, più le fuori lista con il prezzo scritto. */
export function tripEstimate(trip: TripState, totals: TripTotals): TripEstimate {
  let cents = totals.listCents;
  let priced = totals.listPriced;
  let unpriced = totals.listUnpriced;
  for (const o of trip.offList) {
    if (o.priceCents !== undefined) {
      cents += o.priceCents;
      priced += 1;
    } else unpriced += 1;
  }
  return { cents, priced, unpriced };
}

/** «Conad · 3 di 8 · circa 24 €»; con voci senza prezzo «almeno»; senza nessun prezzo, niente soldi. */
export function statusText(store: string | null, progress: { checked: number; total: number }, estimate: TripEstimate): string {
  const parts = [store ?? "Negozio non indicato", `${progress.checked} di ${progress.total}`];
  if (estimate.priced > 0) parts.push(`${estimate.unpriced > 0 ? "almeno" : "circa"} ${formatPrice(estimate.cents)}`);
  return parts.join(" · ");
}

export const NO_WAKE_LOCK_TEXT = "Su questo telefono lo schermo può spegnersi da solo.";

/** Ciò che è nel carrello: le voci spuntate e quelle fuori lista. */
export function cartCount(trip: TripState): number {
  return trip.items.filter((i) => i.checkedAt !== undefined).length + trip.offList.length;
}

export function finishLabel(count: number): string {
  return count > 0 ? `Ho finito (${count})` : "Ho finito";
}

export function putAwayTitle(count: number): string {
  return `Metti in dispensa (${count})`;
}

export function putAwayLabel(count: number): string {
  return `Aggiungi alla dispensa (${count})`;
}

/** La riga chiusa: «Latte intero · 1 l · Frigo». */
export function compactRow(row: Pick<PurchaseRow, "name" | "quantityText"> & { location: Location | "" }): string {
  return [row.name, row.quantityText.trim(), row.location === "" ? "" : LOCATION_LABELS[row.location]].filter((p) => p !== "").join(" · ");
}

/** «~5 giorni», «~2 mesi»: quanto dura una stima di scadenza. */
export function durationText(days: number): string {
  if (days < 60) return `~${Math.max(0, days)} ${days === 1 ? "giorno" : "giorni"}`;
  if (days < 540) {
    const months = Math.round(days / 30);
    return `~${months} ${months === 1 ? "mese" : "mesi"}`;
  }
  const years = Math.round(days / 365);
  return `~${years} ${years === 1 ? "anno" : "anni"}`;
}

/** Sotto la riga chiusa: la categoria e la scadenza che ne viene, «Formaggi freschi · ~5 giorni». */
export function rowDetail(row: Pick<PurchaseRow, "category"> & { location: Location | "" }, today: string): string {
  if (!isFoodCategory(row.category)) return "Categoria da scegliere";
  const label = FOOD_CATEGORY_LABELS[row.category];
  const date = row.location === "" ? null : estimatedExpiryDate(row.category, row.location, today);
  return date ? `${label} · ${durationText(diffDays(date, today))}` : label;
}

/** In cima, se qualche categoria viene solo dal nome. */
export function checkText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Una categoria l'ho dedotta dal nome: controllala." : `${count} categorie le ho dedotte dal nome: controllale.`;
}

export function alreadyTitle(count: number): string {
  return `Già in dispensa (${count})`;
}

/** Perché una voce risulta già entrata: «comprato oggi, 1 l, Conad · Via Roma». */
export function alreadyReason(lot: AlreadyRow["lot"], today: string): string {
  const parts = [`comprato ${relativeDay(dayOf(lot.createdAt), today)}`, formatQuantity({ value: lot.quantity, unit: lot.unit })];
  if (lot.store) parts.push(lot.store);
  return parts.join(", ");
}

/** In cima, se a qualche riga manca un dato. */
export function missingText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Manca 1 dato: te lo chiedo qui sotto." : `Mancano ${count} dati: te li chiedo qui sotto.`;
}

/** Sotto il pulsante, quando una riga ferma il salvataggio: «Scrivi quanto per: pane.» */
export function blockingText(rows: ReadonlyArray<{ name: string; missing: readonly MissingField[] }>): string | null {
  const noQuantity = rows.filter((r) => r.missing.includes("quantity")).map((r) => r.name);
  const noCategory = rows.filter((r) => r.missing.includes("category")).map((r) => r.name);
  const lines: string[] = [];
  if (noQuantity.length > 0) lines.push(`Scrivi quanto per: ${noQuantity.join(", ")}.`);
  if (noCategory.length > 0) lines.push(`Scegli la categoria per: ${noCategory.join(", ")}.`);
  return lines.length > 0 ? lines.join(" ") : null;
}

/** L'avviso dopo «Aggiungi alla dispensa». */
export function putAwayDoneText(count: number, remembered = true): string {
  const done = count === 1 ? "Aggiunto alla dispensa: 1 alimento. Scadenza stimata." : `Aggiunti alla dispensa: ${count} alimenti. Scadenze stimate.`;
  return remembered ? done : `${done} Non ho potuto ricordare le categorie.`;
}

/** Il riepilogo della riga richiusa «Confronto con la lista». */
export function compareSummary(view: Pick<ReconcileView, "waiting" | "missing" | "extra">): string {
  if (view.waiting) return "nessun acquisto registrato";
  const parts: string[] = [];
  if (view.missing.length > 0) parts.push(`${view.missing.length} ${view.missing.length === 1 ? "non comprata" : "non comprate"}`);
  if (view.extra.length > 0) parts.push(`${view.extra.length} fuori lista`);
  return parts.length > 0 ? parts.join(" · ") : "tutto come in lista";
}

/**
 * Il campo «Aggiungi»: «2 l latte, pane» sono due voci. La virgola tra due cifre resta un decimale («1,5 kg»).
 * Le righe che non si capiscono tornano indietro, come scritte.
 */
export function readAddText(text: string): { entries: ManualInput[]; rejected: string[] } {
  const reading = parseManualLines(text.replace(/(?<!\d),|,(?!\d)/g, "\n"));
  return { entries: reading.items.map((i) => ({ product: i.product, quantity: i.quantity })), rejected: reading.rejected };
}

/** L'avviso dopo un'aggiunta alla lista, come quello del «+». */
export function addedToListText(names: readonly string[]): string {
  return `Aggiunt${names.length === 1 ? "o" : "i"} alla lista della spesa: ${names.join(", ")}.`;
}
