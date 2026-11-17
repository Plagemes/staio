// Modello dei piani alimentari (schemaVersion 1). Il piano è l'intenzione, il registro è ciò che è
// successo: restano separati. Gli eventi usano la stessa busta del libro mastro e lo stesso `void`.

import type { EventBase, Quantity } from "../ledger";
import type { MealKind } from "../diary";
import type { NutrientKey } from "../nutrition";

export const PLAN_EVENT_TYPES = ["planTargets", "planStructure", "planWeek", "dayType"] as const;
export type PlanEventType = (typeof PLAN_EVENT_TYPES)[number];

/** Minimo e massimo giornalieri, ciascuno facoltativo (almeno uno dei due). */
export interface TargetRange {
  min?: number;
  max?: number;
}

/** Energia e nutrienti scelti dall'utente, nell'unità del nutriente, al giorno. */
export type NutrientTargets = Partial<Record<NutrientKey, TargetRange>>;

/**
 * Obiettivi di un tipo di giornata (per esempio "allenamento" o "riposo": nomi scelti dall'utente).
 * Chiave di sostituzione: `dayType`.
 */
export interface PlanTargetsEvent extends EventBase {
  type: "planTargets";
  dayType: string;
  targets: NutrientTargets;
}

export interface PlanMealSlot {
  kind: MealKind;
  /** Orario indicativo, `HH:MM`. */
  time?: string;
}

export interface EatingWindow {
  /** `HH:MM`. */
  from: string;
  /** `HH:MM`. */
  to: string;
}

/**
 * Struttura del piano: un solo evento attivo (vale l'ultimo). `excludedFoods` e `allergens` sono
 * testi liberi dell'utente; `defaultDayType` vale per le date senza un evento `dayType`.
 */
export interface PlanStructureEvent extends EventBase {
  type: "planStructure";
  meals: PlanMealSlot[];
  eatingWindow?: EatingWindow;
  excludedFoods?: string[];
  allergens?: string[];
  defaultDayType?: string;
}

/** Voce pianificata: un alimento con quantità, oppure un riferimento a una ricetta o a una preparazione. */
export type PlannedItem =
  | { kind: "food"; name: string; foodId?: string; quantity: Quantity }
  | { kind: "recipe"; recipeId: string; servings: number }
  | { kind: "prep"; prepId: string; servings: number };

export interface PlannedEntry {
  /** Data di calendario, dentro la settimana dell'evento. */
  date: string;
  meal: MealKind;
  item: PlannedItem;
  note?: string;
}

/**
 * Pasti pianificati di una settimana. `weekStart` è il lunedì (data di calendario). Chiave di
 * sostituzione: `weekStart`; l'evento sostituisce l'intera settimana.
 */
export interface PlanWeekEvent extends EventBase {
  type: "planWeek";
  weekStart: string;
  entries: PlannedEntry[];
}

/** Tipo di giornata valido in una data. Chiave di sostituzione: `date`. */
export interface DayTypeEvent extends EventBase {
  type: "dayType";
  date: string;
  dayType: string;
}

export type PlanEvent = PlanTargetsEvent | PlanStructureEvent | PlanWeekEvent | DayTypeEvent;

export const SERVING_LIMITS = { max: 1000 } as const;
