import { liveQuery, type Observable } from "dexie";
import { derivePantry, type PantryState } from "@/core/ledger";
import { getAllEvents } from "./eventStore";

export async function getPantry(): Promise<PantryState> {
  return derivePantry(await getAllEvents());
}

/** Osservabile della dispensa: si aggiorna quando cambiano gli eventi. */
export function livePantry(): Observable<PantryState> {
  return liveQuery(() => getPantry());
}
