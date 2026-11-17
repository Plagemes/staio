"use client";

// Preferenze del ricettario che si ricordano: allergeni da evitare, alimenti esclusi, attrezzatura che si ha.
import { setSetting, useSetting } from "@/data";

export interface RecipePrefs {
  allergens: string[];
  excludedFoods: string[];
  ownedEquipment: string[];
  /** Mostra solo le ricette che si fanno con l'attrezzatura posseduta. */
  limitToEquipment: boolean;
}

export const RECIPE_PREFS_KEY = "recipes.prefs";

export const DEFAULT_PREFS: RecipePrefs = { allergens: [], excludedFoods: [], ownedEquipment: [], limitToEquipment: false };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Legge ciò che c'è nell'archivio con prudenza: qualunque forma inattesa vale come «nessuna preferenza». */
export function readPrefs(raw: unknown): RecipePrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    allergens: strings(r.allergens),
    excludedFoods: strings(r.excludedFoods),
    ownedEquipment: strings(r.ownedEquipment),
    limitToEquipment: r.limitToEquipment === true,
  };
}

export function useRecipePrefs(): { prefs: RecipePrefs; ready: boolean; save: (prefs: RecipePrefs) => Promise<void> } {
  const live = useSetting<unknown>(RECIPE_PREFS_KEY);
  return {
    prefs: readPrefs(live.data),
    ready: !live.loading,
    save: (prefs) => setSetting(RECIPE_PREFS_KEY, prefs),
  };
}
