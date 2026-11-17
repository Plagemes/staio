// Obiettivi indicati dall'utente (ridurre o aumentare un nutriente): servono al voto personale.
// Si conservano tra le impostazioni locali; senza obiettivi il voto personale si fonda solo sui confronti.

import type { PersonalGoal, PersonalNutrient } from "@/core/quality";

export const GOALS_SETTING_KEY = "quality.goals";

export const GOAL_OPTIONS: readonly { nutrient: PersonalNutrient; direction: PersonalGoal["direction"]; label: string }[] = [
  { nutrient: "sugars", direction: "reduce", label: "Ridurre gli zuccheri" },
  { nutrient: "salt", direction: "reduce", label: "Ridurre il sale" },
  { nutrient: "saturatedFat", direction: "reduce", label: "Ridurre i grassi saturi" },
  { nutrient: "fat", direction: "reduce", label: "Ridurre i grassi" },
  { nutrient: "fiber", direction: "increase", label: "Aumentare le fibre" },
  { nutrient: "proteins", direction: "increase", label: "Aumentare le proteine" },
];

const NUTRIENTS: readonly string[] = ["proteins", "carbohydrates", "sugars", "fat", "saturatedFat", "fiber", "salt"];

export function isGoals(value: unknown): value is PersonalGoal[] {
  return (
    Array.isArray(value) &&
    value.every(
      (g) =>
        typeof g === "object" &&
        g !== null &&
        NUTRIENTS.includes((g as { nutrient?: string }).nutrient ?? "") &&
        ((g as { direction?: string }).direction === "reduce" || (g as { direction?: string }).direction === "increase"),
    )
  );
}

export const hasGoal = (goals: readonly PersonalGoal[], nutrient: PersonalNutrient, direction: PersonalGoal["direction"]): boolean =>
  goals.some((g) => g.nutrient === nutrient && g.direction === direction);

/** Aggiunge l'obiettivo se manca, lo toglie se c'è; un nutriente ha un solo obiettivo (ridurre o aumentare). */
export function toggleGoal(goals: readonly PersonalGoal[], nutrient: PersonalNutrient, direction: PersonalGoal["direction"]): PersonalGoal[] {
  if (hasGoal(goals, nutrient, direction)) return goals.filter((g) => !(g.nutrient === nutrient && g.direction === direction));
  return [...goals.filter((g) => g.nutrient !== nutrient), { nutrient, direction }];
}
