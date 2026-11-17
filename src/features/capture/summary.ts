// Riepilogo di «Altri dettagli» a sezione richiusa: la categoria e solo ciò che è stato riempito. Logica pura.
import { formatQuantity } from "@/core/units";
import { parsePriceCents, formatPrice } from "../format";
import { EXPIRY_KIND_LABELS, type ChosenExpiryKind } from "../labels";
import { pluralIt } from "../pieces";

export interface DetailsSummaryInput {
  /** Nome della categoria in vista; assente se non c'è (allora è un campo in vista, non sta qui). */
  categoryLabel?: string;
  /** La categoria l'ha scelta l'utente: altrimenti è una proposta (dal nome, dalla memoria, dal codice). */
  categoryChosen: boolean;
  /** Tipo di data scelto a mano; null se vale quello proposto dalla categoria. */
  expiryKind: ChosenExpiryKind | null;
  /** Più confezioni con date diverse. */
  datesSplit: boolean;
  pieces?: { count: number; each: number; unit: "g" | "ml" | "pz"; name?: string };
  priceText: string;
  alreadyHave: boolean;
  /** L'alimento prende dei valori nutrizionali scelti o scritti dall'utente. */
  nutrition: boolean;
}

export function detailsSummary(input: DetailsSummaryInput): string {
  const parts: string[] = [];
  if (input.categoryLabel) parts.push(input.categoryChosen ? input.categoryLabel : `${input.categoryLabel} (proposta)`);
  if (input.expiryKind) parts.push(EXPIRY_KIND_LABELS[input.expiryKind].toLowerCase());
  if (input.pieces) {
    const { count, each, unit, name } = input.pieces;
    const noun = name && name !== "pezzo" ? pluralIt(name) : "pezzi";
    parts.push(`${count} ${noun} da ${formatQuantity({ value: each, unit })}`);
  }
  if (input.datesSplit) parts.push("date diverse");
  const price = input.priceText.trim();
  // con «ce l'avevo già» chi chiama passa il prezzo vuoto: il campo non c'è e il prezzo non si salva
  if (price !== "") {
    const parsed = parsePriceCents(price);
    parts.push(parsed.ok ? formatPrice(parsed.cents) : price);
  } else if (!input.alreadyHave) {
    parts.push("senza prezzo");
  }
  if (input.alreadyHave) parts.push("ce l'avevo già");
  if (input.nutrition) parts.push("con valori nutrizionali");
  return parts.join(" · ");
}
