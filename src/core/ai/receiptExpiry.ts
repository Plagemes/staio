// Scadenze dei soli deperibili dello scontrino. Logica pura: la stima viene da `core/expiry` (solo lettura).
// La scelta fatta nella revisione va sull'acquisto stesso (`withExpiryChoices`); `buildExpiryEvents` la scrive invece
// come `updateLot` su un lotto già creato.
import { SHELF_LIFE, addDays, effectiveExpiry, isFoodCategory, toCalendarDate, type FoodCategory } from "@/core/expiry";
import {
  correctLot,
  generateId,
  isCalendarDate,
  validateEvent,
  type Expiry,
  type ExpiryKind,
  type IdGenerator,
  type LedgerEvent,
  type Location,
  type PurchaseEvent,
  type Quantity,
} from "@/core/ledger";

/** Oltre questi giorni in frigo un alimento non è «fresco»: frutta intera, formaggi stagionati, UHT restano fuori. */
const FRESH_FRIDGE_DAYS = 4;

/** Carne, pesce, latticini freschi, verdura a foglia…: tutto ciò che la tabella di `core/expiry` dà come deperibile o che in frigo dura pochi giorni. */
export function needsExpiryReview(category: string | undefined, location: Location): boolean {
  if (!isFoodCategory(category) || location === "freezer") return false;
  const life = SHELF_LIFE[category];
  return life.perishable || life.fridgeDays <= FRESH_FRIDGE_DAYS;
}

/** «Da consumare entro» per i deperibili, «preferibilmente entro» per il resto, come nel modulo di cattura. */
export function labelKindFor(category: string | undefined): ExpiryKind {
  return isFoodCategory(category) && SHELF_LIFE[category].perishable ? "use_by" : "best_before";
}

export interface ExpiryReviewRow {
  lotId: string;
  name: string;
  quantity: Quantity;
  location: Location;
  category: FoodCategory;
  /** Scadenza stimata dalla categoria e dal luogo, `YYYY-MM-DD`. */
  estimate: string;
}

/**
 * Scadenza stimata dalla categoria e dal luogo per un acquisto fatto all'istante `at`, `YYYY-MM-DD`; `undefined` se la
 * riga non è un fresco (stessa regola della revisione) o il motore non la sa stimare.
 */
export function freshExpiryEstimate(input: { category?: string; location: Location; at: string }): string | undefined {
  if (!needsExpiryReview(input.category, input.location)) return undefined;
  return lotExpiryEstimate(input);
}

/** Scadenza stimata dalla categoria e dal luogo per qualunque alimento, fresco o no; `undefined` se non si sa stimare. */
export function lotExpiryEstimate(input: { category?: string; location: Location; at: string }): string | undefined {
  const { category, location, at } = input;
  if (!isFoodCategory(category)) return undefined;
  try {
    return effectiveExpiry({ id: "estimate", labelDateType: "none", purchaseDate: toCalendarDate(at), location, category }, at).date;
  } catch {
    return undefined;
  }
}

/** Una riga per ogni acquisto deperibile appena entrato, nell'ordine dello scontrino. */
export function expiryReviewRows(purchases: readonly PurchaseEvent[]): ExpiryReviewRow[] {
  const rows: ExpiryReviewRow[] = [];
  for (const p of purchases) {
    if (p.expiry || !isFoodCategory(p.category)) continue;
    // una riga che il motore non sa stimare non entra nella revisione
    const estimate = freshExpiryEstimate(p);
    if (estimate === undefined) continue;
    rows.push({ lotId: p.lotId, name: p.productRef, quantity: p.quantity, location: p.location, category: p.category, estimate });
  }
  return rows;
}

/** Data scelta dall'utente per un lotto. `shortcut` = «Tra 3 giorni» e simili (una stima), `label` = la data stampata. */
export interface ExpiryChoice {
  date: string;
  via: "shortcut" | "label";
}

/** La scadenza che una scelta dà al lotto: la data stampata ha il tipo della categoria, un tasto rapido è una stima. */
export function expiryOfChoice(category: string | undefined, choice: ExpiryChoice): Expiry {
  return { date: choice.date, kind: choice.via === "label" ? labelKindFor(category) : "estimated" };
}

export type ExpiryChoicesResult = { ok: true; purchases: PurchaseEvent[] } | { ok: false; errors: Record<string, string> };

/**
 * Le scadenze scelte nella revisione vanno sugli acquisti stessi, prima di scriverli: una sola scrittura per lo scontrino.
 * Stessa regola di `buildExpiryEvents` per il tipo di data. Una data scelta dall'utente vale sempre, anche se la riga
 * poi è passata a una categoria o a un luogo non freschi; chi non sceglie tiene la stima per categoria.
 */
export function withExpiryChoices(purchases: readonly PurchaseEvent[], choices: Readonly<Record<string, ExpiryChoice>>): ExpiryChoicesResult {
  const errors: Record<string, string> = {};
  const out: PurchaseEvent[] = [];
  for (const p of purchases) {
    const choice = Object.hasOwn(choices, p.lotId) ? choices[p.lotId] : undefined;
    if (!choice || p.expiry) {
      out.push(p);
      continue;
    }
    if (!isCalendarDate(choice.date)) {
      errors[p.lotId] = "Scrivi una data valida.";
      continue;
    }
    const dated: PurchaseEvent = { ...p, expiry: expiryOfChoice(p.category, choice) };
    if (validateEvent(dated).length > 0) {
      errors[p.lotId] = "Non riesco a salvare questa scadenza.";
      continue;
    }
    out.push(dated);
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, purchases: out };
}

/** Data di un tasto rapido (l'elenco è quello della scheda del prodotto, passato dal componente) a partire da oggi. */
export const shortcutDate = (today: string, days: number): string => addDays(today, days);

export interface ExpiryContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type ExpiryEventsResult = { ok: true; events: LedgerEvent[] } | { ok: false; errors: Record<string, string> };

/**
 * Un `updateLot` per ogni scelta diversa dalla stima. Una data stampata ha certezza `label` e il tipo della categoria;
 * un tasto rapido è una stima dell'utente (`estimated`).
 */
export function buildExpiryEvents(
  purchases: readonly PurchaseEvent[],
  choices: Readonly<Record<string, ExpiryChoice>>,
  ctx: ExpiryContext,
): ExpiryEventsResult {
  const idGenerator = ctx.idGenerator ?? generateId;
  const errors: Record<string, string> = {};
  const events: LedgerEvent[] = [];
  for (const p of purchases) {
    const choice = choices[p.lotId];
    if (!choice) continue;
    if (!isCalendarDate(choice.date)) {
      errors[p.lotId] = "Scrivi una data valida.";
      continue;
    }
    const produced = correctLot(
      p,
      { expiry: expiryOfChoice(p.category, choice) },
      {
        lot: { productRef: p.productRef, category: p.category, barcode: p.barcode, expiry: undefined, priceCents: p.priceCents, store: p.store },
        now: () => ctx.now,
        deviceId: ctx.deviceId,
        idGenerator,
      },
    );
    // correctLot non sa che la data viene dallo scontrino: si marca solo l'updateLot, senza toccare l'acquisto
    const marked = produced.map((e) =>
      e.type === "updateLot" ? ({ ...e, certainty: choice.via === "label" ? "label" : "estimated", source: "receipt" } as LedgerEvent) : e,
    );
    if (marked.some((e) => validateEvent(e).length > 0)) {
      errors[p.lotId] = "Non riesco a salvare questa scadenza.";
      continue;
    }
    events.push(...marked);
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, events };
}
