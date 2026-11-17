// Prodotti senza codice a barre. I valori nutrizionali di un alimento aggiunto a mano si legano a un codice locale, ricavato
// dal nome: è un EAN-13 valido nel campo riservato all'uso interno (prefisso 299), quindi passa da tutti i controlli dei
// codici. La scheda va nello stesso archivio `products` delle altre con `localFromName: true` (è questo a dire che il codice
// è locale, non il prefisso), e il lotto la ritrova per il suo campo `barcode`: il calcolo della nutrizione non cambia.
// Lo stesso nome dà lo stesso codice; due prodotti con lo stesso nome (due marche) hanno due varianti, scelte dall'utente.
import { LOCAL_CODE_PREFIX, checkDigitFor, isRestrictedCode, isStoredProduct, type Product } from "@/core/catalog";
import type { LedgerEvent } from "@/core/ledger";
import { allergenLabel } from "../barcode/messages";

export { LOCAL_CODE_PREFIX };

/** Il nome senza maiuscole, accenti e punteggiatura: «Farina 00!» e «farina  00» sono lo stesso prodotto. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Hash di 53 bit (cyrb53): stabile e senza dipendenze. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Il codice locale di un nome (13 cifre), o undefined se il nome è troppo corto per essere un prodotto.
 * `variant` distingue due prodotti con lo stesso nome (due marche di «biscotti»): 0 è il primo, 1 il secondo, e così via.
 */
export function localCodeForName(name: string, variant = 0): string | undefined {
  const base = nameKey(name);
  if (base.length < 2) return undefined;
  const key = variant > 0 ? `${base} #${variant}` : base;
  const body = `${LOCAL_CODE_PREFIX}${String(hash53(key) % 1_000_000_000).padStart(9, "0")}`;
  return `${body}${checkDigitFor(body)}`;
}

/**
 * Gli eventi di un lotto aggiunto a mano ma legato a una scheda locale: il codice resta sul lotto (è ciò che lo collega ai
 * valori), ma la fonte è «a mano» e la quantità dichiarata resta una stima, come per ogni lotto scritto a mano.
 */
export function manualLotEvents(events: readonly LedgerEvent[], code: string): LedgerEvent[] {
  return events.map((e) => {
    if ((e.type !== "purchase" && e.type !== "declare") || e.barcode !== code) return e;
    return e.type === "declare" ? { ...e, source: "manual", certainty: "estimated" } : { ...e, source: "manual" };
  });
}

export interface RecordReader {
  (barcode: string): Promise<{ data: unknown } | undefined>;
}

/** La scheda salvata per un nome (e variante), se c'è e l'ha creata l'app dal nome: non una scheda di un altro prodotto. */
export async function findLocalProduct(name: string, read: RecordReader, variant = 0): Promise<Product | undefined> {
  const code = localCodeForName(name, variant);
  if (!code) return undefined;
  const record = await read(code);
  return record && isStoredProduct(record.data) && record.data.localFromName === true ? record.data : undefined;
}

const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Due o tre valori e gli allergeni di una scheda salvata, per riconoscerla prima di usarla: «350 kcal, grassi 12,5 g, proteine 9 g». */
export function savedSummary(product: Pick<Product, "nutrients" | "allergens">): string {
  const n = product.nutrients;
  const parts: string[] = [];
  if (n?.energyKcal !== undefined) parts.push(`${Math.round(n.energyKcal)} kcal`);
  if (n?.fat !== undefined) parts.push(`grassi ${num(n.fat)} g`);
  if (n?.carbohydrates !== undefined) parts.push(`carboidrati ${num(n.carbohydrates)} g`);
  if (n?.proteins !== undefined) parts.push(`proteine ${num(n.proteins)} g`);
  const shown = parts.slice(0, 3).join(", ");
  const unit = n?.per === "100ml" ? "per 100 ml" : "per 100 g";
  const allergens = product.allergens && product.allergens.length > 0 ? ` Allergeni dichiarati: ${product.allergens.map(allergenLabel).join(", ")}.` : "";
  return `${shown ? `${shown} ${unit}.` : ""}${allergens}`.trim();
}

/**
 * Codice interno di un negozio con una scheda già salvata (di Open Food Facts o scritta dall'utente): la scheda può essere
 * di un altro prodotto, quindi in Cattura si usa solo dopo una scelta visibile dell'utente.
 */
export function offeredStoreProduct(barcode: string | undefined, product: Product | undefined): Product | undefined {
  if (!barcode || !product || product.localFromName || !isRestrictedCode(barcode)) return undefined;
  return product;
}

/** Il codice che il lotto porta: quello di una scheda offerta e non scelta non si porta, altrimenti ne prenderebbe i valori e gli allergeni. */
export function lotCodeFor(input: { barcode: string | undefined; localCode: string | undefined; offered: Product | undefined; chosen: boolean | undefined }): string | undefined {
  if (input.offered && input.chosen !== true) return undefined;
  return input.barcode || input.localCode || undefined;
}

/** Avviso quando i valori nuovi sostituiscono la scheda che l'utente non ha riconosciuto (o non ha ancora confermato). */
export function replacesSavedText(name: string | undefined): string {
  return `Sostituisce la scheda di «${name?.trim() || "un altro prodotto"}» per questo codice.`;
}
