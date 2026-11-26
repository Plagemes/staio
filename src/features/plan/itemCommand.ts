// Il comando in vista su una voce del piano: uno solo, o nessuno. Gli altri stanno nel foglio della voce. Logica pura.
import type { PlannedItem } from "@/core/plan";

export type ItemCommand = "cook" | "eat" | null;

/** L'indirizzo di «Cucina» per una ricetta del piano. */
export function cookHref(recipeId: string, servings: number): string {
  return `/app/ricette/cucina?id=${encodeURIComponent(recipeId)}&porzioni=${encodeURIComponent(String(servings))}`;
}

/**
 * Una ricetta di oggi o dei giorni dopo si cucina; un alimento o una preparazione di oggi o dei giorni passati si
 * registra. Una ricetta ritirata non si cucina; per ciò che è ancora da venire non c'è un comando in vista.
 */
export function itemCommand(item: PlannedItem, date: string, today: string, recipeExists: boolean): ItemCommand {
  if (item.kind === "recipe") return date >= today && recipeExists ? "cook" : null;
  return date <= today ? "eat" : null;
}
