// Dalla dispensa vera all'elenco con identificativi corti che vede il modello, e ritorno. Il modello non vede mai gli id veri.
import { pantryId, type PantryRef } from "@/core/ai/mealPhraseShared";
import type { RecentMeal, RecentMealItem } from "@/core/ai/mealPhrase";
import { addDays, type DiaryMeal } from "@/core/diary";
import type { ConsumeEvent, Lot } from "@/core/ledger";
import type { PantryEntry } from "../lots";

/** Quanti alimenti al massimo si mandano: oltre, la richiesta costa di più e il modello si confonde. */
export const MAX_PANTRY_REFS = 80;

export interface PantryTarget {
  refs: PantryRef[];
  /** Identificativo corto -> lotto vero. */
  lotsById: Map<string, Lot>;
  /** Lotto vero -> identificativo corto (solo i lotti mandati). */
  idByLotId: Map<string, string>;
  /** Alimenti in dispensa che non si sono potuti mandare per il limite. */
  omitted: number;
}

/**
 * Un identificativo (A1, A2…) per ogni lotto attivo con qualcosa dentro, nell'ordine «da mangiare prima»:
 * i lotti che scadono per primi hanno gli id più bassi, e se si supera il limite sono gli ultimi a restare fuori.
 */
export function toPantryTarget(entries: readonly PantryEntry[], max: number = MAX_PANTRY_REFS): PantryTarget {
  const usable = entries.filter((e) => e.lot.status === "active" && e.lot.remaining > 0);
  const kept = usable.slice(0, max);
  const refs: PantryRef[] = [];
  const lotsById = new Map<string, Lot>();
  const idByLotId = new Map<string, string>();
  kept.forEach((entry, index) => {
    const id = pantryId(index);
    refs.push({
      id,
      name: entry.lot.productRef,
      remaining: { value: entry.lot.remaining, unit: entry.lot.unit },
      ...(entry.urgency ? { daysLeft: entry.urgency.daysLeft } : {}),
    });
    lotsById.set(id, entry.lot);
    idByLotId.set(entry.lot.lotId, id);
  });
  return { refs, lotsById, idByLotId, omitted: usable.length - kept.length };
}

/**
 * I pasti degli ultimi giorni in forma compatta, per «come ieri». Ogni alimento preso dalla dispensa porta il suo nome
 * (anche se il lotto è finito) e, se il lotto c'è ancora, l'identificativo corto.
 */
export function recentMealsFor(
  meals: readonly (DiaryMeal & { date: string; pantryConsumes: readonly ConsumeEvent[] })[],
  lots: readonly Lot[],
  target: Pick<PantryTarget, "idByLotId">,
  today: string,
  options: { days?: number; max?: number } = {},
): RecentMeal[] {
  const days = options.days ?? 7;
  const max = options.max ?? 8;
  const since = addDays(today, -days);
  const nameOf = new Map(lots.map((l) => [l.lotId, l.productRef]));
  const recent = meals.filter((m) => m.date >= since && m.date <= today);
  // i più recenti per primi: nel giorno, l'ultimo registrato per primo
  const ordered = recent
    .map((meal, index) => ({ meal, index }))
    .sort((a, b) => (a.meal.date === b.meal.date ? b.index - a.index : a.meal.date < b.meal.date ? 1 : -1))
    .slice(0, max);
  return ordered.map(({ meal }): RecentMeal => {
    const items: RecentMealItem[] = [];
    for (const c of meal.pantryConsumes) {
      const name = nameOf.get(c.lotId);
      if (name === undefined) continue;
      const id = target.idByLotId.get(c.lotId);
      items.push({ name, quantity: { value: c.quantity.value, unit: c.quantity.unit }, ...(id ? { pantryId: id } : {}) });
    }
    for (const item of meal.items) {
      items.push({ name: item.name, quantity: { value: item.quantity.value, unit: item.quantity.unit } });
    }
    return { date: meal.date, kind: meal.kind, items };
  });
}
