// La storia di un alimento: ciò che la derivazione ha applicato al lotto, una riga per evento, con i campi che
// la derivazione non tiene (il pasto, il luogo, il negozio, i campi corretti). Sola lettura: non cambia la dispensa.
import type { Lot, LotHistoryEntry } from "./derive";
import { LOCATIONS, type Certainty, type DiscardReason, type Location } from "./types";

export type LotStoryKind =
  | "bought"
  | "declared"
  | "eaten"
  | "discarded"
  | "gifted"
  | "opened"
  | "moved"
  | "adjusted"
  | "corrected";

export interface LotStoryRow {
  eventId: string;
  kind: LotStoryKind;
  at: string;
  certainty: Certainty;
  /** Variazione della quantità rimasta, nell'unità dell'alimento (negativa per ciò che esce). */
  quantityDelta?: number;
  /** Quanto ne restava dopo questo evento. */
  remainingAfter?: number;
  /** Per `eaten`: il pasto in cui è stato mangiato, se c'è. */
  mealId?: string;
  /** Per `discarded`. */
  reason?: DiscardReason;
  /** Per `moved`. */
  to?: Location;
  /** Per `bought`: prezzo, negozio e come è entrato (la fonte dell'evento). */
  priceCents?: number;
  store?: string;
  source?: string;
  /** Per `corrected`: i nomi dei campi cambiati (quelli di `LotPatch`). */
  fields?: string[];
  /** La quantità chiesta superava quella rimasta. */
  clamped?: true;
}

type Rec = Record<string, unknown>;

const KIND_OF: Partial<Record<LotHistoryEntry["type"], LotStoryKind>> = {
  purchase: "bought",
  declare: "declared",
  consume: "eaten",
  discard: "discarded",
  gift: "gifted",
  open: "opened",
  move: "moved",
  adjust: "adjusted",
  updateLot: "corrected",
};

/** I campi di `LotPatch`, nell'ordine in cui si elencano. */
const PATCH_FIELDS = ["productRef", "category", "barcode", "expiry", "priceCents", "store"] as const;

// Evita residui come 0.30000000000000004 sommando le variazioni.
const norm = (n: number): number => Math.round(n * 1e9) / 1e9;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function recordsById(events: Iterable<unknown>): Map<string, Rec> {
  const byId = new Map<string, Rec>();
  for (const e of events) {
    try {
      if (isRecord(e) && typeof e.id === "string" && !byId.has(e.id)) byId.set(e.id, e);
    } catch {
      // un evento illeggibile non toglie le altre righe
    }
  }
  return byId;
}

/**
 * La storia di un alimento, dalla riga più recente. Parte da `lot.history` (senza gli eventi annullati e senza i
 * consumi sostituiti da una correzione, nell'ordine in cui la derivazione li ha applicati) e per ogni voce prende
 * dall'evento con quell'id i campi in più. Un evento che non si trova nel registro dà comunque la riga.
 * Un tipo di evento che la storia non conosce si salta.
 */
export function buildLotStory(lot: Lot, events: Iterable<unknown>): LotStoryRow[] {
  const byId = recordsById(events);
  const rows: LotStoryRow[] = [];
  let remaining = lot.initial;

  for (const entry of lot.history) {
    const kind = KIND_OF[entry.type];
    if (kind === undefined) continue;
    const event = byId.get(entry.eventId);

    let quantityDelta = entry.quantityDelta;
    if (kind === "bought" || kind === "declared") {
      // la quantità di partenza è quella della creazione che vale adesso (una riscrittura sostituisce la prima)
      quantityDelta = lot.initial;
      remaining = lot.initial;
    } else if (quantityDelta !== undefined) {
      remaining = norm(remaining + quantityDelta);
    }

    const row: LotStoryRow = {
      eventId: entry.eventId,
      kind,
      at: entry.at,
      certainty: entry.certainty,
      ...(quantityDelta !== undefined ? { quantityDelta } : {}),
      remainingAfter: remaining,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.clamped ? { clamped: true as const } : {}),
    };

    if (kind === "eaten") {
      const mealId = text(event?.mealId);
      if (mealId !== undefined) row.mealId = mealId;
    } else if (kind === "moved") {
      const to = event?.to;
      if (typeof to === "string" && (LOCATIONS as readonly string[]).includes(to)) row.to = to as Location;
    } else if (kind === "bought" || kind === "declared") {
      const source = text(event?.source);
      if (source !== undefined) row.source = source;
      if (kind === "bought" && lot.origin === "purchase") {
        // solo ciò che vale adesso: una correzione può aver cambiato o tolto prezzo e negozio
        if (lot.priceCents !== undefined) row.priceCents = lot.priceCents;
        if (lot.store !== undefined) row.store = lot.store;
      }
    } else if (kind === "corrected") {
      const patch = event?.patch;
      if (isRecord(patch)) row.fields = PATCH_FIELDS.filter((f) => patch[f] !== undefined);
    }
    rows.push(row);
  }

  return rows.reverse();
}
