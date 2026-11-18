// In negozio: la spesa in corso, il totale stimato, gli acquisti da registrare e la riconciliazione. Logica pura.
import type { LedgerEvent, Location, PantryState, Unit } from "@/core/ledger";
import { validateEvent } from "@/core/ledger";
import {
  estimateCost,
  normalizeName,
  orderForStore,
  uncheckItem,
  type CompletedTrip,
  type OrderedItem,
  type PriceBook,
  type Reconciliation,
  type ShoppingLine,
  type TripItem,
  type TripState,
} from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { buildCaptureEvents, type CaptureContext } from "../capture";
import { dayOf, formatPrice } from "../format";
import { suggestCategory } from "../labels";
import { isFoodCategory } from "../lots";
import { itemKey, proposeLocation, withItemDefault, type ItemDefault, type LocationSource } from "../memory/itemDefaults";
import { HISTORY_LIMIT } from "./settings";

export function linesOfTrip(
  items: ReadonlyArray<{ id: string; name: string; unit: ShoppingLine["unit"]; quantity: number; item: { key: string; barcode?: string } }>,
  noQuantity: ReadonlyArray<{ id: string; name: string }> = [],
): ShoppingLine[] {
  // senza quantità: nella spesa in corso valgono quantità zero, mostrata come «senza quantità»
  const open: ShoppingLine[] = noQuantity.map((n) => ({ id: n.id, key: n.id.replace(/\|qb$/, ""), name: n.name, unit: "pz", quantity: 0 }));
  return [...open, ...items.map((v) => ({
    id: v.id,
    key: v.item.key,
    name: v.name,
    unit: v.unit,
    quantity: v.quantity,
    ...(v.item.barcode ? { barcode: v.item.barcode } : {}),
  }))];
}

/** Le voci nell'ordine in cui le hai spuntate le altre volte in questo negozio; le spuntate scendono in fondo. */
export function shoppingOrder(trip: TripState, history: readonly CompletedTrip[]): Array<OrderedItem<TripItem>> {
  const ordered = orderForStore(trip.items, history, trip.store);
  const open = ordered.filter((o) => o.item.checkedAt === undefined);
  const done = ordered
    .filter((o) => o.item.checkedAt !== undefined)
    .sort((a, b) => ((a.item.checkedAt as string) < (b.item.checkedAt as string) ? -1 : 1));
  return [...open, ...done];
}

export interface TripTotals {
  /** Stima del carrello: le voci spuntate con un prezzo osservato, più le fuori lista con prezzo scritto. */
  cartCents: number;
  cartPriced: number;
  cartUnpriced: number;
  /** Stima di tutta la lista. */
  listCents: number;
  listPriced: number;
  listUnpriced: number;
  text: string;
}

export function tripTotals(trip: TripState, book: PriceBook): TripTotals {
  const costOf = (i: TripItem): number | null =>
    i.quantity <= 0
      ? null
      : estimateCost(book, { key: i.key, barcode: i.barcode, unit: i.unit, ...(trip.store ? { store: trip.store } : {}) }, i.quantity)?.cents ?? null;
  let cartCents = 0;
  let cartPriced = 0;
  let cartUnpriced = 0;
  let listCents = 0;
  let listPriced = 0;
  let listUnpriced = 0;
  for (const i of trip.items) {
    const c = costOf(i);
    if (c === null) listUnpriced += 1;
    else {
      listCents += c;
      listPriced += 1;
    }
    if (i.checkedAt !== undefined) {
      if (c === null) cartUnpriced += 1;
      else {
        cartCents += c;
        cartPriced += 1;
      }
    }
  }
  for (const o of trip.offList) {
    if (o.priceCents !== undefined) {
      cartCents += o.priceCents;
      cartPriced += 1;
    } else cartUnpriced += 1;
  }
  const text =
    cartPriced + cartUnpriced === 0
      ? `Lista intera, stima: ${listPriced > 0 ? formatPrice(listCents) : "nessun prezzo osservato"}${listUnpriced > 0 ? ` (${listUnpriced} ${listUnpriced === 1 ? "voce senza prezzo" : "voci senza prezzo"})` : ""}.`
      : `Nel carrello, stima: ${cartPriced > 0 ? formatPrice(cartCents) : "nessun prezzo osservato"}${cartUnpriced > 0 ? ` (${cartUnpriced} ${cartUnpriced === 1 ? "voce senza prezzo non contata" : "voci senza prezzo non contate"})` : ""}.`;
  return { cartCents, cartPriced, cartUnpriced, listCents, listPriced, listUnpriced, text };
}

export function appendHistory(history: readonly CompletedTrip[], record: CompletedTrip): CompletedTrip[] {
  return [...history, record].slice(-HISTORY_LIMIT);
}

/* ---------- registrare gli acquisti ---------- */

export interface PurchaseRow {
  id: string;
  name: string;
  quantityText: string;
  priceText: string;
  /** Chiave di categoria del motore delle scadenze, o vuoto: va chiesta. */
  category: string;
  /** Luogo, o vuoto: va chiesto. */
  location: Location | "";
  fromList: boolean;
}

/** Una riga per ogni voce spuntata e per ogni acquisto fuori lista; categoria e luogo dall'ultimo lotto dello stesso prodotto, se c'è. */
export function purchaseRows(trip: TripState, pantry: PantryState): PurchaseRow[] {
  const known = new Map<string, { category: string; location: Location }>();
  for (const lot of pantry.lots) {
    if (lot.origin !== "purchase" && lot.origin !== "declare") continue;
    known.set(normalizeName(lot.productRef), { category: lot.category && isFoodCategory(lot.category) ? lot.category : "", location: lot.location });
  }
  const rows: PurchaseRow[] = [];
  for (const i of trip.items) {
    if (i.checkedAt === undefined) continue;
    const k = known.get(i.key);
    rows.push({
      id: i.id,
      name: i.name,
      quantityText: i.quantity > 0 ? formatQuantity({ value: i.quantity, unit: i.unit }) : "",
      priceText: "",
      category: k?.category ?? "",
      location: k?.location ?? "",
      fromList: true,
    });
  }
  for (const o of trip.offList) {
    const k = known.get(o.key);
    rows.push({
      id: o.id,
      name: o.name,
      quantityText: o.quantity ? formatQuantity(o.quantity) : "",
      priceText: o.priceCents !== undefined ? (o.priceCents / 100).toFixed(2).replace(".", ",") : "",
      category: k?.category ?? "",
      location: k?.location ?? "",
      fromList: false,
    });
  }
  return rows;
}

/** Da dove viene la categoria proposta: dall'ultimo acquisto dello stesso prodotto, dalla memoria per nome, solo dal nome. */
export type CategorySource = "lot" | "memory" | "name" | "none" | "chosen";

/** Una riga di «Metti in dispensa»: già compilata, con l'origine del luogo e della categoria proposti. */
export interface PutAwayRow extends PurchaseRow {
  locationFrom: LocationSource;
  categoryFrom: CategorySource;
}

/** Una voce che risulta già entrata in dispensa il giorno della spesa, con l'acquisto che lo dice. */
export interface AlreadyRow {
  row: PutAwayRow;
  lot: { createdAt: string; quantity: number; unit: Unit; store?: string };
}

export interface PutAwayState {
  /** Da mettere in dispensa. */
  pending: PutAwayRow[];
  /** Un acquisto dello stesso prodotto registrato nei giorni della spesa: non si ripropone, ma si vede e si può aggiungere lo stesso. */
  already: AlreadyRow[];
}

/** I lotti scritti da «Metti in dispensa», per voce; una forma rovinata vale come nessun segno. */
export function putAwayMarks(trip: TripState): Record<string, string[]> {
  const raw: unknown = trip.putAway;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, lots] of Object.entries(raw)) {
    if (Array.isArray(lots) && lots.every((l) => typeof l === "string")) out[id] = lots;
  }
  return out;
}

/** Segna le voci appena messe in dispensa con i loro lotti. */
export function markPutAway(trip: TripState, lots: Readonly<Record<string, readonly string[]>>): TripState {
  const marks = putAwayMarks(trip);
  for (const [id, ids] of Object.entries(lots)) marks[id] = [...(marks[id] ?? []), ...ids];
  return { ...trip, putAway: marks };
}

/** Toglie i segni di questi lotti («Annulla» dell'acquisto). */
export function unmarkPutAway(trip: TripState, lotIds: readonly string[]): TripState {
  const drop = new Set(lotIds);
  const marks: Record<string, string[]> = {};
  for (const [id, lots] of Object.entries(putAwayMarks(trip))) {
    const kept = lots.filter((l) => !drop.has(l));
    if (kept.length > 0) marks[id] = kept;
  }
  return { ...trip, putAway: marks };
}

/**
 * Le righe di «Metti in dispensa». Una voce segnata con un lotto ancora in dispensa è entrata e non compare più, qualunque
 * sia il tempo passato. Una voce con un acquisto dello stesso prodotto (nome o codice) registrato nei giorni della spesa,
 * in qualunque negozio e a qualunque ora, va in `already`, a meno che si sia scelto di aggiungerla lo stesso (`force`).
 * Quantità dalla lista; luogo dalla memoria per nome, poi dall'ultimo lotto dello stesso prodotto, poi dalla categoria;
 * categoria dall'ultimo lotto, poi dalla memoria, poi dal nome.
 */
export function putAwayRows(
  trip: TripState,
  pantry: PantryState,
  readDefault: (name: string) => ItemDefault | undefined,
  options: { force?: ReadonlySet<string>; timeZone?: string } = {},
): PutAwayState {
  const present = new Set(pantry.lots.map((l) => l.lotId));
  const marks = putAwayMarks(trip);
  const done = new Set(Object.entries(marks).filter(([, lots]) => lots.some((l) => present.has(l))).map(([id]) => id));
  const ours = new Set(Object.values(marks).flat());
  const firstDay = dayOf(trip.startedAt, options.timeZone);
  const lastDay = dayOf(trip.endedAt ?? trip.startedAt, options.timeZone);
  const sameDays = pantry.lots.filter((l) => {
    if (l.origin !== "purchase" || ours.has(l.lotId)) return false;
    const d = dayOf(l.createdAt, options.timeZone);
    return d >= firstDay && d <= lastDay;
  });
  const barcodeOf = new Map(trip.items.map((i) => [i.id, i.barcode]));
  const keyOf = new Map<string, string>([...trip.items.map((i) => [i.id, i.key] as const), ...trip.offList.map((o) => [o.id, o.key] as const)]);

  const out: PutAwayState = { pending: [], already: [] };
  for (const r of purchaseRows(trip, pantry)) {
    if (done.has(r.id)) continue;
    const remembered = readDefault(r.name);
    let categoryFrom: CategorySource = "none";
    let category = "";
    if (r.category) [category, categoryFrom] = [r.category, "lot"];
    else if (isFoodCategory(remembered?.category)) [category, categoryFrom] = [remembered?.category as string, "memory"];
    else {
      const guess = suggestCategory(r.name);
      if (guess) [category, categoryFrom] = [guess, "name"];
    }
    const proposed = proposeLocation({ chosen: null, remembered: remembered?.location ?? (r.location || undefined), category });
    const row: PutAwayRow = { ...r, category, location: proposed.location, locationFrom: proposed.from, categoryFrom };

    const key = keyOf.get(r.id) ?? normalizeName(r.name);
    const barcode = barcodeOf.get(r.id);
    const match = options.force?.has(r.id) ? undefined : sameDays.find((l) => normalizeName(l.productRef) === key || (barcode !== undefined && l.barcode === barcode));
    if (match) {
      out.already.push({ row, lot: { createdAt: match.createdAt, quantity: match.initial, unit: match.unit, ...(match.store ? { store: match.store } : {}) } });
    } else out.pending.push(row);
  }
  return out;
}

/**
 * Gli acquisti di «Metti in dispensa», uno per riga, con i lotti scritti per ciascuna (per segnarle). Le regole e gli
 * errori sono quelli di `buildPurchases`.
 */
export function buildPutAway(
  rows: readonly PurchaseRow[],
  store: string | null,
  ctx: CaptureContext,
): { ok: true; events: LedgerEvent[]; lots: Record<string, string[]> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const events: LedgerEvent[] = [];
  const lots: Record<string, string[]> = {};
  for (const row of rows) {
    const r = buildPurchases([row], store, ctx);
    if (!r.ok) {
      Object.assign(errors, r.errors);
      continue;
    }
    events.push(...r.events);
    lots[row.id] = r.events.flatMap((e) => (e.type === "purchase" ? [e.lotId] : []));
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (events.length === 0) return { ok: false, errors: { _: "Non c'è niente da registrare." } };
  return { ok: true, events, lots };
}

/** La memoria per nome dopo «Metti in dispensa»: categoria, luogo e quantità di ogni riga scritta. */
export function learnDefaults(memory: unknown, rows: readonly PurchaseRow[], now: string): Record<string, ItemDefault> {
  let next: unknown = memory;
  for (const r of rows) {
    next = withItemDefault(next, { name: r.name, category: r.category, ...(r.location !== "" ? { location: r.location } : {}), quantityText: r.quantityText }, now);
  }
  return next as Record<string, ItemDefault>;
}

/** «Annulla»: per i nomi di quelle righe la memoria torna com'era prima (la voce di prima, o nessuna). */
export function restoreDefaults(current: unknown, before: unknown, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = typeof current === "object" && current !== null && !Array.isArray(current) ? { ...current } : {};
  const previous: Record<string, unknown> = typeof before === "object" && before !== null && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  for (const name of names) {
    const key = itemKey(name);
    if (Object.hasOwn(previous, key)) out[key] = previous[key];
    else delete out[key];
  }
  return out;
}

/** «Togli» in «Metti in dispensa»: la voce non è stata comprata (si toglie la spunta) o la fuori lista esce. Niente va in dispensa. */
export function withoutPurchase(trip: TripState, rowId: string): TripState {
  if (trip.items.some((i) => i.id === rowId)) return uncheckItem(trip, rowId);
  if (trip.offList.some((o) => o.id === rowId)) return { ...trip, offList: trip.offList.filter((o) => o.id !== rowId) };
  return trip;
}

export type MissingField = "quantity" | "category";

/** Che cosa manca a una riga per entrare in dispensa: la quantità o la categoria. Il luogo c'è sempre (proposto). */
export function missingOf(row: Pick<PurchaseRow, "quantityText" | "category">): MissingField[] {
  const out: MissingField[] = [];
  if (row.quantityText.trim() === "") out.push("quantity");
  if (!isFoodCategory(row.category)) out.push("category");
  return out;
}

/** Cambiata la categoria a mano, il luogo segue la regola della categoria solo se non l'ha dato la memoria o l'utente. */
export function withCategory(row: PutAwayRow, category: string): PutAwayRow {
  if (row.locationFrom !== "category" && row.locationFrom !== "default") return { ...row, category, categoryFrom: "chosen" };
  const proposed = proposeLocation({ chosen: null, category });
  return { ...row, category, categoryFrom: "chosen", location: proposed.location, locationFrom: proposed.from };
}

/** La categoria viene solo dal nome: va controllata (la scadenza stimata dipende da lei). */
export const needsCheck = (row: Pick<PutAwayRow, "categoryFrom">): boolean => row.categoryFrom === "name";

export type PurchaseResult =
  | { ok: true; events: LedgerEvent[]; message: string }
  | { ok: false; errors: Record<string, string> };

/** Scrive gli acquisti nel negozio indicato. Dove manca la categoria o il luogo, non scrive e lo chiede. */
export function buildPurchases(rows: readonly PurchaseRow[], store: string | null, ctx: CaptureContext): PurchaseResult {
  const errors: Record<string, string> = {};
  const events: LedgerEvent[] = [];
  for (const row of rows) {
    if (!isFoodCategory(row.category)) {
      errors[row.id] = "Scegli una categoria: serve a stimare la scadenza.";
      continue;
    }
    if (row.location === "") {
      errors[row.id] = "Scegli dove lo riponi.";
      continue;
    }
    const r = buildCaptureEvents(
      { name: row.name, quantityText: row.quantityText, location: row.location, category: row.category, expiryKind: "none", expiryDate: "", priceText: row.priceText, alreadyHave: false },
      ctx,
    );
    if (!r.ok) {
      errors[row.id] = r.errors.quantity ?? r.errors.price ?? r.errors.name ?? r.errors.form ?? "Controlla questa voce.";
      continue;
    }
    for (const e of r.events) {
      const withStore = store && e.type === "purchase" ? { ...e, store } : e;
      if (validateEvent(withStore).length > 0) {
        errors[row.id] = "Non riesco a salvare questa voce. Controlla i campi.";
        continue;
      }
      events.push(withStore);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (events.length === 0) return { ok: false, errors: { _: "Non c'è niente da registrare." } };
  return {
    ok: true,
    events,
    message: `Registrati ${events.length} ${events.length === 1 ? "acquisto" : "acquisti"}${store ? ` da ${store}` : ""}.`,
  };
}

/* ---------- riconciliazione ---------- */

export interface ReconcileView {
  boughtText: string;
  missing: string[];
  extra: string[];
  spentText: string;
  notRegistered: string[];
  /** Nessun acquisto registrato nella finestra della spesa: si aspetta lo scontrino. */
  waiting: boolean;
}

export function reconcileView(rec: Reconciliation, nameOf: (itemId: string) => string): ReconcileView {
  // una voce senza quantità risulta sempre "comprata" per il motore: è comprata solo se c'è un acquisto registrato
  const unbought = rec.bought.filter((b) => b.listed === 0 && b.purchased === 0 && b.purchasedOtherUnits.length === 0);
  const bought = rec.bought.filter((b) => !unbought.includes(b));
  const missing = [...rec.missing, ...unbought.map((b) => ({ ...b, shortBy: 0, partial: false }))].map((m) => {
    const what = m.listed === 0 ? "senza quantità, non comprato" : m.partial ? `ne manca ${formatQuantity({ value: m.shortBy, unit: m.unit })} su ${formatQuantity({ value: m.listed, unit: m.unit })}` : `non comprato (${formatQuantity({ value: m.listed, unit: m.unit })})`;
    return `${m.name}: ${what}${m.checked && m.purchased === 0 ? ", spuntato ma senza un acquisto registrato" : ""}`;
  });
  const extra = rec.extra.map(
    (e) => `${e.name}, ${formatQuantity({ value: e.quantity, unit: e.unit })}${e.declaredInTrip ? " (lo avevi aggiunto in negozio)" : ""}${e.costCents === null ? "" : `, ${formatPrice(e.costCents)}`}`,
  );
  const spent = rec.listSpentCents + rec.extraCostCents;
  const unpriced = rec.bought.reduce((s, b) => s + b.lotsWithoutPrice, 0) + rec.missing.reduce((s, b) => s + b.lotsWithoutPrice, 0) + rec.extraUnpriced;
  return {
    boughtText: `${bought.length} ${bought.length === 1 ? "voce comprata" : "voci comprate"} come da lista, ${missing.length} da recuperare, ${rec.extra.length} fuori lista.`,
    missing,
    extra,
    spentText:
      spent > 0
        ? `Speso, dai prezzi registrati: ${formatPrice(spent)}${unpriced > 0 ? ` (${unpriced} ${unpriced === 1 ? "acquisto senza prezzo non contato" : "acquisti senza prezzo non contati"})` : ""}.`
        : "Nessun prezzo registrato per questa spesa.",
    notRegistered: rec.checkedNotRegistered.map(nameOf),
    waiting: rec.purchasesConsidered === 0,
  };
}
