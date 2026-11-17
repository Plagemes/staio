// Aggiunta diretta dalla scheda del prodotto: dal prodotto letto al modulo di cattura, senza passare dal modulo.
import { expiryCategoryProposal, quantityText, type ExpiryCategorySource, type PiecesHint, type Product } from "@/core/catalog";
import { SHELF_LIFE, effectiveExpiry, type FoodCategory } from "@/core/expiry";
import { piecesAgree, type LedgerEvent, type Location, type Quantity } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { buildCaptureEvents, cleanName, readQuantity, type CaptureContext, type CaptureInput, type FieldErrors } from "../capture";
import { formatCalendarDate } from "../format";
import { LOCATION_LABELS, type ChosenExpiryKind } from "../labels";
import { defaultLocation } from "../quickAdd";
import { parseQuantityInUnit } from "../actions";
import { pieceNameFor, pluralIt } from "../pieces";

/** Dati del prodotto già pronti per il registro; ciò che manca resta `undefined`. */
export interface ProductDraft {
  name?: string;
  quantityText?: string;
  category?: FoodCategory;
  /** Da dove viene la categoria proposta: Open Food Facts o parole del nome. */
  categorySource?: ExpiryCategorySource;
  /** Pezzi dentro la confezione secondo Open Food Facts (proposta). */
  piecesHint?: PiecesHint;
  /** Come si chiama il pezzo, se si ricava dal nome. */
  pieceName?: string;
  barcode: string;
  brand?: string;
}

export type MissingField = "name" | "quantity" | "category";

/** Ordine in cui si chiedono i dati mancanti sulla scheda. */
const MISSING_ORDER: readonly MissingField[] = ["name", "quantity", "category"];

export function draftFromProduct(product: Product): ProductDraft {
  const name = cleanName(product.name ?? "");
  // prima il valore già in unità base, poi il testo dell'etichetta; se nessuno dei due si legge, la quantità si chiede
  const text = [quantityText(product.quantity), product.quantity?.text].find((t) => t !== undefined && readQuantity(t).ok);
  const match = expiryCategoryProposal(product);
  return {
    barcode: product.barcode,
    ...(name !== "" ? { name } : {}),
    // la quantità vale solo se il registro la sa leggere: non se ne inventa una
    ...(text ? { quantityText: text } : {}),
    ...(match.matched ? { category: match.category, categorySource: match.source } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
    ...(product.piecesHint ? { piecesHint: product.piecesHint } : {}),
    ...(pieceNameFor(name) ? { pieceName: pieceNameFor(name) } : {}),
  };
}

export function missingFields(draft: ProductDraft): MissingField[] {
  const missing = new Set<MissingField>();
  if (!draft.name) missing.add("name");
  if (!draft.quantityText) missing.add("quantity");
  if (!draft.category) missing.add("category");
  return MISSING_ORDER.filter((f) => missing.has(f));
}

export interface DirectAnswers {
  name?: string;
  quantityText?: string;
  category?: string;
  expiryKind?: ChosenExpiryKind | "none";
  expiryDate?: string;
  priceText?: string;
}

/** Tipo di data proposto dalla categoria: i deperibili «da consumare entro», il resto «preferibilmente entro». */
export function defaultExpiryKind(category: string | undefined): ChosenExpiryKind {
  const life = category ? SHELF_LIFE[category as FoodCategory] : undefined;
  return life?.perishable ? "use_by" : "best_before";
}

/** Il dato scritto sulla scheda vale più di quello del prodotto, ma solo se non è vuoto. La data è facoltativa: senza, resta la stima. */
export function inputFromDraft(draft: ProductDraft, location: Location, answers: DirectAnswers = {}): CaptureInput {
  const category = answers.category || draft.category || "";
  const date = answers.expiryKind === "none" ? "" : (answers.expiryDate ?? "").trim();
  return {
    name: answers.name?.trim() || draft.name || "",
    quantityText: answers.quantityText?.trim() || draft.quantityText || "",
    location,
    category,
    expiryKind: date === "" ? "none" : answers.expiryKind && answers.expiryKind !== "none" ? answers.expiryKind : defaultExpiryKind(category),
    expiryDate: date,
    priceText: answers.priceText ?? "",
    alreadyHave: false,
    barcode: draft.barcode,
    brand: draft.brand,
  };
}

/** Un gruppo di confezioni uguali con la stessa data (vuota = senza data, vale la stima). */
export interface PackGroup {
  count: number;
  expiryDate: string;
}

export const MAX_PACKS = 24;

export const clampPacks = (n: number): number => Math.min(MAX_PACKS, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));

/** Divide il totale in due gruppi, il primo il più grande: 5 diventa 3 + 2; con una sola confezione resta un gruppo. */
export function splitPackGroups(total: number, expiryDate = ""): PackGroup[] {
  const n = clampPacks(total);
  if (n === 1) return [{ count: 1, expiryDate }];
  const first = Math.ceil(n / 2);
  return [
    { count: first, expiryDate },
    { count: n - first, expiryDate: "" },
  ];
}

export const groupsTotal = (groups: readonly PackGroup[]): number => groups.reduce((sum, g) => sum + g.count, 0);

/** Il messaggio d'errore se i gruppi non sommano al totale; null se vanno bene. */
export function checkPackGroups(groups: readonly PackGroup[], total: number): string | null {
  const sum = groupsTotal(groups);
  if (sum < total) return `Mancano ${total - sum} confezioni: assegnale a un gruppo.`;
  if (sum > total) return `Hai assegnato ${sum - total} confezioni in più del totale.`;
  return null;
}

/** Un modulo di cattura per ogni confezione, nell'ordine dei gruppi: ognuna avrà il suo lotto e la sua data. */
export function buildPackInputs(
  draft: ProductDraft,
  location: Location,
  answers: DirectAnswers,
  groups: readonly PackGroup[],
): CaptureInput[] {
  const inputs: CaptureInput[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      inputs.push(inputFromDraft(draft, location, { ...answers, expiryDate: group.expiryDate }));
    }
  }
  return inputs;
}

export type PackEventsResult = { ok: true; events: LedgerEvent[]; lotIds: string[] } | { ok: false; errors: FieldErrors };

/** Gli eventi di tutte le confezioni, da scrivere in una sola volta: se una non è valida non si scrive niente. */
export function buildPackEvents(inputs: readonly CaptureInput[], ctx: CaptureContext): PackEventsResult {
  const events: LedgerEvent[] = [];
  const lotIds: string[] = [];
  for (const input of inputs) {
    const r = buildCaptureEvents(input, ctx);
    if (!r.ok) return r;
    events.push(...r.events);
    lotIds.push(r.lotId);
  }
  return { ok: true, events, lotIds };
}

/** «3 × 170 g»; con una confezione solo la quantità. Se la quantità non si legge, il testo com'è. */
export function packsLabel(count: number, quantityTextOfOne: string): string {
  const reading = readQuantity(quantityTextOfOne);
  const one = reading.ok ? formatQuantity(reading.quantity) : quantityTextOfOne.trim();
  return count > 1 ? `${count} × ${one}` : one;
}

/** Luogo proposto per la categoria; senza categoria il frigo, che è la scelta più prudente. */
export function locationFor(category: string | undefined): Location {
  return category ? defaultLocation(category as FoodCategory) : "frigo";
}

/** Scadenza stimata dalla categoria e dal luogo, per il giorno `today` (`YYYY-MM-DD`); null se la categoria manca. */
export function estimatedExpiryDate(category: string | undefined, location: Location, today: string): string | null {
  if (!category) return null;
  try {
    return effectiveExpiry({ id: "estimate", labelDateType: "none", purchaseDate: today, location, category: category as FoodCategory }, today).date;
  } catch {
    return null;
  }
}

export function estimatedExpiryText(category: string | undefined, location: Location, today: string): string {
  const date = estimatedExpiryDate(category, location, today);
  return date ? `Scadenza stimata: ${formatCalendarDate(date)}.` : "Senza data, la scadenza sarà una stima dalla categoria.";
}

/** «Aggiunto alla dispensa: Farfalle, 500 g, in credenza. Scadenza stimata: 10 nov 2028.» */
export function confirmationText(event: LedgerEvent, today: string): string {
  if (event.type !== "purchase" && event.type !== "declare") return "Aggiunto alla dispensa.";
  const place = LOCATION_LABELS[event.location].toLowerCase();
  const head = `Aggiunto alla dispensa: ${event.productRef}, ${formatQuantity(event.quantity)}, in ${place}.`;
  if (event.expiry) return `${head} Scadenza: ${formatCalendarDate(event.expiry.date)}.`;
  return `${head} ${estimatedExpiryText(event.category, event.location, today)}`;
}

/** Conferma dopo l'aggiunta di più confezioni: un solo messaggio con il totale e le scadenze. */
export function packsConfirmationText(events: readonly LedgerEvent[], today: string): string {
  const creations = events.filter((e) => e.type === "purchase" || e.type === "declare");
  const first = creations[0];
  if (!first || (first.type !== "purchase" && first.type !== "declare")) return "Aggiunto alla dispensa.";
  if (creations.length === 1) return confirmationText(first, today);
  const place = LOCATION_LABELS[first.location].toLowerCase();
  const head = `Aggiunte ${creations.length} confezioni alla dispensa: ${first.productRef}, ${creations.length} × ${formatQuantity(first.quantity)}, in ${place}.`;
  const dates = new Map<string, number>();
  let undated = 0;
  for (const e of creations) {
    if (e.type !== "purchase" && e.type !== "declare") continue;
    if (e.expiry) dates.set(e.expiry.date, (dates.get(e.expiry.date) ?? 0) + 1);
    else undated += 1;
  }
  if (dates.size === 0) return `${head} ${estimatedExpiryText(first.category, first.location, today)}`;
  const parts = [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `${n} entro ${formatCalendarDate(d)}`);
  if (undated > 0) parts.push(`${undated} senza data, con la stima`);
  return `${head} Scadenze: ${parts.join(", ")}.`;
}

export interface PiecesResolved {
  /** Pezzi da scrivere nell'evento; assente se non ce ne sono. */
  pieces?: { count: number; each: number; name?: string };
  /** Quantità di un pezzo proposta o scritta, per mostrarla. */
  each?: number;
  /** Falso se `pezzi × grammatura` non torna con la quantità della confezione. */
  agrees?: boolean;
  error?: string;
}

/**
 * Dai pezzi scelti (contatore e grammatura, scritta a mano o calcolata) ai pezzi dell'evento.
 * Meno di due pezzi, o una confezione contata a pezzi, vuol dire nessun pezzo. Se non tornano con la quantità non è un
 * errore: vale la quantità e i pezzi restano una stima.
 */
export function resolvePieces(
  total: Quantity | undefined,
  count: number,
  eachText: string | null,
  name?: string,
): PiecesResolved {
  if (!total || total.unit === "pz" || !Number.isInteger(count) || count < 2) return {};
  let each = Math.round((total.value / count) * 100) / 100;
  if (eachText !== null && eachText.trim() !== "") {
    const read = parseQuantityInUnit(eachText, total.unit);
    if (!read.ok) return { error: read.error };
    each = read.quantity.value;
  }
  return { pieces: { count, each, ...(name ? { name } : {}) }, each, agrees: piecesAgree(total.value, count, each) };
}

/** «1 confezione da 200 g · 2 piadine da 100 g»: dice in chiaro confezioni e pezzi, che non vanno scambiati. */
export function packsSummary(packs: number, one: Quantity | undefined, pieces?: { count: number; each: number; name?: string }): string {
  const oneText = one ? formatQuantity(one) : "";
  const head = `${packs === 1 ? "1 confezione" : `${packs} confezioni`}${oneText ? ` da ${oneText}` : ""}`;
  if (!pieces || !one) return head;
  const name = pieces.name ?? "pezzo";
  const noun = pieces.count === 1 ? name : name === "pezzo" ? "pezzi" : pluralIt(name);
  return `${head} · ${pieces.count} ${noun} da ${formatQuantity({ value: pieces.each, unit: one.unit })}${packs > 1 ? " ciascuna" : ""}`;
}
