// Stima del costo di una chiamata. I prezzi non sono scritti nel codice: il listino è un dato che
// l'utente compila (dal listino del suo fornitore) e può correggere; all'inizio è vuoto.
//
// Gli importi sono nella valuta del conto presso il fornitore (di solito dollari), in unità intere con decimali:
// non sono denaro del registro, e una lettura costa spesso meno di un centesimo, quindi i centesimi interi non bastano.
import { parseDecimal } from "./numbers";
import type { AiUsage } from "./types";

export interface ModelPrice {
  /** Prezzo per un milione di token in ingresso. */
  inputPerMTok: number;
  /** Prezzo per un milione di token in uscita. */
  outputPerMTok: number;
}

/** Prezzi per identificativo del modello. */
export type PriceList = Readonly<Record<string, ModelPrice>>;

export const EMPTY_PRICE_LIST: PriceList = {};

function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Ripulisce un listino letto dal disco o scritto dall'utente: scarta le voci non valide, non lancia. */
export function normalizePriceList(raw: unknown): PriceList {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ModelPrice> = {};
  for (const [model, entry] of Object.entries(raw)) {
    const name = model.trim();
    if (name === "" || typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const input = parseDecimal(e.inputPerMTok);
    const output = parseDecimal(e.outputPerMTok);
    if (isPrice(input) && isPrice(output)) out[name] = { inputPerMTok: input, outputPerMTok: output };
  }
  return out;
}

/** Prezzo noto per il modello, o undefined. */
export function priceOf(model: string, priceList: PriceList): ModelPrice | undefined {
  return Object.hasOwn(priceList, model) ? priceList[model] : undefined;
}

/** Costo stimato di una chiamata, o null se il listino non ha il modello. */
export function estimateCost(usage: AiUsage, model: string, priceList: PriceList): number | null {
  const price = priceOf(model, priceList);
  if (!price) return null;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

/** Importo con la precisione che serve: due decimali, oppure di più se è minuscolo. */
export function formatCost(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const digits = abs === 0 || abs >= 0.1 ? 2 : abs >= 0.01 ? 3 : 4;
  const text = amount.toFixed(digits).replace(".", ",");
  return currency.trim() === "" ? text : `${text} ${currency.trim()}`;
}
