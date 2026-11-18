import type { MealItem } from "./types";

/**
 * Copia profonda delle voci con i soli campi noti; `foodId` passa intatto, se vuoto o
 * assente non compare; `energyKcal` (pasto fuori casa) passa com'è. Tollera dati malformati (la validazione viene
 * dopo, negli aiuti di creazione).
 */
export function cloneMealItems(items: readonly MealItem[] | undefined): MealItem[] {
  if (items === undefined) return [];
  if (!Array.isArray(items)) return items as unknown as MealItem[];
  return items.map((i: MealItem) => {
    if (typeof i !== "object" || i === null) return i;
    const q = i.quantity as MealItem["quantity"] | undefined;
    return {
      name: i.name,
      quantity: typeof q === "object" && q !== null ? { ...q } : (q as unknown as MealItem["quantity"]),
      certainty: i.certainty,
      ...(i.foodId !== undefined && i.foodId !== "" ? { foodId: i.foodId } : {}),
      ...(i.energyKcal !== undefined ? { energyKcal: i.energyKcal } : {}),
    };
  });
}
