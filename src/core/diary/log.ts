// Preparazione del registro: unione per id, validazione e annullamenti.
// Condivisa da `deriveDiary` e da `mealsWithPantry`.

import {
  canonicalStringify,
  isPantryEvent,
  mergeEvents,
  validateEvent,
  type ConsumeEvent,
  type EventLike,
  type ValidationError,
} from "../ledger";
import { isDiaryEvent, validateDiaryEvent } from "./validate";
import { resolveVoids, type VoidFinding, type VoidRef } from "./voids";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isVoid = (e: unknown): boolean => isRecord(e) && e.type === "void";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Errori di un evento noto (dispensa, diario o `void`); i tipi sconosciuti non sono mai validi. */
function knownErrors(e: unknown): ValidationError[] {
  if (isVoid(e) || isDiaryEvent(e)) return validateDiaryEvent(e);
  if (safe(() => isPantryEvent(e), false)) return validateEvent(e);
  return [{ path: "type", code: "invalid_value" }];
}

/** Criterio di validità per l'unione: tra versioni diverse con lo stesso id vince quella valida. */
export function isValidKnownEvent(e: unknown): boolean {
  return safe(() => knownErrors(e).length === 0, false);
}

export interface PreparedLog {
  /** Eventi unici per id, in ordine canonico (at, recordedAt, id). */
  events: unknown[];
  /** Id con versioni diverse e contenuti diversi. */
  conflictIds: string[];
  /** Voci non unibili (senza id, non oggetti, non serializzabili), senza duplicati e in ordine deterministico. */
  rejected: unknown[];
}

export function prepareLog(events: Iterable<unknown>): PreparedLog {
  // Voci che non sono eventi finiscono in `rejected`: il tipo `EventLike` è solo formale.
  const list = [...events] as EventLike[];
  const merged = mergeEvents<EventLike>(list, [], { validate: isValidKnownEvent });
  return {
    events: merged.events as unknown[],
    conflictIds: merged.conflicts.map((c) => c.id).sort(),
    rejected: merged.rejected,
  };
}

/** Errori da riportare per una voce non unibile. */
export function rejectedErrors(item: unknown): ValidationError[] {
  const errors = safe(() => validateDiaryEvent(item), []);
  return errors.length > 0 ? errors : [{ path: "", code: "unserializable" }];
}

export function rejectedKey(item: unknown): string {
  return canonicalStringify(item);
}

export interface VoidsOfLog {
  voided: Set<string>;
  findings: VoidFinding[];
}

/** Risolve gli annullamenti validi presenti nel registro unito. */
export function voidsOfLog(events: readonly unknown[]): VoidsOfLog {
  const refs: VoidRef[] = [];
  const knownIds = new Set<string>();
  for (const e of events) {
    if (!isRecord(e)) continue;
    if (typeof e.id === "string" && e.id.length > 0) knownIds.add(e.id);
    if (e.type === "void" && validateDiaryEvent(e).length === 0) {
      refs.push({ id: e.id as string, targetEventId: e.targetEventId as string });
    }
  }
  const { voided, findings } = resolveVoids(refs, knownIds);
  return { voided, findings };
}

/**
 * `consume` validi e non annullati che portano un `mealId`, in ordine canonico.
 * Serve il registro intero, `void` compresi.
 */
export function activeConsumes(events: Iterable<unknown>): ConsumeEvent[] {
  const log = prepareLog(events);
  const { voided } = voidsOfLog(log.events);
  const out: ConsumeEvent[] = [];
  for (const e of log.events) {
    const c = e as Partial<ConsumeEvent>;
    if (c.type !== "consume" || typeof c.mealId !== "string" || c.mealId === "") continue;
    if (voided.has(c.id as string) || !isValidKnownEvent(e)) continue;
    out.push(e as ConsumeEvent);
  }
  return out;
}

/** Id e dispositivo dei pasti validi e non annullati con questo `mealId`, in ordine canonico. */
export function activeMealEvents(
  events: Iterable<unknown>,
  mealId: string,
): { id: string; deviceId: string }[] {
  const log = prepareLog(events);
  const { voided } = voidsOfLog(log.events);
  const out: { id: string; deviceId: string }[] = [];
  for (const e of log.events) {
    const m = e as { id: string; type?: unknown; mealId?: unknown; deviceId: string };
    if (m.type !== "meal" || m.mealId !== mealId) continue;
    if (voided.has(m.id) || !isValidKnownEvent(e)) continue;
    out.push({ id: m.id, deviceId: m.deviceId });
  }
  return out;
}
