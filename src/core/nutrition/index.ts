export * from "./types";
export {
  DEFAULT_MATCH_THRESHOLD,
  createFoodMatcher,
  matchFood,
  searchFoods,
  nameTokens,
  normalizeName,
} from "./match";
export type {
  FindOptions,
  FoodCandidate,
  FoodMatch,
  FoodMatcher,
  FoodState,
  MatchOptions,
  MatchOutcome,
  SearchOptions,
  StatePreference,
} from "./match";
export {
  combineCertainty,
  nutrientsOfQuantity,
  originCertainty,
  sumNutrients,
} from "./amounts";
export type {
  CompositionOrigin,
  NotComputableReason,
  NutrientSum,
  NutrientTotal,
  NutrientTotals,
  NutrientsOfQuantity,
  QuantityNutrientsResult,
  ResolvedComposition,
  SumPart,
} from "./amounts";
export {
  DEFAULT_STATE_PREFERENCE,
  compositionFromFood,
  compositionFromProduct,
  createResolver,
} from "./resolve";
export type {
  CompositionResolver,
  IntakeSubject,
  ResolutionFailure,
  ResolverResult,
  ResolverSources,
} from "./resolve";
export { computeIntake } from "./intake";
export type {
  DayIntake,
  DayPartialReason,
  DrinkIntake,
  IntakeLine,
  IntakeOptions,
  IntakeResult,
  MealIntake,
  ResolvedLine,
  UnresolvedLine,
  UnresolvedReason,
} from "./intake";
export {
  DEFAULT_MIN_COMPLETE_DAYS,
  ENERGY_KCAL_PER_G,
  applicableReferences,
  compareWithReferences,
  resolveReferences,
} from "./reference";
export type {
  ComparableDay,
  CompareOptions,
  ComparisonOutcome,
  InsufficientReason,
  NotComparableReason,
  Profile,
  ReferenceComparison,
  ReferenceWithVariant,
  ResolvedReference,
  VariantInfo,
  VariantOption,
} from "./reference";
export {
  applyYield,
  convertCompositionState,
  findYield,
  isValidYieldFactor,
} from "./yield";
export type { YieldDirection, YieldRule } from "./yield";
