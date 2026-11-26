import type { FoodCategory } from "@/core/expiry";
import type { FoodThumbKind } from "@/design";
import { isFoodCategory } from "./lots";

/** Quale disegno segnaposto (`FoodThumb`) va con ogni categoria del motore delle scadenze. */
const KIND_OF: Record<FoodCategory, FoodThumbKind> = {
  red_meat_fresh: "meat",
  ground_meat: "meat",
  poultry: "meat",
  fish_fresh: "fish",
  cold_cuts_sliced: "meat",
  cured_meat_whole: "meat",
  milk_fresh: "dairy",
  milk_uht: "dairy",
  yogurt: "dairy",
  cheese_fresh: "cheese",
  cheese_aged: "cheese",
  butter: "dairy",
  eggs: "egg",
  leafy_vegetables: "vegetable",
  root_vegetables: "vegetable",
  other_vegetables: "vegetable",
  fruit_fresh: "fruit",
  berries: "fruit",
  citrus: "fruit",
  bread_fresh: "bread",
  bread_packaged: "bread",
  pasta_fresh: "bowl",
  pasta_dry: "bowl",
  rice_cereals: "bowl",
  legumes_dry: "jar",
  canned_closed: "jar",
  sauces_preserves_opened: "jar",
  leftovers_cooked: "dish",
  ready_meals: "dish",
  frozen_foods: "frozen",
  beverages: "drink",
  juices_opened: "drink",
  condiments_sauces: "jar",
  pastries_fresh: "sweet",
  snacks_dry: "sweet",
};

/** Il disegno per una categoria (la `category` di un lotto è una stringa libera): senza categoria nota, un piatto. */
export function foodKindOf(category: string | undefined): FoodThumbKind {
  return isFoodCategory(category) ? KIND_OF[category] : "dish";
}
