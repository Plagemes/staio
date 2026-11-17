// A quale momento e a quale giorno appartiene il pasto che si sta registrando. Una riga di Oggi («Registra» su pranzo,
// o su un giorno passato) porta qui `?momento=lunch&giorno=2026-11-14`; il pasto a mano, da frase e da foto lo leggono
// allo stesso modo e, dopo il salvataggio, si torna a Oggi.
import { instantOfLocal, type MealKind } from "@/core/diary";
import { isCalendarDate } from "@/core/ledger";
import { MEAL_KIND_ORDER, minutesOfTime } from "../meals";

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
