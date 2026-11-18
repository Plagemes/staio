import { voidEvent, type ConsumeEvent, type EventFactoryOptions, type VoidEvent } from "../ledger";
import { activeMealEvents, familyConsumes, isValidKnownEvent, prepareLog, voidsOfLog } from "./log";

/**
 * Elimina un pasto: crea gli eventi `void` per il pasto e per tutti i `consume` ancora validi del
 * libro mastro che gli appartengono, così la dispensa non resta scalata senza una ragione
 * visibile. Di ogni consumo del pasto si annulla tutta la famiglia (i sostituti scritti da un altro
 * dispositivo e scartati, ma non annullati): annullando solo quello che conta tornerebbe a contare
 * l'altro, senza pasto. Gli eventi sono pronti da scrivere (e si annullano a loro volta, come ogni `void`).
 * Serve il registro intero (diario, dispensa e `void`). Restituisce un elenco vuoto se il pasto
 * non esiste o è già annullato e non gli resta nessun consumo valido: un pasto tolto su un altro
 * dispositivo a cui è rimasto un consumo (in `deriveDiary` compare con `revived`) si toglie
 * annullando quel consumo. L'elenco comincia dal pasto, poi i consumi in ordine canonico; tutti
 * gli eventi hanno lo stesso istante.
 */
export function voidMeal(
  mealId: string,
  events: Iterable<unknown>,
  options: EventFactoryOptions = {},
): VoidEvent[] {
  const list = [...events];
  const meals = activeMealEvents(list, mealId);
  const log = prepareLog(list);
  const voids = voidsOfLog(log.events);
  const consumes = log.events.filter(
    (e): e is ConsumeEvent => (e as { type?: unknown }).type === "consume" && isValidKnownEvent(e),
  );
  const unvoided = (c: ConsumeEvent): boolean => !voids.voided.has(c.id) || voids.superseded.has(c.id);
  const counted = consumes.filter((c) => c.mealId === mealId && !voids.voided.has(c.id));
  // Senza un pasto in vigore c'è qualcosa da togliere solo se il pasto c'è stato e gli resta un consumo valido.
  const existed = log.events.some((e) => {
    const m = e as { type?: unknown; mealId?: unknown };
    return m.type === "meal" && m.mealId === mealId && isValidKnownEvent(e);
  });
  if (meals.length === 0 && (counted.length === 0 || !existed)) return [];
  const now = (options.now ?? (() => new Date().toISOString()))();
  const factory: EventFactoryOptions = { ...options, now: () => now };
  // Le famiglie dei consumi che contano in questo pasto, più i consumi di questo pasto scartati perché il loro
  // sostituto in vigore sta in un altro pasto: quello resta dov'è, ma qui non deve restare niente che possa tornare.
  const wanted = new Set(familyConsumes(list, counted).map((c) => c.id));
  for (const c of consumes) if (c.mealId === mealId && unvoided(c)) wanted.add(c.id);

  const targets = [...meals, ...consumes.filter((c) => wanted.has(c.id))];
  return targets.map((t) => voidEvent(t, factory));
}
