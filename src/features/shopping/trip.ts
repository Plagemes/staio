// In negozio: la spesa in corso, il totale stimato, gli acquisti da registrare e la riconciliazione. Logica pura.
import type { LedgerEvent, Location, PantryState } from "@/core/ledger";
import { validateEvent } from "@/core/ledger";
import {
  estimateCost,
  normalizeName,
  orderForStore,
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
import { formatPrice } from "../format";
import { isFoodCategory } from "../lots";
import { HISTORY_LIMIT } from "./settings";

export function linesOfTrip(
  items: ReadonlyArray<{ id: string; name: string; unit: ShoppingLine["unit"]; quantity: number; item: { key: string; barcode?: string } }>,
  noQuantity: ReadonlyArray<{ id: string; name: string }> = [],
): ShoppingLine[] {
  // senza quantità: nella spesa in corso valgono quantità zero, mostrata come «senza quantità»
  const open: ShoppingLine[] = noQuantity.map((n) => ({ id: n.id, key: n.id.replace(/|qb$/, ""), name: n.name, unit: "pz", quantity: 0 }));
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
