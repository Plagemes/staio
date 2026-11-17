// Stato derivato delle preparazioni: porzioni rimaste, mangiate, buttate, regalate.

import {
  derivePantry,
  type Expiry,
  type Location,
  type Lot,
  type PantryState,
  type ValidationError,
} from "../ledger";
import { readOwnedLog, type ExistingPortions, type LotRef } from "../plan";
import { findOrphanUses, findRepairsOnActivePreps, type OrphanUse } from "./orphans";
import type { PrepEvent, PrepIngredient } from "./types";
import { isPrepEvent, validatePrepEvent } from "./validate";

export type PrepAnomalyCode =
  | "invalid_event"
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle"
  /** Due preparazioni con lo stesso `prepId`: conta la prima nell'ordine canonico. */
  | "duplicate_prep"
  /** Il lotto di porzioni non esiste nella dispensa (annullato o non ancora sincronizzato). */
  | "batch_lot_missing"
  /**
   * La preparazione è annullata (ingredienti tornati in dispensa) ma il suo lotto di porzioni è
   * stato usato da eventi non ancora sincronizzati al momento dell'annullamento. I dati sono in
   * `orphanUse`; `proposePrepRepair` compone gli eventi da proporre all'utente.
   */
  | "voided_prep_portions_used"
  /**
   * Due riparazioni (vedi `proposePrepRepair`) coprono lo stesso uso: contato una volta sola, ma la
   * dispensa è scalata due volte. `orphanUse.redundantRepairEventIds` sono da annullare.
   */
  | "prep_repair_overlap"
  /**
   * Una riparazione copre un uso poi annullato (anche solo in parte): scala gli ingredienti di
   * troppo. `orphanUse.staleRepairEventIds` sono da annullare; `proposePrepRepair` ripropone il resto.
   */
  | "prep_repair_stale_use"
  /**
   * La preparazione è stata ripristinata dopo una riparazione: le riparazioni ancora attive
   * (`repairEventIds`) scalano gli ingredienti due volte e sono da annullare.
   */
  | "prep_repair_on_active_prep";

export interface PrepAnomaly {
  code: PrepAnomalyCode;
  eventId?: string;
  prepId?: string;
  errors?: ValidationError[];
  /** Per le anomalie delle riparazioni di una preparazione annullata. */
  orphanUse?: OrphanUse;
  /** Per `prep_repair_on_active_prep`. */
  repairEventIds?: string[];
}

export interface PrepCostRecord {
  /** Somma dei costi noti, centesimi interi; assente se nessun ingrediente aveva un costo. */
  totalCents?: number;
  perPortionCents?: number;
  /** Almeno un ingrediente senza costo: i valori sono minimi. */
  partial: boolean;
  /** Ingredienti (lotti) senza costo noto. */
  unknownLotIds: string[];
}

export interface PrepRecord {
  prepId: string;
  title: string;
  recipeId?: string;
  /** Evento `prep` che la definisce. */
  eventId: string;
  /** Quando si è cucinato. */
  cookedAt: string;
  batchLotId: string;
  /** Evento `declare` che crea il lotto e, se c'è, `updateLot` del costo. */
  batchEventId: string;
  priceEventId?: string;
  /** Porzioni prodotte. */
  portions: number;
  /** Porzioni ancora nel lotto. */
  remaining: number;
  /** Porzioni mangiate (consumi del lotto). */
  eaten: number;
  discarded: number;
  gifted: number;
  /** `finished` quando le porzioni sono finite; `batch_missing` se il lotto non c'è. */
  status: "active" | "finished" | "batch_missing";
  /** Luogo attuale del lotto e scadenza attuale, dal lotto. */
  location?: Location;
  expiry?: Expiry;
  ingredients: PrepIngredient[];
  cost: PrepCostRecord;
  cookedPerRaw?: number;
  /** Eventi del lotto di porzioni oltre alla creazione e al prezzo (consumi, scarti...), in ordine di applicazione. */
  batchEventIds: string[];
}

export interface PrepState {
  /** Preparazioni attive (non annullate), per data di cottura e poi `prepId`. */
  preps: PrepRecord[];
  /** `prepId` delle preparazioni il cui evento `prep` è annullato. */
  voidedPrepIds: string[];
  anomalies: PrepAnomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

export interface DerivePrepOptions {
  /** Dispensa già calcolata dallo stesso registro, per non rifarla. */
  pantry?: PantryState;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Stato delle preparazioni dal registro intero. Deterministico e indipendente dall'ordine.
 * Le porzioni vengono dal lotto di porzioni calcolato dalla dispensa: mangiare una porzione è un
 * normale `consume` di quel lotto.
 */
export function derivePreps(
  events: Iterable<unknown>,
  options: DerivePrepOptions = {},
): PrepState {
  const list = [...events];
  const log = readOwnedLog<PrepEvent>(list, { isOwn: isPrepEvent, validate: validatePrepEvent });
  const pantry = options.pantry ?? derivePantry(list);
  const lots = new Map<string, Lot>(pantry.lots.map((l) => [l.lotId, l]));

  const anomalies: PrepAnomaly[] = [];
  for (const bad of log.invalid) {
    anomalies.push({
      code: "invalid_event",
      ...(bad.eventId !== undefined ? { eventId: bad.eventId } : {}),
      errors: bad.errors,
    });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });
  for (const f of log.voidFindings) {
    anomalies.push({ code: f.code, eventId: f.eventId });
  }

  const voidedPrepIds = new Set<string>();
  const seen = new Set<string>();
  const preps: PrepRecord[] = [];
  // `valid` è in ordine canonico: per un `prepId` ripetuto conta il primo non annullato.
  for (const e of log.valid) {
    if (log.voided.has(e.id)) {
      voidedPrepIds.add(e.prepId);
      continue;
    }
    if (seen.has(e.prepId)) {
      anomalies.push({ code: "duplicate_prep", eventId: e.id, prepId: e.prepId });
      continue;
    }
    seen.add(e.prepId);

    const lot = lots.get(e.batchLotId);
    if (!lot) anomalies.push({ code: "batch_lot_missing", eventId: e.id, prepId: e.prepId });
    const own = new Set([e.batchEventId, ...(e.priceEventId ? [e.priceEventId] : [])]);
    const unknownLotIds = e.ingredients.filter((i) => i.costCents === undefined).map((i) => i.lotId);
    preps.push({
      prepId: e.prepId,
      title: e.title,
      ...(e.recipeId !== undefined ? { recipeId: e.recipeId } : {}),
      eventId: e.id,
      cookedAt: e.at,
      batchLotId: e.batchLotId,
      batchEventId: e.batchEventId,
      ...(e.priceEventId !== undefined ? { priceEventId: e.priceEventId } : {}),
      portions: e.portions,
      remaining: lot?.remaining ?? 0,
      eaten: lot?.consumed ?? 0,
      discarded: lot?.discarded ?? 0,
      gifted: lot?.gifted ?? 0,
      status: !lot ? "batch_missing" : lot.status === "finished" ? "finished" : "active",
      ...(lot ? { location: lot.location } : {}),
      ...(lot?.expiry ? { expiry: { ...lot.expiry } } : {}),
      ingredients: e.ingredients.map((i) => ({ ...i, quantity: { ...i.quantity } })),
      cost: {
        ...(e.costCents !== undefined ? { totalCents: e.costCents } : {}),
        ...(e.costCents !== undefined ? { perPortionCents: Math.round(e.costCents / e.portions) } : {}),
        partial: e.costPartial === true || unknownLotIds.length > 0,
        unknownLotIds: [...new Set(unknownLotIds)].sort(),
      },
      ...(e.cookedPerRaw !== undefined ? { cookedPerRaw: e.cookedPerRaw } : {}),
      batchEventIds: (lot?.history ?? []).map((h) => h.eventId).filter((id) => !own.has(id)),
    });
  }
  for (const orphan of findOrphanUses(list, log, pantry)) {
    const base = { eventId: orphan.prepEventId, prepId: orphan.prepId, orphanUse: orphan };
    if (orphan.pendingEventIds.length > 0) anomalies.push({ code: "voided_prep_portions_used", ...base });
    if (orphan.redundantRepairEventIds.length > 0) anomalies.push({ code: "prep_repair_overlap", ...base });
    if (orphan.staleRepairEventIds.length > 0) anomalies.push({ code: "prep_repair_stale_use", ...base });
  }
  for (const r of findRepairsOnActivePreps(list, log, pantry)) {
    anomalies.push({
      code: "prep_repair_on_active_prep",
      eventId: r.prepEventId,
      prepId: r.prepId,
      repairEventIds: r.repairEventIds,
    });
  }
  preps.sort((a, b) => cmp(a.cookedAt, b.cookedAt) || cmp(a.prepId, b.prepId));
  anomalies.sort((a, b) =>
    cmp(
      [a.code, a.eventId ?? "", a.prepId ?? ""].join("\u0000"),
      [b.code, b.eventId ?? "", b.prepId ?? ""].join("\u0000"),
    ),
  );

  return {
    preps,
    voidedPrepIds: [...voidedPrepIds].sort(cmp),
    anomalies,
    voidedEventIds: [...log.voided].sort(cmp),
  };
}

export function getPrep(state: PrepState, prepId: string): PrepRecord | undefined {
  return state.preps.find((p) => p.prepId === prepId);
}

/** Lotto di porzioni → prodotto e preparazione: serve a `compareWeek` per riconoscere i consumi. */
export function prepLotRefs(state: PrepState): Map<string, LotRef> {
  return new Map(
    state.preps.map((p) => [p.batchLotId, { productRef: p.title, prepId: p.prepId }]),
  );
}

/**
 * Porzioni già pronte, da passare ai fabbisogni e al programma di preparazione: le porzioni rimaste
 * dei lotti attivi, con l'ultimo giorno buono (la scadenza del lotto).
 */
export function existingPortionsOf(state: PrepState): ExistingPortions[] {
  return state.preps
    .filter((p) => p.status === "active" && p.remaining > 0)
    .map((p) => ({
      prepId: p.prepId,
      remaining: p.remaining,
      ...(p.expiry ? { goodUntil: p.expiry.date } : {}),
      lotId: p.batchLotId,
    }));
}
