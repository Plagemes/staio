import { type ConsumeEvent } from "../ledger";
import type { DiaryMeal, DiaryState } from "./derive";
import { activeConsumes } from "./log";

export interface MealWithPantry extends DiaryMeal {
  /** Data di calendario del pasto nel fuso dello stato. */
  date: string;
  /** Eventi `consume` del libro mastro con lo stesso `mealId`, in ordine canonico. */
  pantryConsumes: ConsumeEvent[];
}

export interface MealPantryReport {
  /** Un elemento per ogni pasto attivo del diario, in ordine di giornata e poi canonico. */
  meals: MealWithPantry[];
  /**
   * Consumi orfani: `consume` validi e non annullati che portano un `mealId` senza pasto attivo
   * nel diario (pasto mai registrato, annullato o non ancora sincronizzato). Ordine canonico.
   */
  orphanConsumes: ConsumeEvent[];
}

/**
 * Unisce a ogni pasto i `consume` del libro mastro con lo stesso `mealId` e riporta a parte
 * quelli senza pasto. Non usa la dispensa calcolata: legge solo gli eventi (validi e non
 * annullati). Per gli annullamenti serve il registro intero, `void` compresi.
 */
export function pantryMealReport(
  diary: DiaryState,
  events: Iterable<unknown>,
): MealPantryReport {
  const byMeal = new Map<string, ConsumeEvent[]>();
  const consumes = activeConsumes(events);
  for (const c of consumes) {
    const list = byMeal.get(c.mealId as string);
    if (list) list.push(c);
    else byMeal.set(c.mealId as string, [c]);
  }

  const meals: MealWithPantry[] = [];
  const known = new Set<string>();
  for (const day of diary.days) {
    for (const meal of day.meals) {
      known.add(meal.mealId);
      meals.push({ ...meal, date: day.date, pantryConsumes: byMeal.get(meal.mealId) ?? [] });
    }
  }
  return { meals, orphanConsumes: consumes.filter((c) => !known.has(c.mealId as string)) };
}

/** I pasti del diario con i loro `consume`; per i consumi orfani vedi `pantryMealReport`. */
export function mealsWithPantry(diary: DiaryState, events: Iterable<unknown>): MealWithPantry[] {
  return pantryMealReport(diary, events).meals;
}
