"use client";

import { useMemo } from "react";
import { deriveDishHistory, summarizeCookings, type Cooking, type RecipeHistory } from "@/core/recipes";
import { useEventLog } from "@/data";

export interface DishHistoryState {
  ready: boolean;
  cookings: Cooking[];
  byRecipe: Map<string, RecipeHistory>;
}

const EMPTY = new Map<string, RecipeHistory>();

/** Lo storico delle cotture e dei voti, dal registro. Mentre carica è vuoto: nessuna schermata aspetta i voti. */
export function useDishHistory(): DishHistoryState {
  const log = useEventLog();
  return useMemo(() => {
    if (!log.data) return { ready: false, cookings: [], byRecipe: EMPTY };
    const { cookings } = deriveDishHistory(log.data);
    return { ready: true, cookings, byRecipe: summarizeCookings(cookings) };
  }, [log.data]);
}
