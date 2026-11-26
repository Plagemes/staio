// Da quale pasto parte «Aggiungi». Logica pura.
import { momentOfMinutes, type MealKind } from "@/core/diary";
import type { PlannedEntry } from "@/core/plan";
import { MAIN_MEALS } from "../meals";

/** Il momento in corso o, tra un momento e l'altro, il prossimo (stesse fasce di Oggi). Dopo le 23 non ce n'è più. */
export function currentOrNextMoment(nowMinutes: number): MealKind | undefined {
  const moment = momentOfMinutes(nowMinutes);
  if (moment !== "snack") return moment;
  if (nowMinutes < 5 * 60) return "breakfast";
  if (nowMinutes < 18 * 60 + 30) return "dinner";
  return undefined;
}

interface Args {
  date: string;
  today: string;
  nowMinutes: number;
  /** I pasti della struttura, nell'ordine; vuoto se il piano non ha una struttura. */
  meals: readonly MealKind[];
  /** Le voci del piano (di qualunque giorno): contano quelle di `date`. */
  entries: readonly PlannedEntry[];
}

/**
 * Giorno futuro: il primo pasto della struttura senza voci, altrimenti il primo.
 * Oggi: il pasto del momento in corso o il prossimo (il primo se la sera è finita).
 * Giorno passato: il primo. Senza struttura: pranzo.
 */
export function startMeal({ date, today, nowMinutes, meals, entries }: Args): MealKind {
  const list = meals.length > 0 ? meals : undefined;
  if (!list) return "lunch";
  if (date > today) {
    const taken = new Set(entries.filter((e) => e.date === date).map((e) => e.meal));
    return list.find((m) => !taken.has(m)) ?? list[0];
  }
  if (date === today) {
    const moment = currentOrNextMoment(nowMinutes);
    if (moment !== undefined && list.includes(moment) && (MAIN_MEALS as readonly MealKind[]).includes(moment)) return moment;
    if (moment !== undefined) {
      // il momento non è nella struttura: il primo pasto della struttura che viene dopo
      const order: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];
      const after = list.find((m) => order.indexOf(m) >= order.indexOf(moment));
      if (after) return after;
    }
  }
  return list[0];
}
