// Annullamento di un'intera preparazione: gli ingredienti tornano in dispensa, il lotto di porzioni sparisce.

import { derivePantry, voidEvent, type EventFactoryOptions, type VoidEvent } from "../ledger";
import { derivePreps, getPrep } from "./derive";

export type VoidPrepFailure =
  | "not_found"
  | "already_voided"
  /** Le porzioni sono già state usate (mangiate, buttate, regalate...): serve `force`. */
  | "portions_used";

export type VoidPrepResult =
  | {
      ok: true;
      /** Pronti da scrivere. Il `prep` per primo, poi i consumi, il lotto, il prezzo e (con `force`) gli usi delle porzioni. */
      events: VoidEvent[];
    }
  | { ok: false; reason: VoidPrepFailure; /** Eventi che usano le porzioni, per `portions_used`. */ blocking: string[] };

export interface VoidPrepOptions extends EventFactoryOptions {
  /**
   * Annulla anche gli eventi che hanno usato le porzioni (consumi, scarti, regali, spostamenti).
   * I pasti del diario che le citano restano, senza più il consumo di dispensa.
   */
  force?: boolean;
}

/**
 * Crea i `void` che annullano una preparazione intera: l'evento `prep`, i `consume` degli
 * ingredienti, il `declare` del lotto di porzioni e l'eventuale `updateLot` del costo. Serve il
 * registro intero. Per default rifiuta se le porzioni sono già state usate. Tutti gli eventi hanno
 * lo stesso istante. Annullare a sua volta questi `void` ripristina la preparazione.
 */
export function voidPrep(
  prepId: string,
  events: Iterable<unknown>,
  options: VoidPrepOptions = {},
): VoidPrepResult {
  const list = [...events];
  const pantry = derivePantry(list);
  const state = derivePreps(list, { pantry });
  const prep = getPrep(state, prepId);
  if (!prep) {
    return {
      ok: false,
      reason: state.voidedPrepIds.includes(prepId) ? "already_voided" : "not_found",
      blocking: [],
    };
  }
  if (prep.batchEventIds.length > 0 && options.force !== true) {
    return { ok: false, reason: "portions_used", blocking: [...prep.batchEventIds] };
  }

  const ids = [
    prep.eventId,
    ...prep.ingredients.map((i) => i.consumeEventId),
    prep.batchEventId,
    ...(prep.priceEventId !== undefined ? [prep.priceEventId] : []),
    ...prep.batchEventIds,
  ];

  const voided = new Set(pantry.voidedEventIds);
  const deviceOf = new Map<string, string>();
  for (const e of list as { id?: unknown; deviceId?: unknown }[]) {
    if (typeof e?.id === "string" && typeof e.deviceId === "string") deviceOf.set(e.id, e.deviceId);
  }
  const now = (options.now ?? (() => new Date().toISOString()))();
  const factory: EventFactoryOptions = { ...options, now: () => now };
  const out: VoidEvent[] = [];
  for (const id of new Set(ids)) {
    if (voided.has(id)) continue;
    out.push(voidEvent({ id, deviceId: deviceOf.get(id) ?? options.deviceId ?? "unknown" }, factory));
  }
  return { ok: true, events: out };
}
