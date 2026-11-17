// Candidati per le alternative: solo prodotti che l'utente ha già letto (salvati sul telefono) o
// comprato. Prezzi e dispensa si cercano per codice a barre. Logica pura.

import { toGtin13, type Product } from "@/core/catalog";
import type { Lot } from "@/core/ledger";
import { shelfVerdict, type Candidate, type PantryStock, type PriceObservation } from "@/core/quality";
import { normalizeName } from "@/core/shopping";
import { isDoubtfulProduct } from "./codes";

const key = (code: string): string => toGtin13(code);

/** Acquisti con prezzo, per codice a barre: quanto è stato pagato per quale quantità. */
export function priceObservationsByBarcode(lots: readonly Lot[]): Map<string, PriceObservation[]> {
  const out = new Map<string, PriceObservation[]>();
  for (const lot of lots) {
    if (lot.origin !== "purchase" || lot.barcode === undefined) continue;
    if (lot.priceCents === undefined || !(lot.priceCents > 0) || !(lot.initial > 0)) continue;
    const list = out.get(key(lot.barcode)) ?? [];
    list.push({ totalCents: lot.priceCents, amount: lot.initial, unit: lot.unit, ...(lot.store?.trim() ? { store: lot.store.trim() } : {}) });
    out.set(key(lot.barcode), list);
  }
  return out;
}

/** Prezzi osservati di un solo prodotto, per codice a barre; `undefined` se non ce ne sono. */
export function pricesFor(lots: readonly Lot[], barcode: string): PriceObservation[] | undefined {
  return priceObservationsByBarcode(lots).get(key(barcode));
}

/** Prodotti noti con i loro prezzi osservati. Un prodotto senza codice non entra. */
export function buildCandidates(products: Iterable<Product>, lots: readonly Lot[]): Candidate[] {
  const prices = priceObservationsByBarcode(lots);
  const out: Candidate[] = [];
  for (const product of products) {
    if (typeof product.barcode !== "string" || product.barcode === "") continue;
    // una scheda dubbia non si propone come alternativa migliore
    if (isDoubtfulProduct(product)) continue;
    const own = prices.get(key(product.barcode));
    out.push(own ? { product, prices: own } : { product });
  }
  return out;
}

function sumStock(lots: readonly Lot[]): Pick<PantryStock, "amount" | "unit"> {
  if (new Set(lots.map((l) => l.unit)).size !== 1) return {};
  return { amount: Math.round(lots.reduce((s, l) => s + l.remaining, 0) * 1000) / 1000, unit: lots[0].unit };
}

/**
 * Quanto ne hai in casa tra i lotti ancora attivi: prima per codice a barre; se non c'è, per nome uguale
 * (normalizzato) a quello del prodotto. Una corrispondenza per nome è dichiarata tale: potrebbe non essere lo stesso prodotto.
 */
export function pantryStockFor(lots: readonly Lot[], barcode: string, name?: string): PantryStock {
  const active = lots.filter((l) => l.status === "active" && l.remaining > 0);
  const byCode = active.filter((l) => l.barcode !== undefined && key(l.barcode) === key(barcode));
  if (byCode.length > 0) return { has: true, ...sumStock(byCode) };
  const wanted = name ? normalizeName(name) : "";
  if (wanted === "") return { has: false };
  const byName = active.filter((l) => normalizeName(l.productRef) === wanted);
  if (byName.length > 0) return { has: true, ...sumStock(byName), matchedBy: "name", matchLabel: byName[0].productRef };
  return { has: false, searchedBy: ["barcode", "name"] };
}

/** La riga sulla dispensa è quella della logica di qualità, con il criterio di ricerca dichiarato. */
export function pantryLineOf(product: Product, stock: PantryStock): string {
  return shelfVerdict({ product, pantry: stock }).pantryLine ?? "";
}

export interface KnownProductRow {
  product: Product;
  /** Ha almeno un acquisto (o un "ce l'ho già") registrato con questo codice. */
  inLedger: boolean;
  inPantry: boolean;
}

/** Elenco dei prodotti conosciuti, in ordine di nome; i senza nome in fondo. */
export function knownProductRows(products: Iterable<Product>, lots: readonly Lot[]): KnownProductRow[] {
  const ledger = new Set<string>();
  const pantry = new Set<string>();
  for (const l of lots) {
    if (l.barcode === undefined) continue;
    ledger.add(key(l.barcode));
    if (l.status === "active" && l.remaining > 0) pantry.add(key(l.barcode));
  }
  const rows: KnownProductRow[] = [];
  for (const product of products) {
    if (typeof product.barcode !== "string") continue;
    rows.push({ product, inLedger: ledger.has(key(product.barcode)), inPantry: pantry.has(key(product.barcode)) });
  }
  return rows.sort((a, b) => {
    const an = a.product.name?.trim() ?? "";
    const bn = b.product.name?.trim() ?? "";
    if ((an === "") !== (bn === "")) return an === "" ? 1 : -1;
    return an.localeCompare(bn, "it") || a.product.barcode.localeCompare(b.product.barcode);
  });
}
