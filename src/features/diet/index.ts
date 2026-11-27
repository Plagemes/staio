// Qualità di ciò che mangi, lato app: ganci con la memoria condivisa, ingressi del motore, testi, azioni e indirizzi.
export {
  adviceFor,
  dietFor,
  useClassOverrides,
  useDietAdvice,
  useDietHistory,
  useDietLevel,
  useLineMarks,
  type AdviceInputs,
  type DayMarks,
  type DietAdviceOutput,
  type DietAdviceView,
  type DietInputs,
  type DietOutput,
  type LineMarksView,
} from "./useDiet";
export {
  DIET_GAP_ROWS,
  PREP_PROCESSED_SHARE,
  dietGaps,
  knownAlternatives,
  knownRecipes,
  lineMarkOf,
  pantryFoods,
  plannedEntriesFrom,
  prepsForDiet,
  recentProductShares,
  recipeIsClear,
  shoppingNames,
  type KnownRecipesArgs,
  type LineMark,
} from "./inputs";
export {
  CLASS_OVERRIDES_KEY,
  isClassOverride,
  isClassOverrides,
  isOverrideKey,
  normalizeClassOverrides,
  saveClassOverride,
  withClassOverride,
} from "./overrides";
export { DEFAULT_LEVEL, LEVEL_KEY, isEnergyLevel, levelOf, saveDietLevel } from "./level";
export * from "./texts";
export {
  SHOPPING_PATH,
  dismissAdvice,
  dismissWithNotice,
  hrefOf,
  runAdviceAction,
  type ActionDeps,
  type ActionResult,
  type NoticeLike,
} from "./actions";
export { DIET_PATH, WEEK_PARAM, dietHref, eventIdOfLineKey, lineHref, recipeHref, type DietAnchor } from "./links";
