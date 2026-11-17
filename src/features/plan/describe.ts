// Testi delle voci del piano. Logica pura.
import type { PlannedItem } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import type { Recipe } from "@/core/recipes";
import { formatQuantity } from "@/core/units";

export interface Catalog {
  recipes: readonly Recipe[];
  preps: readonly PrepRecord[];
}

export function servingsText(n: number): string {
  const text = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);
  return `${text} ${n === 1 ? "porzione" : "porzioni"}`;
}

/** Nome della voce, senza quantità. */
export function itemName(item: PlannedItem, catalog: Catalog): string {
  if (item.kind === "food") return item.name;
  if (item.kind === "recipe") return catalog.recipes.find((r) => r.recipeId === item.recipeId)?.title ?? "Ricetta non più presente";
  return catalog.preps.find((p) => p.prepId === item.prepId)?.title ?? "Preparazione non più presente";
}

/** "Pasta 80 g", "Ragù, 2 porzioni". */
export function itemLabel(item: PlannedItem, catalog: Catalog): string {
  const name = itemName(item, catalog);
  return item.kind === "food" ? `${name} ${formatQuantity(item.quantity)}` : `${name}, ${servingsText(item.servings)}`;
}

export const KIND_LABELS: Record<PlannedItem["kind"], string> = { food: "Alimento", recipe: "Ricetta", prep: "Preparazione" };

/** La riga di stato per la porta "ricette" o "preparazioni" del piano. */
export function catalogStatus(count: number, singular: string, plural: string, empty: string): string {
  if (count === 0) return empty;
  return `${count} ${count === 1 ? singular : plural}`;
}
