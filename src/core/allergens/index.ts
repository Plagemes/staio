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
export { confirmationKey, confirmationLapse, foldedExclusions, keyText } from "./confirmationKey";
export type { ConfirmableItem, ConfirmationMap, ConfirmationRecord } from "./confirmationKey";
export {
  CONFIRMATION_EVENT_TYPES,
  CONFIRMATION_LIMITS,
  confirmIngredient,
  confirmability,
  deriveConfirmations,
  isConfirmationEvent,
  restoredConfirmationsNotice,
  revokeConfirmation,
  validateConfirmationEvent,
} from "./confirmations";
export type {
  AllergenConfirmationEvent,
  ConfirmationAnomaly,
  ConfirmationAnomalyCode,
  ConfirmationEventOptions,
  ConfirmationRefusal,
  ConfirmationsState,
  DeclaredCriteria,
} from "./confirmations";
export type {
  AllergenOutcome,
  ConfirmationOptions,
  ConfirmedFinding,
  ConfirmedHit,
  RecipeCriteria,
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
  CITRUS_WORDS,
  DISH_HEAD_WORDS,
  DISH_NAMES,
  GROUP_ALLERGENS,
  KNOWN_FOOD_SOURCES,
  MODIFIER_WORDS,
  NOT_SIMPLE_ALIASES,
  NOT_SIMPLE_FOOD_IDS,
  PREPARATION_WORDS,
  PROCESSED_WORDS,
  PURPOSE_WORDS,
  SIMPLE_NUTRITION_IDS,
  SULFITE_WORDS,
  TEXTURE_WORDS,
} from "./knownFoods";
export type { FoodKind, KnownFoodSource } from "./knownFoods";
