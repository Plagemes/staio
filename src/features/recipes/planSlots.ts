// «Metti nel piano»: i pasti tra cui scegliere, da adesso ai prossimi giorni. Logica pura.
import { addDays, type MealKind } from "@/core/diary";
import { MEAL_KIND_LABELS } from "../meals";
import { dayMonth, shortDayNumber, weekdayName } from "../plan/dates";

export interface PlanSlot {
  date: string;
  meal: MealKind;
  /** «Stasera · cena», «Domani · pranzo», «Mar 18 · cena». */
  label: string;
}

/** Da quest'ora (minuti) il momento di oggi è passato: sono i confini delle fasce di Oggi. */
const OVER_FROM: Record<MealKind, number> = { breakfast: 10 * 60 + 30, lunch: 15 * 60 + 30, snack: 23 * 60, dinner: 23 * 60 };

const ORDER: readonly MealKind[] = ["breakfast", "lunch", "snack", "dinner"];

/** Giorni dopo oggi che si possono scegliere. */
export const PLAN_AHEAD_DAYS = 7;

const lower = (meal: MealKind): string => MEAL_KIND_LABELS[meal].toLowerCase();

function labelOf(date: string, today: string, meal: MealKind): string {
  if (date === today) return `${meal === "dinner" ? "Stasera" : "Oggi"} · ${lower(meal)}`;
  if (date === addDays(today, 1)) return `Domani · ${lower(meal)}`;
  return `${shortDayNumber(date)} · ${lower(meal)}`;
}

/**
 * I pasti della struttura del piano da adesso ai prossimi 7 giorni, nell'ordine del tempo. Senza struttura: colazione,
 * pranzo e cena. I momenti di oggi già passati non ci sono.
 */
export function planSlots(args: { today: string; nowMinutes: number; meals: readonly MealKind[] | undefined }): PlanSlot[] {
  const kinds = ORDER.filter((k) => (args.meals && args.meals.length > 0 ? args.meals.includes(k) : k !== "snack"));
  const out: PlanSlot[] = [];
  for (let d = 0; d <= PLAN_AHEAD_DAYS; d++) {
    const date = addDays(args.today, d);
    for (const meal of kinds) {
      if (d === 0 && args.nowMinutes >= OVER_FROM[meal]) continue;
      out.push({ date, meal, label: labelOf(date, args.today, meal) });
    }
  }
  return out;
}

/** La scelta di partenza: il primo pranzo o la prima cena da adesso senza voci; se sono tutti occupati, il primo dei due. */
export function defaultSlot(slots: readonly PlanSlot[], occupied: (slot: PlanSlot) => boolean): PlanSlot | undefined {
  const main = slots.filter((s) => s.meal === "lunch" || s.meal === "dinner");
  return main.find((s) => !occupied(s)) ?? main[0] ?? slots[0];
}

/** «Aggiunto al piano: Pasta al forno, martedì 18, cena.» */
export function plannedMessage(title: string, slot: Pick<PlanSlot, "date" | "meal">): string {
  return `Aggiunto al piano: ${title}, ${weekdayName(slot.date)} ${Number(slot.date.slice(8, 10))}, ${lower(slot.meal)}.`;
}

/** Il giorno in lettere, per chi ha bisogno di dire dove: «18 nov». */
export const slotDay = dayMonth;
