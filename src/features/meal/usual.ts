// «Registra pasto»: ciò che si mangia di solito in un momento, i pasti abituali da mostrare e il pasto di ieri da
// ripetere. Logica pura.
import { addDays, type DiaryHabit, type MealKind, type MealWithPantry } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { Quantity } from "@/core/ledger";
import { normalizeSearch } from "../pantry/filter";
import { readPortion, type RememberedPortion } from "../portions";

export interface UsualFood {
  name: string;
  /** La porzione ricordata per quel nome; se non c'è, quanto se n'è mangiato l'ultima volta. */
  quantity?: RememberedPortion;
  /** In casa ce n'è (stesso nome): si mette nel piatto come alimento della dispensa. */
  inPantry: boolean;
}

/** Quanti giorni indietro si guarda. */
export const USUAL_DAYS = 30;
export const USUAL_MAX = 6;

/** Le voci di un pasto, una per nome: i consumi della dispensa (con il nome del loro alimento) e le voci libere. */
function mealFoods(meal: MealWithPantry, names: ReadonlyMap<string, string>): Map<string, { name: string; quantity?: Quantity }> {
  const out = new Map<string, { name: string; quantity?: Quantity }>();
  const add = (name: string, quantity: Quantity) => {
    const key = normalizeSearch(name);
    if (key === "") return;
    const found = out.get(key);
    if (!found) out.set(key, { name: name.trim(), quantity: { ...quantity } });
    else if (found.quantity && found.quantity.unit === quantity.unit) found.quantity.value = Math.round((found.quantity.value + quantity.value) * 1e9) / 1e9;
  };
  for (const c of meal.pantryConsumes) {
    const name = names.get(c.lotId);
    if (name) add(name, c.quantity);
  }
  for (const item of meal.items) add(item.name, item.quantity);
  return out;
}

/**
 * Fino a sei alimenti mangiati più spesso in quel momento negli ultimi 30 giorni (un pasto conta una volta per
 * alimento); a parità, il più recente. Quelli già nel piatto (`exclude`) non compaiono. `memory` è la memoria delle
 * porzioni: la porzione ricordata vince su quella dell'ultima volta.
 */
export function usualFoods(args: {
  meals: readonly MealWithPantry[];
  names: ReadonlyMap<string, string>;
  kind: MealKind;
  today: string;
  memory?: unknown;
  pantryNames: readonly string[];
  exclude?: readonly string[];
  limit?: number;
}): UsualFood[] {
  const from = addDays(args.today, -USUAL_DAYS);
  const stats = new Map<string, { name: string; count: number; lastAt: string; last?: Quantity }>();
  for (const meal of args.meals) {
    if (meal.kind !== args.kind || meal.date < from || meal.date > args.today) continue;
    for (const [key, food] of mealFoods(meal, args.names)) {
      const found = stats.get(key);
      if (!found) stats.set(key, { name: food.name, count: 1, lastAt: meal.at, last: food.quantity });
      else {
        found.count += 1;
        if (meal.at > found.lastAt) Object.assign(found, { name: food.name, lastAt: meal.at, last: food.quantity });
      }
    }
  }
  const excluded = new Set((args.exclude ?? []).map(normalizeSearch));
  const inHouse = new Set(args.pantryNames.map(normalizeSearch));
  return [...stats.entries()]
    .filter(([key]) => !excluded.has(key))
    .sort(([, a], [, b]) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
    .slice(0, args.limit ?? USUAL_MAX)
    .map(([key, s]) => {
      const remembered = s.last ? readPortion(args.memory, s.name, s.last.unit) : undefined;
      const quantity = remembered ?? (s.last ? { value: s.last.value, unit: s.last.unit } : undefined);
      return { name: s.name, ...(quantity ? { quantity } : {}), inPantry: inHouse.has(key) };
    });
}

/** I pasti abituali da mostrare: prima quelli del momento scelto, poi gli altri; fino a `limit`. */
export function habitsFor(habits: readonly DiaryHabit[], kind: MealKind, limit = 3): { shown: DiaryHabit[]; more: boolean } {
  const ordered = [...habits.filter((h) => h.kind === kind), ...habits.filter((h) => h.kind !== kind)];
  return { shown: ordered.slice(0, limit), more: ordered.length > limit };
}

/**
 * Gli eventi di un pasto abituale con il pasto all'istante scelto (un giorno passato, o l'ora del momento): come per
 * `buildMealEvents` con `mealAt`, cambia solo l'evento `meal`; i consumi della dispensa restano di adesso.
 */
export function withMealAt(events: readonly AnyEvent[], at: string | undefined): AnyEvent[] {
  if (!at) return [...events];
  return events.map((e) => (e.type === "meal" ? { ...e, at } : e));
}

/** L'ultimo pasto registrato quel giorno in quel momento («Come ieri»). */
export function lastMealOf(meals: readonly MealWithPantry[], date: string, kind: MealKind): MealWithPantry | undefined {
  let last: MealWithPantry | undefined;
  for (const m of meals) if (m.date === date && m.kind === kind && (!last || m.at >= last.at)) last = m;
  return last;
}

/** «pasta, insalata, pane e altri 2»: gli alimenti di un pasto. */
export function mealFoodsText(meal: MealWithPantry, names: ReadonlyMap<string, string>): string {
  const list = [...mealFoods(meal, names).values()].map((f) => f.name.toLowerCase());
  return list.slice(0, 3).join(", ") + (list.length > 3 ? ` e altri ${list.length - 3}` : "");
}
