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
 * Una voce scritta a mano non ha un evento suo: si indica con `<id del pasto>-<posizione>`. Il pasto può essere stato
 * corretto nel frattempo: la riga è quella della versione che vale adesso, alla stessa posizione.
 */
function locateFreeItem(
  log: readonly AnyEvent[],
  id: string,
  options: { timeZone: string; today: string; voided: ReadonlySet<string>; maxDaysBack?: number },
): EntryLocation {
  const match = /^(.+)-(\d+)$/.exec(id);
  if (!match) return NOT_FOUND;
  const base = log.find((e) => e.id === match[1]);
  if (!base || base.type !== "meal") return NOT_FOUND;
  const current = currentMeal(base.mealId, log);
  if (!current) return NOT_FOUND;
  const position = Number(match[2]);
  if (position >= (current.meal.items?.length ?? 0)) return NOT_FOUND;
  const date = localDate(current.meal.at, options.timeZone);
  if (date === undefined) return NOT_FOUND;
  const oldest = addDays(options.today, -(options.maxDaysBack ?? REVEAL_MAX_DAYS_BACK));
  if (date > options.today || date < oldest) return NOT_FOUND;
  return { found: true, date, elementId: `${entryElementId(current.meal.id)}-${position}` };
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
  if (!found) return locateFreeItem(log, id, options);
  if (found.type === "void") return NOT_FOUND;
  const event = found.type === "consume" ? liveConsume(log, found, options.voided) : options.voided.has(id) ? undefined : found;
  if (!event) return NOT_FOUND;
  const date = dayOfEntry(event, log, options.timeZone);
  if (date === undefined) return NOT_FOUND;
  const oldest = addDays(options.today, -(options.maxDaysBack ?? REVEAL_MAX_DAYS_BACK));
  if (date > options.today || date < oldest) return NOT_FOUND;
  return { found: true, date, elementId: entryElementId(event.id) };
}

/**
 * Quanto si aspetta una voce che non c'è ancora: chi arriva con `?voce=` subito dopo una scrittura può trovare il
 * registro di prima, e la voce compare alla lettura dopo.
 */
export const ENTRY_WAIT_MS = 2000;
/** Quanto resta «Questa voce non c'è più.», se prima non si cambia giorno e non si scrive niente. */
export const ENTRY_GONE_MS = 8000;

export type EntryVerdict =
  /** La voce c'è: si apre il suo giorno e la si porta in vista. */
  | "show"
  /** Non c'è ancora: si riprova alla prossima lettura del registro, senza dire niente. */
  | "wait"
  /** Non c'è: lo si dice. */
  | "gone"
  /** Il messaggio ha fatto il suo tempo: si toglie. */
  | "over";

/**
 * Che cosa fare di una richiesta `?voce=`. Finché non si è detto niente (`said` assente): la voce trovata si mostra,
 * anche tardi; se manca si aspetta fino a `ENTRY_WAIT_MS` dall'arrivo sulla pagina, poi si dice che non c'è più. Dopo
 * averlo detto, il messaggio resta finché qui non si scrive qualcosa, non si cambia giorno, o non sono passati
 * `ENTRY_GONE_MS`. Un registro che arriva dall'altro telefono non lo toglie.
 */
export function entryVerdict(input: {
  /** `locateEntry` l'ha trovata nel registro che c'è adesso. */
  found: boolean;
  /** Millisecondi dall'arrivo della richiesta sulla pagina. */
  waitedMs: number;
  /**
   * Si è già detto che non c'è più: da quanti millisecondi, e che cosa è successo nel frattempo. `logChanged`: nel
   * registro è entrata una scrittura fatta su questo telefono.
   */
  said?: { forMs: number; logChanged: boolean; dayChanged: boolean };
}): EntryVerdict {
  const { said } = input;
  if (said) return said.logChanged || said.dayChanged || said.forMs >= ENTRY_GONE_MS ? "over" : "gone";
  if (input.found) return "show";
  return input.waitedMs >= ENTRY_WAIT_MS ? "gone" : "wait";
}

/** Quanti giorni prima di `today` sta `date` (entrambi `YYYY-MM-DD`). */
export function daysBefore(today: string, date: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
}

/** Il giorno chiesto nell'indirizzo (`?giorno=YYYY-MM-DD`), come distanza da oggi. Un giorno che non c'è o fuori intervallo vale oggi. */
export function daysBackFromParam(today: string, requested: string | null): number {
  if (!today || !requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return 0;
  const diff = daysBefore(today, requested);
  if (!Number.isFinite(diff) || diff < 0 || diff > REVEAL_MAX_DAYS_BACK) return 0;
  // Un giorno che non esiste (30 febbraio) scivolerebbe sul mese dopo: vale solo se torna uguale a sé stesso
  return addDays(today, -diff) === requested ? diff : 0;
}

/**
 * Quanti giorni indietro mostra Oggi: l'indirizzo è l'unica fonte. Un'eccezione, solo finché l'indirizzo porta ancora
 * la `voce` già trovata (`handledEntry`): vale il giorno di quella voce (`entryDay`), che è lo stesso che l'indirizzo
 * dirà appena la `voce` sarà tolta. Una voce che non c'è non cambia il giorno.
 */
export function viewedDaysBack(input: {
  today: string;
  requestedDay: string | null;
  requestedEntry: string | null;
  handledEntry: string | null;
  entryDay: string | null;
}): number {
  const { today, requestedDay, requestedEntry, handledEntry, entryDay } = input;
  if (requestedEntry !== null && requestedEntry === handledEntry && entryDay !== null) return daysBackFromParam(today, entryDay);
  return daysBackFromParam(today, requestedDay);
}
