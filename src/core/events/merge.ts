import { mergeEvents, type MergeConflict, type MergeResult } from "../ledger";
import { validateAnyEvent, type AnyEvent } from "./validate";

export type AllMergeConflict = MergeConflict<AnyEvent>;
export type AllMergeResult = MergeResult<AnyEvent>;

const isValid = (e: unknown): boolean => validateAnyEvent(e).length === 0;

/**
 * Unione per `id` di registri con eventi di dispensa e di diario: idempotente,
 * commutativa e associativa. Tra versioni diverse con lo stesso id vince quella valida
 * secondo `validateAnyEvent`, poi le regole del libro mastro.
 */
export function mergeAllEvents(
  a: readonly AnyEvent[],
  b: readonly AnyEvent[],
): AllMergeResult {
  return mergeEvents<AnyEvent>(a, b, { validate: isValid });
}
