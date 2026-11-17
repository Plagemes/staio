// Il registro intero contiene anche gli eventi del diario: qui si separano quelli della dispensa.
import type { AnyEvent } from "@/core/events";
import { isPantryEvent, type LedgerEvent } from "@/core/ledger";

/** Eventi del libro mastro della dispensa (compresi i `void`). */
export function ledgerEventsOf(events: readonly AnyEvent[]): LedgerEvent[] {
  return events.filter((e): e is LedgerEvent => e.type === "void" || isPantryEvent(e));
}
