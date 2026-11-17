// Porzioni usate dopo l'annullamento della loro preparazione.
//
// Scenario: il telefono A annulla la preparazione (gli ingredienti tornano in dispensa) mentre il
// telefono B, non ancora sincronizzato, mangia delle porzioni. Dopo l'unione le porzioni usate
// non hanno più un lotto e gli ingredienti risultano tutti tornati, anche se una parte è stata usata.
// Qui si riconosce il caso e si propone una riparazione, mai applicata da sola.
//
// La riparazione è per differenza. Ogni evento di riparazione dichiara quali usi copre
// (`repair.usedEventIds`) e il suo id dipende da quell'insieme: due dispositivi che riparano gli
// stessi usi producono lo stesso evento (si unisce in uno), chi ripara usi diversi produce eventi
// diversi che si sommano. Un uso coperto da più riparazioni si conta una volta sola: le riparazioni
// ridondanti sono segnalate e `proposePrepRepair` propone di annullarle.

import {
  SCHEMA_VERSION,
  derivePantry,
  mergeEvents,
  validateEvent,
  voidEvent,
  type ConsumeEvent,
  type EventLike,
  type IdGenerator,
  type PantryState,
  type VoidEvent,
} from "../ledger";
import { readOwnedLog, type OwnedLog } from "../plan";
import type { PrepEvent, PrepIngredient } from "./types";
import { isPrepEvent, validatePrepEvent } from "./validate";

/** Prefisso dell'id degli eventi di riparazione. */
export const PREP_REPAIR_ID_PREFIX = "prep-repair:";

/** Campo in più di un `consume` di riparazione (il libro mastro ignora i campi che non conosce). */
export interface PrepRepairMeta {
  /** Evento `prep` annullato che si ripara. */
  prepEventId: string;
  /** Eventi d'uso (consumi, scarti, regali del lotto di porzioni) che la riparazione copre, in ordine. */
  usedEventIds: string[];
}

export type PrepRepairConsume = ConsumeEvent & { repair: PrepRepairMeta };

export interface OrphanUse {
  prepId: string;
  /** Evento `prep` annullato. */
  prepEventId: string;
  batchLotId: string;
  /** Porzioni prodotte dalla preparazione annullata. */
  portions: number;
  /** Eventi di uso del lotto di porzioni ancora attivi: consumi, scarti, regali. */
  usedEventIds: string[];
  consumed: number;
  discarded: number;
  gifted: number;
  /** Porzioni usate in tutto, al massimo `portions`. */
  usedPortions: number;
  /** Ingredienti il cui consumo è annullato: tornati in dispensa per intero. */
  unrestoredIngredients: PrepIngredient[];
  /** Usi già coperti da riparazioni scritte e non annullate (ognuno contato una volta sola). */
  repairedEventIds: string[];
  /** Usi ancora da riparare: la differenza. */
  pendingEventIds: string[];
  /** Porzioni degli usi ancora da riparare. */
  pendingPortions: number;
  /** Eventi di riparazione ridondanti (coprono usi già coperti da un'altra riparazione), da annullare. */
  redundantRepairEventIds: string[];
  /**
   * Eventi di riparazione che coprono almeno un uso poi annullato (anche solo in parte): scalano gli
   * ingredienti di troppo, da annullare. Gli usi ancora attivi che coprivano tornano da riparare.
   */
  staleRepairEventIds: string[];
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Impronta deterministica (cyrb53) di una stringa, in esadecimale. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function repairMetaOf(e: unknown): PrepRepairMeta | undefined {
  if (!isRecord(e) || !isRecord(e.repair)) return undefined;
  const { prepEventId, usedEventIds } = e.repair;
  if (typeof prepEventId !== "string" || !Array.isArray(usedEventIds)) return undefined;
  if (!usedEventIds.every((id) => typeof id === "string")) return undefined;
  return { prepEventId, usedEventIds: [...(usedEventIds as string[])].sort() };
}

interface RepairSet {
  key: string;
  usedEventIds: string[];
  eventIds: string[];
}

/** Dell'insieme delle riparazioni di una preparazione tiene un insieme di usi disgiunti (i più grandi per primi). */
function resolveRepairSets(sets: RepairSet[]): { kept: RepairSet[]; redundant: RepairSet[] } {
  const ordered = [...sets].sort(
    (a, b) => b.usedEventIds.length - a.usedEventIds.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const taken = new Set<string>();
  const kept: RepairSet[] = [];
  const redundant: RepairSet[] = [];
  for (const s of ordered) {
    if (s.usedEventIds.some((id) => taken.has(id))) redundant.push(s);
    else {
      kept.push(s);
      for (const id of s.usedEventIds) taken.add(id);
    }
  }
  return { kept, redundant };
}

/** Trova le preparazioni annullate le cui porzioni risultano usate. Deterministico. */
export function findOrphanUses(
  list: readonly unknown[],
  log: OwnedLog<PrepEvent>,
  pantry: PantryState,
): OrphanUse[] {
  const voided = new Set(pantry.voidedEventIds);
  const batchLots = new Map<string, PrepEvent>();
  for (const e of log.valid) if (log.voided.has(e.id)) batchLots.set(e.batchLotId, e);
  if (batchLots.size === 0) return [];
  const prepEventIds = new Set([...batchLots.values()].map((p) => p.id));

  const useCandidates: EventLike[] = [];
  const repairCandidates: EventLike[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    if (
      (item.type === "consume" || item.type === "discard" || item.type === "gift") &&
      typeof item.lotId === "string" &&
      batchLots.has(item.lotId)
    ) {
      useCandidates.push(item as unknown as EventLike);
    }
    if (item.type === "consume") {
      const meta = repairMetaOf(item);
      if (meta && prepEventIds.has(meta.prepEventId)) repairCandidates.push(item as unknown as EventLike);
    }
  }
  const usable = (e: EventLike): boolean => !voided.has(e.id) && validateEvent(e).length === 0;
  const uses = mergeEvents<EventLike>(useCandidates, []).events.filter(usable) as unknown as {
    id: string;
    type: string;
    lotId: string;
    quantity: { value: number };
  }[];
  const repairs = mergeEvents<EventLike>(repairCandidates, []).events.filter(usable);

  const out: OrphanUse[] = [];
  for (const [lotId, prep] of [...batchLots].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const mine = uses.filter((u) => u.lotId === lotId);
    const sum = (type: string): number =>
      round(mine.filter((u) => u.type === type).reduce((s, u) => s + u.quantity.value, 0));
    const unrestored = prep.ingredients.filter((i) => voided.has(i.consumeEventId));
    if (unrestored.length === 0) continue;

    const sets = new Map<string, RepairSet>();
    for (const r of repairs) {
      const meta = repairMetaOf(r)!;
      if (meta.prepEventId !== prep.id) continue;
      const key = meta.usedEventIds.join("\u0000");
      const cur = sets.get(key) ?? { key, usedEventIds: meta.usedEventIds, eventIds: [] };
      cur.eventIds.push(r.id);
      sets.set(key, cur);
    }
    const all = [...sets.values()];
    // Un uso annullato dopo la riparazione: tutta la riparazione che lo copre è da rifare.
    const stale = all.filter((s) => s.usedEventIds.some((id) => voided.has(id)));
    const { kept, redundant } = resolveRepairSets(all.filter((s) => !stale.includes(s)));
    if (mine.length === 0 && stale.length === 0) continue;
    const useIds = new Set(mine.map((u) => u.id));
    const covered = new Set(kept.flatMap((s) => s.usedEventIds).filter((id) => useIds.has(id)));
    const pending = mine.filter((u) => !covered.has(u.id));

    out.push({
      prepId: prep.prepId,
      prepEventId: prep.id,
      batchLotId: lotId,
      portions: prep.portions,
      usedEventIds: mine.map((u) => u.id).sort(),
      consumed: sum("consume"),
      discarded: sum("discard"),
      gifted: sum("gift"),
      usedPortions: Math.min(prep.portions, round(mine.reduce((s, u) => s + u.quantity.value, 0))),
      unrestoredIngredients: unrestored.map((i) => ({ ...i, quantity: { ...i.quantity } })),
      repairedEventIds: [...covered].sort(),
      pendingEventIds: pending.map((u) => u.id).sort(),
      pendingPortions: round(pending.reduce((s, u) => s + u.quantity.value, 0)),
      redundantRepairEventIds: redundant.flatMap((s) => s.eventIds).sort(),
      staleRepairEventIds: stale.flatMap((s) => s.eventIds).sort(),
    });
  }
  return out;
}

export interface RepairOnActivePrep {
  prepId: string;
  /** Evento `prep` non più annullato. */
  prepEventId: string;
  /** Riparazioni ancora attive: con la preparazione ripristinata scalano gli ingredienti due volte. */
  repairEventIds: string[];
}

/**
 * Riparazioni attive di una preparazione che non è (più) annullata: la preparazione è stata
 * ripristinata dopo la riparazione, e gli ingredienti sono scalati sia dal consumo originale sia dalla stima.
 */
export function findRepairsOnActivePreps(
  list: readonly unknown[],
  log: OwnedLog<PrepEvent>,
  pantry: PantryState,
): RepairOnActivePrep[] {
  const voided = new Set(pantry.voidedEventIds);
  const active = new Map<string, PrepEvent>();
  for (const e of log.valid) if (!log.voided.has(e.id)) active.set(e.id, e);
  const candidates: EventLike[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string" || item.type !== "consume") continue;
    const meta = repairMetaOf(item);
    if (meta && active.has(meta.prepEventId)) candidates.push(item as unknown as EventLike);
  }
  const live = mergeEvents<EventLike>(candidates, []).events.filter(
    (e) => !voided.has(e.id) && validateEvent(e).length === 0,
  );
  const byPrep = new Map<string, string[]>();
  for (const r of live) {
    const id = repairMetaOf(r)!.prepEventId;
    byPrep.set(id, [...(byPrep.get(id) ?? []), r.id]);
  }
  return [...byPrep]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([prepEventId, repairEventIds]) => ({
      prepId: active.get(prepEventId)!.prepId,
      prepEventId,
      repairEventIds: repairEventIds.sort(),
    }));
}

export type PrepRepairSkipReason = "lot_missing" | "unit_mismatch";

export interface PrepRepairOptions {
  deviceId: string;
  /** Per gli `void` delle riparazioni ridondanti. */
  idGenerator?: IdGenerator;
  now?: () => string;
}

export type PrepRepairResult =
  | {
      ok: true;
      prepId: string;
      /** Porzioni usate in tutto e porzioni della preparazione. */
      usedPortions: number;
      portions: number;
      /** Porzioni che questa proposta ripara (la differenza ancora scoperta). */
      repairedPortions: number;
      /** Quota degli ingredienti da riconsumare con questa proposta: porzioni riparate / porzioni prodotte. */
      fraction: number;
      /**
       * Da proporre all'utente: i `consume` con certezza `estimated`, uno per ingrediente, che coprono
       * solo gli usi non ancora riparati. Vuoto se c'è solo da annullare riparazioni ridondanti.
       */
      events: PrepRepairConsume[];
      /** `void` delle riparazioni ridondanti (usi coperti due volte), da proporre insieme. */
      voids: VoidEvent[];
      /** Ingredienti non riparabili (lotto assente o di altra unità). */
      skipped: { lotId: string; reason: PrepRepairSkipReason }[];
      /** Ingredienti il cui lotto non ha più abbastanza: la dispensa scalerà solo il disponibile. */
      shortfalls: { lotId: string; requested: number; available: number }[];
      /** La riparazione è una stima in proporzione, non una misura: va dichiarata all'utente. */
      estimated: true;
    }
  | { ok: false; reason: "not_found" | "nothing_to_repair" };

/**
 * Propone gli eventi che riportano la dispensa vicino al vero dopo `voided_prep_portions_used`:
 * riconsuma da ogni ingrediente la quota corrispondente alle porzioni usate e non ancora riparate
 * (in proporzione alle porzioni prodotte). Non scrive nulla: gli eventi sono da mostrare all'utente.
 * L'id dipende dall'insieme di usi coperti, quindi due dispositivi che riparano gli stessi usi
 * danno lo stesso evento; la quantità non dipende dallo stato della dispensa. Serve il registro intero.
 */
export function proposePrepRepair(
  prepId: string,
  events: Iterable<unknown>,
  options: PrepRepairOptions,
): PrepRepairResult {
  const list = [...events];
  const log = readOwnedLog<PrepEvent>(list, { isOwn: isPrepEvent, validate: validatePrepEvent });
  const pantry = derivePantry(list);
  const orphans = findOrphanUses(list, log, pantry).filter(
    (o) =>
      o.prepId === prepId &&
      (o.pendingEventIds.length > 0 || o.redundantRepairEventIds.length > 0 || o.staleRepairEventIds.length > 0),
  );
  const onActive = findRepairsOnActivePreps(list, log, pantry).filter((r) => r.prepId === prepId);
  if (orphans.length === 0 && onActive.length === 0) {
    const known = log.valid.some((e) => e.prepId === prepId);
    return { ok: false, reason: known ? "nothing_to_repair" : "not_found" };
  }
  const lots = new Map(pantry.lots.map((l) => [l.lotId, l]));
  const prepEvents = new Map(log.valid.map((e) => [e.id, e]));
  const now = (options.now ?? (() => new Date().toISOString()))();

  const out: PrepRepairConsume[] = [];
  const skipped: { lotId: string; reason: PrepRepairSkipReason }[] = [];
  const left = new Map<string, number>();
  const shortfalls = new Map<string, { lotId: string; requested: number; available: number }>();
  let repairedPortions = 0;
  const redundantIds: string[] = onActive.flatMap((r) => r.repairEventIds);
  const takenIds = new Set<string>();
  for (const item of list) if (isRecord(item) && typeof item.id === "string") takenIds.add(item.id);
  for (const orphan of orphans) {
    redundantIds.push(...orphan.redundantRepairEventIds, ...orphan.staleRepairEventIds);
    if (orphan.pendingEventIds.length === 0) continue;
    const used = [...orphan.pendingEventIds].sort();
    const pendingPortions = Math.min(orphan.portions, round(orphan.pendingPortions));
    repairedPortions += pendingPortions;
    const fraction = pendingPortions / orphan.portions;
    const at = prepEvents.get(orphan.prepEventId)!.at;
    const signature = fingerprint(used.join("\u0000"));
    for (const ing of orphan.unrestoredIngredients) {
      const lot = lots.get(ing.lotId);
      if (!lot) {
        skipped.push({ lotId: ing.lotId, reason: "lot_missing" });
        continue;
      }
      if (lot.unit !== ing.quantity.unit) {
        skipped.push({ lotId: ing.lotId, reason: "unit_mismatch" });
        continue;
      }
      const value = round(ing.quantity.value * fraction);
      if (!(value > 0)) continue;
      const available = left.get(lot.lotId) ?? lot.remaining;
      if (value > available) {
        shortfalls.set(lot.lotId, { lotId: lot.lotId, requested: value, available });
      }
      left.set(lot.lotId, round(Math.max(0, available - value)));
      // Se esiste già un evento con questo id (una riparazione annullata) serve una nuova generazione.
      const base = `${PREP_REPAIR_ID_PREFIX}${ing.consumeEventId}:${signature}`;
      let generation = 0;
      while (takenIds.has(generation === 0 ? base : `${base}#${generation}`)) generation++;
      out.push({
        id: generation === 0 ? base : `${base}#${generation}`,
        type: "consume",
        at,
        recordedAt: now,
        deviceId: options.deviceId,
        schemaVersion: SCHEMA_VERSION,
        certainty: "estimated",
        source: "system",
        note: `Stima in proporzione: porzioni di ${orphan.prepId} usate dopo l'annullamento della preparazione`,
        lotId: lot.lotId,
        quantity: { value, unit: ing.quantity.unit },
        repair: { prepEventId: orphan.prepEventId, usedEventIds: used },
      });
    }
  }

  const deviceOf = new Map<string, string>();
  for (const item of list) {
    if (isRecord(item) && typeof item.id === "string" && typeof item.deviceId === "string") {
      deviceOf.set(item.id, item.deviceId);
    }
  }
  const voids = [...new Set(redundantIds)].sort().map((id) =>
    voidEvent(
      { id, deviceId: deviceOf.get(id) ?? options.deviceId },
      { now: () => now, deviceId: options.deviceId, ...(options.idGenerator ? { idGenerator: options.idGenerator } : {}) },
    ),
  );

  const usedPortions = orphans.reduce((s, o) => s + o.usedPortions, 0);
  const portions = orphans.reduce((s, o) => s + o.portions, 0);
  return {
    ok: true,
    prepId,
    usedPortions: round(usedPortions),
    portions,
    repairedPortions: round(repairedPortions),
    fraction: round(Math.min(1, repairedPortions / portions)),
    events: out,
    voids,
    skipped,
    shortfalls: [...shortfalls.values()],
    estimated: true,
  };
}
