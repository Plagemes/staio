export {
  ALLERGEN_CHECK_NOTICE,
  FINDING_REASON_TEXT,
  allergenLabels,
  allergensInText,
  assessItem,
  assessRecipe,
  assessText,
  canonicalAllergen,
  canonicalAllergens,
  itemMatchesExclusion,
  matchExclusion,
  uncertainAllergensInText,
} from "./engine";
export type {
  AllergenOutcome,
  ExclusionOutcome,
  Finding,
  FindingOrigin,
  FindingReason,
  IngredientHit,
  ItemAssessment,
  ItemSubject,
  RecipeAssessment,
  RecipeSubject,
  TextHit,
  Verdict,
} from "./engine";
export { HYPONYM_GROUPS } from "./hyponyms";
export type { HyponymGroup } from "./hyponyms";
export { foldText, segments, stemWord } from "./normalize";
export { ALLERGEN_KEYS, ALLERGEN_TABLES, COMPOSITES, GENERIC_MASKS, GENERIC_TERMS, HIDDEN_CONTENTS } from "./tables";
export type { AllergenKey, AllergenTable, CompositeEntry } from "./tables";
export {
  DISH_HEAD_WORDS,
  GROUP_ALLERGENS,
  KNOWN_FOOD_SOURCES,
  MODIFIER_WORDS,
  NOT_SIMPLE_ALIASES,
  NOT_SIMPLE_FOOD_IDS,
  PREPARATION_WORDS,
  PROCESSED_WORDS,
  SIMPLE_NUTRITION_IDS,
  SULFITE_WORDS,
} from "./knownFoods";
export type { FoodKind, KnownFoodSource } from "./knownFoods";
