// A quale momento e a quale giorno appartiene il pasto che si sta registrando. Una riga di Oggi («Registra» su pranzo,
// o su un giorno passato) porta qui `?momento=lunch&giorno=2026-11-14`; il pasto a mano, da frase e da foto lo leggono
// allo stesso modo e, dopo il salvataggio, si torna a Oggi.
import { addDays, instantOfLocal, momentOfMinutes, type MealKind } from "@/core/diary";
import { isCalendarDate } from "@/core/ledger";
import { formatCalendarDate, relativeDay } from "../format";
import { MEAL_KIND_ORDER, TYPICAL_MEAL_TIME, minutesOfTime } from "../meals";

export interface MealTarget {
  /** Il momento chiesto dall'indirizzo, se valido. */
  kind: MealKind | null;
  /** Un giorno già passato (mai oggi né il futuro), altrimenti `null`. */
  pastDate: string | null;
}

export function parseMealTarget(momento: string | null, giorno: string | null, today: string): MealTarget {
  return {
    kind: MEAL_KIND_ORDER.find((k) => k === momento) ?? null,
    pastDate: giorno !== null && isCalendarDate(giorno) && giorno < today ? giorno : null,
  };
}

/** La coda dell'indirizzo che porta momento e giorno alla pagina successiva ("" se non c'è nulla da portare). */
export function mealTargetQuery(kind: MealKind | null, pastDate: string | null): string {
  const parts = [...(kind ? [`momento=${kind}`] : []), ...(pastDate ? [`giorno=${pastDate}`] : [])];
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** Dove si torna dopo il salvataggio: a Oggi, sul giorno del pasto se è un giorno passato. */
export const todayHref = (pastDate: string | null): string => (pastDate ? `/app?giorno=${pastDate}` : "/app");

/** L'istante del pasto di un giorno passato all'ora scritta (`13:00`); `undefined` se l'ora non è valida. */
export function mealInstant(pastDate: string, time: string, timeZone: string): string | undefined {
  const minutes = minutesOfTime(time);
  return minutes === undefined ? undefined : instantOfLocal(pastDate, minutes, timeZone);
}

/** A Oggi, sul giorno del pasto, con la riga di quella voce in vista (`voce=<id dell'evento>`). */
export function todayEntryHref(pastDate: string | null, eventId: string | undefined): string {
  const base = todayHref(pastDate);
  if (!eventId) return base;
  return `${base}${base.includes("?") ? "&" : "?"}voce=${encodeURIComponent(eventId)}`;
}

/** "08:05" da minuti dalla mezzanotte. */
export function timeOfMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * L'ora proposta per il pasto. Scritta dall'utente: vince sempre. Giorno passato: l'ora tipica del momento. Oggi:
 * adesso, tranne quando il momento scelto non è quello dell'ora e la sua ora tipica è già passata (alle 21 il pranzo
 * propone le 13:00): chi registra il pranzo la sera l'ha mangiato a pranzo, non adesso.
 */
export function proposedMealTime(args: { kind: MealKind; pastDate: string | null; nowMinutes: number; typed?: string | null }): string {
  if (args.typed !== undefined && args.typed !== null) return args.typed;
  const typical = TYPICAL_MEAL_TIME[args.kind];
  if (args.pastDate !== null) return typical;
  const typicalMinutes = minutesOfTime(typical) ?? 0;
  if (momentOfMinutes(args.nowMinutes) !== args.kind && typicalMinutes < args.nowMinutes) return typical;
  return timeOfMinutes(args.nowMinutes);
}

/** Quanto indietro si può registrare un pasto. */
export const MEAL_DAYS_BACK = 60;

/** Il giorno scelto per il pasto: `null` se va bene, altrimenti che cosa non va. */
export function mealDateError(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return "Scegli il giorno del pasto.";
  if (date > today) return "Il pasto non può essere di un giorno che deve ancora venire.";
  if (date < addDays(today, -MEAL_DAYS_BACK)) return `Si può registrare fino a ${MEAL_DAYS_BACK} giorni fa.`;
  return null;
}

/** L'ora scritta: `null` se va bene. Per oggi non può essere più avanti di adesso. */
export function mealTimeError(time: string, isToday: boolean, nowMinutes: number): string | null {
  const minutes = minutesOfTime(time);
  if (minutes === undefined) return "Scrivi l'ora del pasto, per esempio 13:00.";
  if (isToday && minutes > nowMinutes) return "Quest'ora non è ancora arrivata.";
  return null;
}

/** «oggi», «ieri», «3 giorni fa»; più indietro di una settimana, la data. */
export function dayWord(date: string, today: string): string {
  const days = date <= today ? Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000) : 0;
  return days <= 6 ? relativeDay(date, today) : formatCalendarDate(date);
}

/** La riga «Quando»: «oggi · 19:55». */
export const whenText = (date: string, today: string, time: string): string => `${dayWord(date, today)} · ${time}`;

/** Per un pasto di un giorno passato: «Pasto di ieri. Gli alimenti della dispensa si scalano adesso.» */
export function pastDayText(date: string, today: string): string {
  const word = dayWord(date, today);
  const of = /^\d/.test(word) && !word.endsWith("fa") ? `del ${word}` : `di ${word}`;
  return `Pasto ${of}. Gli alimenti della dispensa si scalano adesso.`;
}

const REGISTER_TITLE: Record<MealKind, string> = {
  breakfast: "Registra colazione",
  lunch: "Registra pranzo",
  dinner: "Registra cena",
  snack: "Registra uno spuntino",
};

const APPEND_TITLE: Record<MealKind, string> = {
  breakfast: "Aggiungi a colazione",
  lunch: "Aggiungi a pranzo",
  dinner: "Aggiungi a cena",
  snack: "Aggiungi allo spuntino",
};

const USUAL_HEADING: Record<MealKind, string> = {
  breakfast: "Di solito a colazione",
  lunch: "Di solito a pranzo",
  dinner: "Di solito a cena",
  snack: "Di solito come spuntino",
};

export const registerTitle = (kind: MealKind): string => REGISTER_TITLE[kind];
export const appendTitle = (kind: MealKind): string => APPEND_TITLE[kind];
export const usualHeading = (kind: MealKind): string => USUAL_HEADING[kind];

/** Il pulsante della barra: «Registra cena (2)», «Aggiungi (2)»; senza voci, senza numero. */
export function submitLabel(kind: MealKind, count: number, append: boolean): string {
  const verb = append ? "Aggiungi" : `Registra ${REGISTER_TITLE[kind].replace(/^Registra (uno )?/, "")}`;
  return count > 0 ? `${verb} (${count})` : verb;
}
