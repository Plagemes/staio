// Modello dati del diario personale (schemaVersion 1).
// Usa la stessa busta degli eventi del libro mastro e lo stesso `void` per annullare.

import type { Certainty, EventBase, Quantity } from "../ledger";

export const DIARY_EVENT_TYPES = [
  "meal",
  "untrackedMeal",
  "water",
  "drink",
  "weight",
  "mood",
  "symptom",
  "supplement",
  "habit",
] as const;
export type DiaryEventType = (typeof DIARY_EVENT_TYPES)[number];

export const MEAL_KINDS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealKind = (typeof MEAL_KINDS)[number];

export const SYMPTOM_KINDS = ["digestion", "energy", "sleep", "other"] as const;
export type SymptomKind = (typeof SYMPTOM_KINDS)[number];

/** Voce di un pasto non presa dalla dispensa. */
export interface MealItem {
  name: string;
  /** Quantità in unità base (g, ml, pz). */
  quantity: Quantity;
  certainty: Certainty;
  /**
   * Alimento della tabella nutrizionale scelto dall'utente (es. "pasta-semola-secca").
   * Il diario non conosce la tabella: lo conserva e basta. Minuscolo, cifre e trattini,
   * al massimo `FOOD_ID_MAX_LENGTH` caratteri; una stringa vuota vale come assente.
   */
  foodId?: string;
}

export const FOOD_ID_MAX_LENGTH = 80;

/**
 * Un pasto. Le voci prese dalla dispensa non stanno qui: sono eventi `consume`
 * del libro mastro che portano lo stesso `mealId`.
 */
export interface MealEvent extends EventBase {
  type: "meal";
  mealId: string;
  kind: MealKind;
  title?: string;
  items?: MealItem[];
  /** Presente se il pasto nasce da un pasto abituale. */
  habitId?: string;
}

/** Un pasto c'è stato ma non è stato tracciato: un vuoto non va letto come digiuno. */
export interface UntrackedMealEvent extends EventBase {
  type: "untrackedMeal";
  kind: MealKind;
}

export interface WaterEvent extends EventBase {
  type: "water";
  ml: number;
}

/** Bevanda con sostanze da tenere d'occhio. */
export interface DrinkEvent extends EventBase {
  type: "drink";
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
}

export interface WeightEvent extends EventBase {
  type: "weight";
  kg: number;
}

export interface MoodEvent extends EventBase {
  type: "mood";
  /** Da 1 a 5. */
  score: number;
  tags?: string[];
}

export interface SymptomEvent extends EventBase {
  type: "symptom";
  kind: SymptomKind;
  /** Da 1 a 5. */
  score: number;
  label?: string;
}

export interface SupplementEvent extends EventBase {
  type: "supplement";
  name: string;
  /** Dose a testo libero. */
  dose?: string;
  /** Se scala una scorta in dispensa. */
  lotId?: string;
}

/**
 * Definizione di un pasto abituale. Un evento `habit` successivo con lo stesso `habitId`
 * lo sostituisce (vale l'ultimo per `recordedAt`, poi `id`); `archived: true` lo ritira.
 */
export interface HabitEvent extends EventBase {
  type: "habit";
  habitId: string;
  title: string;
  kind: MealKind;
  /** Ora abituale, `HH:MM`. */
  usualTime?: string;
  items: MealItem[];
  archived?: boolean;
}

export type DiaryEvent =
  | MealEvent
  | UntrackedMealEvent
  | WaterEvent
  | DrinkEvent
  | WeightEvent
  | MoodEvent
  | SymptomEvent
  | SupplementEvent
  | HabitEvent;

export const DEFAULT_TIME_ZONE = "Europe/Rome";

/**
 * @deprecated Non più usata: un giorno è completo se ha colazione, pranzo e cena
 * (vedi `MAIN_MEAL_KINDS`), non in base al numero di pasti.
 */
export const COMPLETE_DAY_MEALS = 3;

/** Pasti principali: un giorno è completo se ci sono tutti; gli spuntini non contano. */
export const MAIN_MEAL_KINDS = ["breakfast", "lunch", "dinner"] as const satisfies readonly MealKind[];

/**
 * Limiti larghi di plausibilità, per intercettare errori di battitura e non per giudicare.
 * Un valore fuori limite è un errore di validazione (`invalid_value` sul campo).
 */
export const DIARY_LIMITS = {
  weightKgMin: 1,
  weightKgMax: 500,
  /** Per singolo evento `water` o `drink`: 10 litri. */
  volumeMlMax: 10_000,
  caffeineMgMax: 2000,
  alcoholGMax: 500,
} as const;
