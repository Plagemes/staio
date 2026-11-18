// `/app?voce=<id evento>`: in quale giorno del diario sta quella voce e quale elemento cercare. Logica pura; lo
// scorrimento e l'evidenza li fa la schermata.
import { addDays, currentMeal, familyConsumes, localDate } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { supersededConsumes, type ConsumeEvent } from "@/core/ledger";

/** Fin dove arriva il diario di Oggi: le frecce non vanno oltre. */
export const REVEAL_MAX_DAYS_BACK = 60;

/** L'`id` dell'elemento di una riga del diario: `voce-<id evento>`; le voci libere di un pasto aggiungono `-<posizione>`. */
export const entryElementId = (eventId: string): string => `voce-${eventId}`;

export type EntryLocation = { found: true; date: string; elementId: string } | { found: false };

const NOT_FOUND: EntryLocation = { found: false };

/** Il giorno di calendario in cui il diario mostra l'evento. */
function dayOfEntry(event: AnyEvent, log: readonly AnyEvent[], timeZone: string): string | undefined {
  if (event.type === "mealDeclaration") return event.date;
  // un consumo che sta in un pasto si legge nel giorno del pasto, anche se è stato scritto in un altro momento
  if (event.type === "consume" && typeof event.mealId === "string" && event.mealId !== "") {
    const meal = currentMeal(event.mealId, log);
    if (meal) return localDate(meal.meal.at, timeZone);
  }
  return localDate(event.at, timeZone);
}

/**
 * Il consumo che oggi vale al posto di `event`: lui stesso, oppure, se è stato corretto (sostituito o battuto da una
 * correzione parallela), il consumo vivo della stessa famiglia. Nessuno se la voce è stata tolta.
 */
function liveConsume(log: readonly AnyEvent[], event: ConsumeEvent, voided: ReadonlySet<string>): ConsumeEvent | undefined {
  const superseded = supersededConsumes(log, voided);
  const counts = (c: ConsumeEvent) => !voided.has(c.id) && !superseded.has(c.id);
  if (counts(event)) return event;
  return familyConsumes(log, [event]).find(counts);
}

/**
 * Dove sta nel diario l'evento `eventId`: il giorno (tra oggi e `REVEAL_MAX_DAYS_BACK` giorni fa) e l'`id` della riga.
 * Un consumo corretto porta alla voce che lo ha sostituito. Non c'è se l'evento non esiste, è un annullamento, è stato
 * annullato o cade fuori da quei giorni.
 */
export function locateEntry(
  log: readonly AnyEvent[],
  eventId: string,
  options: { timeZone: string; today: string; voided: ReadonlySet<string>; maxDaysBack?: number },
): EntryLocation {
  const id = eventId.trim();
  if (id === "") return NOT_FOUND;
  const found = log.find((e) => e.id === id);
  if (!found || found.type === "void") return NOT_FOUND;
  const event = found.type === "consume" ? liveConsume(log, found, options.voided) : options.voided.has(id) ? undefined : found;
  if (!event) return NOT_FOUND;
  const date = dayOfEntry(event, log, options.timeZone);
  if (date === undefined) return NOT_FOUND;
  const oldest = addDays(options.today, -(options.maxDaysBack ?? REVEAL_MAX_DAYS_BACK));
  if (date > options.today || date < oldest) return NOT_FOUND;
  return { found: true, date, elementId: entryElementId(event.id) };
}

/** Quanti giorni prima di `today` sta `date` (entrambi `YYYY-MM-DD`). */
export function daysBefore(today: string, date: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
}
