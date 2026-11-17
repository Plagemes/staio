// Dal lotto del libro mastro alla voce del motore delle scadenze, e ritorno alla riga di schermata.
import {
  DEFAULT_TIME_ZONE,
  SHELF_LIFE,
  eatFirstOrder,
  toCalendarDate,
  urgency,
  type EffectiveExpiry,
  type ExpiryItem,
  type FoodCategory,
  type Urgency,
} from "@/core/expiry";
import type { Location, Lot } from "@/core/ledger";
import type { ExpiryLevel } from "@/design";
import { expiryTagText, formatCalendarDate } from "./format";

export interface PantryEntry {
  lot: Lot;
  /** Assente solo per un lotto senza categoria riconosciuta e senza data in etichetta. */
  expiry?: EffectiveExpiry;
  urgency?: Urgency;
}

export function isFoodCategory(value: unknown): value is FoodCategory {
  return typeof value === "string" && Object.hasOwn(SHELF_LIFE, value);
}

/**
 * Voce per il motore delle scadenze, o null se il lotto non ha una categoria nota.
 * Un lotto dichiarato ("già in casa") conta come entrato il giorno della dichiarazione:
 * il libro mastro non conosce la vera data d'acquisto.
 */
export function lotToExpiryItem(lot: Lot, timeZone: string = DEFAULT_TIME_ZONE): ExpiryItem | null {
  if (!isFoodCategory(lot.category)) return null;
  try {
    const day = (instant: string | undefined) => (instant ? toCalendarDate(instant, timeZone) : null);
    return {
      id: lot.lotId,
      labelDateType: lot.expiry ? lot.expiry.kind : "none",
      labelDate: lot.expiry?.date ?? null,
      purchaseDate: toCalendarDate(lot.createdAt, timeZone),
      openedDate: day(lot.openedAt),
      location: lot.location,
      frozenDate: day(lot.frozenAt),
      thawedDate: day(lot.thawedAt),
      category: lot.category,
    };
  } catch {
    return null;
  }
}

function labelOnly(lot: Lot, now: string, timeZone: string): PantryEntry {
  if (!lot.expiry) return { lot };
  const expiry: EffectiveExpiry = {
    date: lot.expiry.date,
    basis: "label",
    nature: lot.expiry.kind === "best_before" ? "quality" : "safety",
    certainty: lot.expiry.kind === "estimated" ? "estimated" : "label",
  };
  return { lot, expiry, urgency: urgency(expiry, now, timeZone) };
}

/**
 * Lotti in ordine "da mangiare prima". I lotti senza categoria nota non hanno una stima:
 * seguono gli altri, con la sola data in etichetta se c'è.
 */
export function evaluateLots(
  lots: readonly Lot[],
  now: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): PantryEntry[] {
  const byId = new Map(lots.map((l) => [l.lotId, l]));
  const items: ExpiryItem[] = [];
  const rest: Lot[] = [];
  for (const lot of lots) {
    const item = lotToExpiryItem(lot, timeZone);
    if (item) items.push(item);
    else rest.push(lot);
  }
  const { ordered, rejected } = eatFirstOrder(items, now, timeZone);
  const entries: PantryEntry[] = ordered.map((e) => ({
    lot: byId.get(e.item.id) as Lot,
    expiry: e.expiry,
    urgency: e.urgency,
  }));
  for (const r of rejected) rest.push(byId.get(r.item.id) as Lot);
  const tail = rest
    .map((lot) => labelOnly(lot, now, timeZone))
    .sort((a, b) => (a.expiry?.date ?? "9999-12-31").localeCompare(b.expiry?.date ?? "9999-12-31"));
  return [...entries, ...tail];
}

export function expiryLevel(entry: PantryEntry): ExpiryLevel | undefined {
  switch (entry.urgency?.level) {
    case undefined:
      return undefined;
    case "expired":
    case "today":
    case "tomorrow":
      return "urgent";
    case "past_quality":
    case "soon":
      return "near";
    default:
      return "calm";
  }
}

export interface ExpiryTagView {
  level: ExpiryLevel;
  text: string;
  estimated: boolean;
}

/** Dati per il segno di scadenza; undefined se il lotto non ha alcuna scadenza nota. */
export function expiryTagView(entry: PantryEntry): ExpiryTagView | undefined {
  if (!entry.expiry || !entry.urgency) return undefined;
  return {
    level: expiryLevel(entry) ?? "calm",
    text: expiryTagText(entry.urgency),
    estimated: entry.expiry.certainty === "estimated",
  };
}

/** Voci da segnalare: già scadute, o in scadenza entro tre giorni. */
export function isExpiring(entry: PantryEntry): boolean {
  return entry.urgency !== undefined && entry.urgency.level !== "ok";
}

/** Quanto resta rispetto all'iniziale, da 0 a 100. */
export function levelPercent(lot: Lot): number {
  if (lot.initial <= 0) return 0;
  return Math.min(100, Math.max(0, (lot.remaining / lot.initial) * 100));
}

/** Frase per il pannello: da dove viene la data e se è una stima. */
export function expiryExplanation(entry: PantryEntry): string {
  const { expiry } = entry;
  if (!expiry) return "Nessuna scadenza nota. Scegli una categoria con «Modifica» per avere una stima.";
  const date = formatCalendarDate(expiry.date);
  switch (expiry.basis) {
    case "label":
      if (expiry.certainty === "estimated") return `Stimata: ${date}`;
      return expiry.nature === "quality" ? `Preferibilmente entro ${date}` : `Da consumare entro ${date}`;
    case "estimated":
      return `Stima dalla categoria e dal luogo: entro ${date}`;
    case "opened": {
      const quality = expiry.qualityDate ? ` (in etichetta: ${formatCalendarDate(expiry.qualityDate)})` : "";
      return `Stima dopo l'apertura: entro ${date}${quality}`;
    }
    case "frozen":
      return `Stima in freezer: ${date}`;
    case "thawed":
      return `Stima dopo lo scongelamento: entro ${date}`;
  }
}

/**
 * Scadenza che il motore darebbe dopo lo spostamento: lo stesso calcolo del libro mastro
 * (entrare in freezer fissa `frozenAt`, uscirne fissa `thawedAt`). Serve solo per l'anteprima.
 */
export function previewExpiryAfterMove(
  lot: Lot,
  to: Location,
  now: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): PantryEntry | undefined {
  if (to === lot.location) return undefined;
  const moved: Lot = {
    ...lot,
    location: to,
    frozenAt: to === "freezer" ? now : lot.frozenAt,
    thawedAt: lot.location === "freezer" ? now : lot.thawedAt,
  };
  return evaluateLots([moved], now, timeZone)[0];
}
