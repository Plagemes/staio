import { voidEvent, type EventFactoryOptions, type VoidEvent } from "../ledger";
import { activeConsumes, activeMealEvents } from "./log";

/**
 * Elimina un pasto: crea gli eventi `void` per il pasto e per tutti i `consume` attivi del
 * libro mastro con lo stesso `mealId`, così la dispensa non resta scalata senza una ragione
 * visibile. Gli eventi sono pronti da scrivere (e si annullano a loro volta, come ogni `void`).
 * Serve il registro intero (diario, dispensa e `void`). Restituisce un elenco vuoto se il pasto
 * non esiste o è già annullato. L'elenco comincia dal pasto, poi i consumi in ordine canonico;
 * tutti gli eventi hanno lo stesso istante.
 */
export function voidMeal(
  mealId: string,
  events: Iterable<unknown>,
  options: EventFactoryOptions = {},
): VoidEvent[] {
  const list = [...events];
  const meals = activeMealEvents(list, mealId);
  if (meals.length === 0) return [];
  const now = (options.now ?? (() => new Date().toISOString()))();
  const factory: EventFactoryOptions = { ...options, now: () => now };
  const targets = [...meals, ...activeConsumes(list).filter((c) => c.mealId === mealId)];
  return targets.map((t) => voidEvent(t, factory));
}
