// Dopo lo scontrino: le scadenze dei soli deperibili. Logica pura: la stima viene da `core/expiry` (solo lettura),
// la scadenza scelta entra nel registro come `updateLot` sul lotto appena creato (l'acquisto non si tocca).
import { SHELF_LIFE, addDays, effectiveExpiry, isFoodCategory, toCalendarDate, type FoodCategory } from "@/core/expiry";
import {
  correctLot,
  generateId,
  isCalendarDate,
  validateEvent,
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

/** Una riga per ogni acquisto deperibile appena entrato, nell'ordine dello scontrino. */
export function expiryReviewRows(purchases: readonly PurchaseEvent[]): ExpiryReviewRow[] {
  const rows: ExpiryReviewRow[] = [];
  for (const p of purchases) {
    if (p.expiry || !isFoodCategory(p.category) || !needsExpiryReview(p.category, p.location)) continue;
    try {
      const estimate = effectiveExpiry(
        { id: p.lotId, labelDateType: "none", purchaseDate: toCalendarDate(p.at), location: p.location, category: p.category },
        p.at,
      ).date;
      rows.push({ lotId: p.lotId, name: p.productRef, quantity: p.quantity, location: p.location, category: p.category, estimate });
    } catch {
      // una riga che il motore non sa stimare non entra nella revisione
    }
  }
  return rows;
}

/** Data scelta dall'utente per un lotto. `shortcut` = «Tra 3 giorni» e simili (una stima), `label` = la data stampata. */
export interface ExpiryChoice {
  date: string;
  via: "shortcut" | "label";
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
    const kind: ExpiryKind = choice.via === "label" ? labelKindFor(p.category) : "estimated";
    const produced = correctLot(
      p,
      { expiry: { date: choice.date, kind } },
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
