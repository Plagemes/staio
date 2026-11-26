// «Stasera e domani» e «Questa settimana»: quali momenti e quali righe mostra Piano. Logica pura.
import { addDays, momentOfMinutes, type MealKind } from "@/core/diary";
import { weekDates, type PlannedEntry } from "@/core/plan";
import { MEAL_KIND_LABELS } from "../meals";
import { shortDayNumber } from "./dates";

/** I tre momenti con fascia propria, nell'ordine della giornata. */
const MOMENTS = ["breakfast", "lunch", "dinner"] as const satisfies readonly MealKind[];

/** Da questa ora (minuti) il momento è passato: sono i confini delle fasce di Oggi (`momentOfMinutes`). */
const OVER_FROM: Record<(typeof MOMENTS)[number], number> = { breakfast: 10 * 60 + 30, lunch: 15 * 60 + 30, dinner: 23 * 60 };

export const MAX_TONIGHT_MOMENTS = 4;

export interface TonightMoment {
  date: string;
  meal: MealKind;
  /** «Adesso · pranzo», «Stasera · cena», «Oggi · pranzo», «Domani · colazione». */
  label: string;
  entries: PlannedEntry[];
}

interface Args {
  today: string;
  /** Minuti dalla mezzanotte, ora del telefono. */
  nowMinutes: number;
  /** Le voci del piano di oggi e di domani (le due settimane, se servono). */
  entries: readonly PlannedEntry[];
  /** Il momento è già nel diario (registrato, saltato, mangiato senza dettagli): non è più da fare. */
  done?: (date: string, meal: MealKind) => boolean;
}

const labelOf = (prefix: string, meal: MealKind): string => `${prefix} · ${MEAL_KIND_LABELS[meal].toLowerCase()}`;

/** I momenti da adesso alla fine di domani che hanno voci pianificate: al massimo quattro. */
export function tonightMoments({ today, nowMinutes, entries, done }: Args): TonightMoment[] {
  const tomorrow = addDays(today, 1);
  const current = momentOfMinutes(nowMinutes);
  const out: TonightMoment[] = [];
  const take = (date: string, meal: MealKind, label: string) => {
    const here = entries.filter((e) => e.date === date && e.meal === meal);
    if (here.length === 0 || done?.(date, meal)) return;
    out.push({ date, meal, label, entries: here });
  };
  for (const meal of MOMENTS) {
    if (nowMinutes >= OVER_FROM[meal]) continue;
    take(today, meal, labelOf(meal === "dinner" ? "Stasera" : meal === current ? "Adesso" : "Oggi", meal));
  }
  for (const meal of MOMENTS) take(tomorrow, meal, labelOf("Domani", meal));
  return out.slice(0, MAX_TONIGHT_MOMENTS);
}

/** Il numero di pasti (momenti con almeno una voce) di un insieme di voci. */
export function mealCount(entries: readonly PlannedEntry[]): number {
  return new Set(entries.map((e) => `${e.date}|${e.meal}`)).size;
}

export const mealsText = (n: number): string => (n === 0 ? "niente" : n === 1 ? "1 pasto" : `${n} pasti`);

export interface WeekRow {
  date: string;
  /** «Oggi · 3 pasti», «Mar 18 · niente». */
  text: string;
  meals: number;
}

export interface WeekRows {
  /** Da oggi a domenica. */
  days: WeekRow[];
  /** Pasti pianificati nei giorni già passati di questa settimana. */
  pastMeals: number;
  /** Da oggi a domenica non c'è niente di pianificato. */
  empty: boolean;
}

/** Le righe di «Questa settimana»: un giorno per riga da oggi a domenica, i giorni passati in un numero solo. */
export function weekRows(today: string, weekStart: string, entries: readonly PlannedEntry[]): WeekRows {
  const dates = weekDates(weekStart);
  const days = dates
    .filter((d) => d >= today)
    .map((date): WeekRow => {
      const meals = mealCount(entries.filter((e) => e.date === date));
      const name = date === today ? "Oggi" : date === addDays(today, 1) ? "Domani" : shortDayNumber(date);
      return { date, text: `${name} · ${mealsText(meals)}`, meals };
    });
  return {
    days,
    pastMeals: mealCount(entries.filter((e) => e.date < today)),
    empty: days.every((d) => d.meals === 0),
  };
}

/**
 * Stasera non c'è niente nel piano: la cena di oggi è vuota e non è già nel diario, il momento in corso non ha voci, e la
 * sera non è finita. Allora Piano propone qualche ricetta salvata.
 */
export function wantsIdeas({ today, nowMinutes, entries, moments, done }: Args & { moments: readonly TonightMoment[] }): boolean {
  if (nowMinutes >= OVER_FROM.dinner) return false;
  if (entries.some((e) => e.date === today && e.meal === "dinner")) return false;
  if (done?.(today, "dinner")) return false;
  return !moments.some((m) => m.date === today && m.label.startsWith("Adesso"));
}
