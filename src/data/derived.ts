import { liveQuery, type Observable } from "dexie";
import { derivePlan, type PlanState } from "@/core/plan";
import { deriveRecipes, type RecipesState } from "@/core/recipes";
import { derivePreps, type PrepState } from "@/core/prep";
import { getAllEvents } from "./eventStore";

export async function getPlan(): Promise<PlanState> {
  return derivePlan(await getAllEvents());
}

export async function getRecipes(): Promise<RecipesState> {
  return deriveRecipes(await getAllEvents());
}

/** Le preparazioni dipendono anche dalla dispensa, calcolata dagli stessi eventi. */
export async function getPreps(): Promise<PrepState> {
  return derivePreps(await getAllEvents());
}

export function livePlan(): Observable<PlanState> {
  return liveQuery(() => getPlan());
}

export function liveRecipes(): Observable<RecipesState> {
  return liveQuery(() => getRecipes());
}

export function livePreps(): Observable<PrepState> {
  return liveQuery(() => getPreps());
}
