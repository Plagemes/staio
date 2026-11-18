// La revisione dello scontrino: quali righe sono dubbie (e stanno aperte, in cima) e che cosa dice una riga chiusa.
// Logica pura: lo stato della schermata sta in `ReceiptCapture.tsx`.
import { freshExpiryEstimate, lotExpiryEstimate, needsExpiryReview } from "@/core/ai/receiptExpiry";
import { isCalendarDate } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { readQuantity } from "../capture";
import { formatPrice } from "../format";
import { FOOD_CATEGORY_LABELS, LOCATION_LABELS } from "../labels";
import { isFoodCategory } from "../lots";
import type { ReviewLine } from "./receiptEvents";

export type Doubt =
  | "quantity_guessed" // la quantità non era sullo scontrino: è un «1» proposto
  | "no_category" // categoria non riconosciuta
  | "category_guessed" // categoria dedotta dalla lettura o dal nome per un alimento deperibile: non l'ha scelta nessuno
  | "remembered_differs" // la memoria propone altro e non l'ho applicata da sola
  | "not_food_included" // letta come non alimentare, ma inclusa
  | "error"; // la riga ha un errore dopo un tentativo di salvataggio

/** I dubbi di una riga inclusa; elenco vuoto = riga a posto. Una riga esclusa non ha dubbi. */
export function doubtsOf(line: ReviewLine, error?: string): Doubt[] {
  if (!line.include) return [];
  const doubts: Doubt[] = [];
  if (error) doubts.push("error");
  if (line.quantityGuessed) doubts.push("quantity_guessed");
  if (!isFoodCategory(line.category)) doubts.push("no_category");
  else if (categoryGuessed(line)) doubts.push("category_guessed");
  if (line.remembered && !line.remembered.applied && !line.touched) doubts.push("remembered_differs");
  if (!line.isFood) doubts.push("not_food_included");
  return doubts;
}

/**
 * La categoria non viene dalla memoria del negozio, né da un prodotto collegato, né dall'utente: l'ha dedotta la lettura
 * o il nome. Per ciò che va in frigo o è deperibile da lei dipende la scadenza, quindi la riga è dubbia finché non la si
 * guarda («Va bene») o la si cambia.
 */
function categoryGuessed(line: ReviewLine): boolean {
  if (line.touched || line.categoryChecked || line.barcode) return false;
  if (line.remembered?.applied && line.remembered.source === "store") return false;
  return line.location === "frigo" || needsExpiryReview(line.category, line.location);
}

const DOUBT_TEXT: Record<Exclude<Doubt, "error" | "category_guessed">, string> = {
  quantity_guessed: "Quantità non letta: ho messo 1.",
  no_category: "Categoria da scegliere.",
  remembered_differs: "L'ultima volta era diverso.",
  not_food_included: "Sembra non alimentare.",
};

/** Il dubbio in una riga; per `error` il testo dell'errore, per `category_guessed` la categoria che verrà salvata. */
export function doubtText(d: Doubt, detail?: string): string {
  if (d === "error") return detail && detail.trim() !== "" ? detail : "Questa riga ha un problema: controllala.";
  if (d === "category_guessed") return detail ? `Categoria da controllare: ${detail}.` : "Categoria da controllare.";
  return DOUBT_TEXT[d];
}

/** Il nome italiano della categoria, o niente. */
export function categoryLabel(category: string): string | undefined {
  return isFoodCategory(category) ? FOOD_CATEGORY_LABELS[category] : undefined;
}

export interface ReviewLayout {
  /** Le righe incluse: prima le dubbie, poi le altre, ciascun gruppo nell'ordine dello scontrino. */
  order: string[];
  /** Le righe escluse (non alimentari, «Ignora sempre»), nell'ordine dello scontrino: vanno in fondo, richiuse. */
  excluded: string[];
}

/**
 * Dove sta ogni riga. Si calcola quando le righe arrivano, non a ogni tocco: una riga dubbia che l'utente sistema
 * resta dov'è, sotto il dito.
 */
export function reviewLayout(lines: readonly ReviewLine[], errors: Readonly<Record<string, string>> = {}): ReviewLayout {
  const doubtful: string[] = [];
  const fine: string[] = [];
  const excluded: string[] = [];
  for (const line of lines) {
    if (!line.include) excluded.push(line.key);
    else if (doubtsOf(line, errors[line.key]).length > 0) doubtful.push(line.key);
    else fine.push(line.key);
  }
  return { order: [...doubtful, ...fine], excluded };
}

const rows = (n: number) => (n === 1 ? "1 riga" : `${n} righe`);

/** La riga di stato sopra l'elenco: «3 righe da controllare, 12 a posto.» o «15 righe, tutte a posto.» */
export function reviewStatus(lines: readonly ReviewLine[], errors: Readonly<Record<string, string>> = {}): string {
  const included = lines.filter((l) => l.include);
  if (included.length === 0) return "Nessuna riga scelta: accendi quelle da aggiungere.";
  const doubtful = included.filter((l) => doubtsOf(l, errors[l.key]).length > 0).length;
  if (doubtful === 0) return included.length === 1 ? "1 riga, a posto." : `${included.length} righe, tutte a posto.`;
  return `${rows(doubtful)} da controllare, ${included.length - doubtful} a posto.`;
}

/**
 * Categoria, quantità, luogo e prezzo di una riga chiusa: «Latte fresco · 1 l · Frigo · 1,29 €». La categoria c'è sempre
 * per una riga inclusa: nessuna riga si salva con una categoria che non si è potuta leggere.
 */
export function lineDetails(line: ReviewLine): string {
  const quantity = readQuantity(line.quantityText);
  const parts: string[] = [];
  if (line.include) parts.push(categoryLabel(line.category) ?? "senza categoria");
  parts.push(quantity.ok ? formatQuantity(quantity.quantity) : line.quantityText.trim());
  if (line.include) parts.push(LOCATION_LABELS[line.location]);
  else if (!line.isFood) parts.push("non alimentare");
  if (line.priceCents !== undefined) parts.push(formatPrice(line.priceCents));
  return parts.filter((p) => p !== "").join(" · ");
}

/** «21 nov»; con l'anno se non è quello dell'acquisto. */
const shortDate = (date: string, at: string): string =>
  new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short", ...(date.slice(0, 4) !== at.slice(0, 4) ? { year: "numeric" } : {}) })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\./g, "");

/**
 * Per una riga inclusa: la scadenza che avrà, detta in breve: la data scelta («entro il 21 nov»), oppure la stima per
 * categoria e luogo («entro il 21 nov, stima»). `at` è l'istante dell'acquisto (la data dello scontrino).
 */
export function expiryNote(line: ReviewLine, at: string): string | undefined {
  if (!line.include) return undefined;
  const chosen = line.expiry && isCalendarDate(line.expiry.date) ? line.expiry : undefined;
  if (chosen) return chosen.via === "label" ? `entro il ${shortDate(chosen.date, at)}` : `entro il ${shortDate(chosen.date, at)}, stima`;
  const estimate = lotExpiryEstimate({ category: line.category, location: line.location, at });
  return estimate === undefined ? undefined : `entro il ${shortDate(estimate, at)}, stima`;
}

/** Il campo della scadenza si vede per i freschi, e per ogni riga che ha già una data scelta (per poterla togliere). */
export function showsExpiryField(line: ReviewLine, at: string): boolean {
  if (!line.include) return false;
  return line.expiry !== undefined || freshExpiryEstimate({ category: line.category, location: line.location, at }) !== undefined;
}
