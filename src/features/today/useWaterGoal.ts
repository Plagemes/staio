"use client";

import { DEFAULT_WATER_GOAL_ML } from "../health";
import { WATER_GOAL_KEY } from "../health/WaterCard";
import { useSetting } from "../localSettings";

const isGoal = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** L'obiettivo d'acqua del giorno, lo stesso che legge e scrive la scheda dell'acqua. */
export function useWaterGoal(): number {
  return useSetting(WATER_GOAL_KEY, isGoal, DEFAULT_WATER_GOAL_ML).value;
}
