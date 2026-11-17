// Modello dati del ricettario (schemaVersion 1).
// Usa la stessa busta degli eventi del libro mastro e lo stesso `void` per annullare.

import type { EventBase } from "../ledger";
import type { Quantity } from "../units";

export const RECIPE_EVENT_TYPES = ["recipe"] as const;
export type RecipeEventType = (typeof RECIPE_EVENT_TYPES)[number];

export const FOOD_ID_MAX_LENGTH = 80;

/** Limiti larghi di plausibilità: intercettano errori di battitura, non giudicano. */
export const RECIPE_LIMITS = {
  servingsMax: 1000,
  minutesMax: 60 * 24 * 30,
  ratingMin: 1,
  ratingMax: 5,
  ingredientsMax: 300,
  stepsMax: 300,
} as const;

export interface RecipeIngredient {
  name: string;
  /** Assente per "q.b." e simili: la quantità non è scritta, non è zero. */
  quantity?: Quantity;
  /** Alimento della tabella nutrizionale. Minuscolo, cifre e trattini; vuoto vale come assente. */
  foodId?: string;
  note?: string;
}

export interface RecipeStep {
  text: string;
  /** Durata del passo, in minuti. */
  durationMinutes?: number;
}

export interface RecipeTimes {
  prepMinutes?: number;
  cookMinutes?: number;
  totalMinutes?: number;
}

export interface RecipeSource {
  /** Indirizzo `http` o `https` da cui la ricetta è stata presa. */
  url?: string;
  author?: string;
}

/**
 * Una ricetta. Un evento `recipe` successivo con lo stesso `recipeId` la sostituisce (vale l'ultimo
 * per `recordedAt`, poi `id`); `archived: true` la ritira.
 */
export interface RecipeEvent extends EventBase {
  type: "recipe";
  recipeId: string;
  title: string;
  /** Porzioni a cui si riferiscono le quantità degli ingredienti. */
  servings: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  times?: RecipeTimes;
  equipment?: string[];
  tags?: string[];
  /** Da dove viene la ricetta (non è il `source` della busta, che dice come è stato registrato l'evento). */
  origin?: RecipeSource;
  /** Voto personale, da 1 a 5. */
  rating?: number;
  archived?: boolean;
}

/** Ricetta in vigore, ricavata dagli eventi. */
export interface Recipe {
  recipeId: string;
  title: string;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  times?: RecipeTimes;
  equipment: string[];
  tags: string[];
  origin?: RecipeSource;
  rating?: number;
  /** Certezza dell'evento che ha stabilito la versione attuale. */
  certainty: EventBase["certainty"];
  /** Istante di registrazione della versione attuale e della prima. */
  updatedAt: string;
  createdAt: string;
  /** Id dell'evento che ha stabilito la versione attuale. */
  eventId: string;
}

/** Errore di un calcolo del ricettario. */
export interface RecipeError {
  code: "invalid_servings" | "invalid_quantity" | "no_packages" | "not_convertible" | "invalid_range";
  message: string;
}

/** La quantità è quella del modulo delle unità (comprende cucchiai, pizzichi, confezioni). */
export type { Quantity };
