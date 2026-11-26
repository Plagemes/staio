// Le frasi della pagina «Lista della spesa»: righe, riepiloghi, avvisi, e come si legge il campo «Aggiungi alla spesa».
// Logica pura: niente archivio, niente React.
import { formatQuantity } from "@/core/units";
import { formatPrice } from "../format";
import { parseManualLines, type ManualInput, type ManualReading } from "./manual";
import { DISMISS_DAYS } from "./settings";
import type { StockRow } from "./stockView";
import type { ViewItem } from "./view";

/** Il nome dentro una frase: «Latte» diventa «latte». */
export const inSentence = (name: string): string => name.toLocaleLowerCase("it-IT");

/** La seconda riga di una voce: un solo motivo, e se è confermata lo dice; una voce tua dice solo che è tua. `null` = niente da scrivere. */
export function itemSubline(v: Pick<ViewItem, "isManual" | "confirmed" | "reasons">): string | null {
  if (v.isManual) return "aggiunta da te";
  const reason = v.reasons[0];
  if (reason && v.confirmed) return `${reason} · confermata`;
  if (reason) return reason;
  return v.confirmed ? "confermata" : null;
}

/** «1 l», «6 pz» */
export const itemQuantityText = (v: Pick<ViewItem, "quantity" | "unit">): string => formatQuantity({ value: v.quantity, unit: v.unit });

/** Ciò che prima stava nella scheda della voce, in righe piccole: va nella testa del foglio «Voce». */
export function itemDetailLines(v: Pick<ViewItem, "changed" | "proposedQuantity" | "unit" | "stockText" | "costText" | "priceNote" | "forecastNote" | "notes">): string[] {
  const lines: string[] = [];
  if (v.changed) lines.push(`Proposta: ${formatQuantity({ value: v.proposedQuantity, unit: v.unit })}. Hai scelto tu la quantità.`);
  lines.push(`${v.stockText}. Costo stimato: ${v.costText}.`);
  if (v.priceNote) lines.push(v.priceNote);
  if (v.forecastNote) lines.push(v.forecastNote);
  lines.push(...v.notes);
  return lines;
}

export interface SpendSummaryLike {
  pricedCount: number;
  totalCents: number;
  /** Qualche acquisto del mese è senza prezzo: il totale è «almeno». */
  isMinimum: boolean;
}

/** Il riepilogo della riga «Costi e prezzi»: quanto si è speso questo mese. */
export function costsSummary(month: SpendSummaryLike): string {
  if (month.pricedCount === 0) return "nessun prezzo registrato";
  return `questo mese ${month.isMinimum ? "almeno " : ""}${formatPrice(month.totalCents)}`;
}

export interface BarInput {
  /** Voci da comprare: proposte e voci senza quantità. */
  listCount: number;
  /** C'è una spesa cominciata e non finita. */
  tripOn: boolean;
  /** C'è un'ultima spesa da guardare o da registrare. */
  lastTripOn: boolean;
}

export interface BarState {
  label: string;
  href: string;
  /** `outline` quando non c'è altro da fare che guardare l'ultima spesa. */
  variant: "primary" | "outline";
}

const STORE = "/app/spesa/negozio";

/** Che cosa dice la barra fissa; `null` = nessuna barra. */
export function barState({ listCount, tripOn, lastTripOn }: BarInput): BarState | null {
  if (tripOn) return { label: "Riprendi la spesa", href: STORE, variant: "primary" };
  if (listCount > 0) return { label: "Vado a fare la spesa", href: STORE, variant: "primary" };
  if (lastTripOn) return { label: "Vedi l'ultima spesa", href: STORE, variant: "outline" };
  return null;
}

/**
 * Le voci scritte nel campo: una per riga o separate da una virgola. Una virgola tra due cifre è decimale («1,5 l latte»)
 * e non separa. Anche il punto e virgola separa, come sempre.
 */
export function splitEntries(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n|;/)) {
    let from = 0;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== "," || (/\d/.test(line[i - 1] ?? "") && /\d/.test(line[i + 1] ?? ""))) continue;
      out.push(line.slice(from, i));
      from = i + 1;
    }
    out.push(line.slice(from));
  }
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/** Il testo del campo letto voce per voce: le righe capite e quelle no. */
export function readEntries(text: string): ManualReading {
  return parseManualLines(splitEntries(text).join("\n"));
}

/** Ciò che resta nel campo dopo l'aggiunta: solo ciò che non è stato letto. */
export const leftInField = (rejected: readonly string[]): string => rejected.join(", ");

/** Una voce senza quantità scritta resta senza quantità: non le si inventa «un pezzo». */
export function toInputs(reading: ManualReading): ManualInput[] {
  return reading.items.map((i) => (i.assumedOne ? { product: i.product } : { product: i.product, quantity: i.quantity }));
}

export const notReadText = (rejected: readonly string[]): string => `Non ho capito: ${rejected.map((r) => `“${r}”`).join(", ")}. Scrivi il nome, o la quantità e il nome.`;

export const addedText = (products: readonly string[]): string => `Aggiunto alla lista della spesa: ${products.map(inSentence).join(", ")}.`;

export const confirmedText = (name: string, quantity: string): string => `Confermato: ${inSentence(name)}, ${quantity}.`;

export const unconfirmedText = (name: string): string => `Di nuovo una proposta: ${inSentence(name)}.`;

export const quantityChangedText = (name: string, quantity: string): string => `${name}: ${quantity}.`;

/** «Togli»: una voce tua sparisce; una proposta resta fuori per `DISMISS_DAYS` giorni e si ricorda. */
export function removedText(name: string, proposal: boolean): string {
  const base = `Tolto dalla lista: ${inSentence(name)}.`;
  if (!proposal) return base;
  const days: number = DISMISS_DAYS;
  return `${base} Non lo propongo per ${days} ${days === 1 ? "giorno" : "giorni"}.`;
}

export const confirmedAllText = "Confermate tutte le voci.";

export const proposedAgainText = (name: string): string => `Di nuovo tra le proposte: ${inSentence(name)}.`;

/** La riga di una scorta minima: «minimo 2 pz · in casa 1 pz». */
export function stockLine(row: Pick<StockRow, "minimumText" | "stockText">): string {
  const home = row.stockText.startsWith("In casa: ") ? `in casa ${row.stockText.slice("In casa: ".length)}` : "non ne hai in casa";
  return `${row.minimumText ? `minimo ${row.minimumText}` : "nessun minimo"} · ${home}`;
}

/** «Suggerito: 3 pz»; niente se i consumi non bastano. */
export function suggestedText(row: Pick<StockRow, "suggestion" | "unit">): string | undefined {
  return row.suggestion ? `Suggerito: ${formatQuantity({ value: row.suggestion.suggested, unit: row.unit })}` : undefined;
}
