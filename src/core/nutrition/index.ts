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
export { dayBreakdown, periodBreakdown } from "./breakdown";
export type { BreakdownPart, DayBreakdown, DayCount, PeriodBreakdown } from "./breakdown";
export {
  OUT_OF_HOME_FACTOR,
  OUT_OF_HOME_HISTORY_DAYS,
  OUT_OF_HOME_MIN_MEALS,
  OUT_OF_HOME_MIN_MEAL_SHARE,
  OUT_OF_HOME_MOMENT_SHARE,
  OUT_OF_HOME_PERSONAL_RANGE,
  OUT_OF_HOME_REFERENCE_KCAL,
  OUT_OF_HOME_SIZES,
  REFERENCE_ENERGY_KCAL,
  estimateOutOfHome,
  mealEnergyHistory,
  outOfHomeEnergyShare,
} from "./outOfHome";
export type { OutOfHomeEstimate, OutOfHomeSize } from "./outOfHome";
export type {
  DayIntake,
  DayPartialReason,
  DrinkIntake,
  IntakeLine,
  IntakeOptions,
  IntakeResult,
  MealIntake,
  OutOfHomeInfo,
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
export {
  MIN_MEALS_FOR_MONOTONY,
  PLANT_GROUPS,
  VARIETY_DAYS,
  analyzeVariety,
  foodLookup,
  plantKindOf,
} from "./variety";
export type {
  AbsentGroup,
  FoodLookup,
  Monotony,
  PlantEntry,
  PlantGroup,
  PlantKind,
  VarietyReport,
  VarietyWindow,
} from "./variety";
export { PROTEIN_MOMENTS, proteinSpread } from "./proteinSpread";
export type { MomentProtein, ProteinMoment, ProteinSpread } from "./proteinSpread";
