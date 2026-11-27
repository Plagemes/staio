// Qualità di ciò che mangi: il modulo intero da un solo punto. I nomi sono elencati uno per uno perché più
// sottomoduli hanno aiuti con lo stesso nome (`mondayOf`, `frameSufficient`, `normalizeName` dei consigli): qui
// esce solo quello pubblico di ciascuno. `RecipeDietFacts` e `PlannedDiet` vengono solo dal contratto (`types.ts`).

export * from "./types";

export { DIET_GROUP_LABEL, PROCESSING_LABEL } from "./labels";

export {
  CHEESE_FRESH_MAX_KCAL,
  PREP_REF_PREFIX,
  createClassifier,
  lotsByConsume,
  overrideKeyOf,
  rawEquivalentGrams,
} from "./classify";

export {
  MIN_SHARE_OF_PORTION,
  groupServings,
  recipeDietFacts,
  servingsOfQuantity,
  type IngredientServing,
} from "./recipes";

export { plannedDiet, type PlannedDietContext } from "./planned";

export { GROUP_PORTION_KEY, buildDietHistory, buildWeekFrame, mondayOf } from "./week";
export { DEFAULT_DIET_TABLES, frameSufficient, indicatorsOf, targetOfRow, type DietTables } from "./indicators";
export { trendOf, trendsOf } from "./trend";
export { summarizePeriod } from "./period";

export {
  LOT_CATEGORY_GROUP,
  LOT_CATEGORY_PORTION,
  OFF_CATEGORY_RULES,
  OFF_WHOLE_GRAIN_CATEGORY,
  firstIngredientIsWholeGrain,
  type CategoryRule,
} from "./data/categories";
export {
  FOOD_ID_GROUP,
  GROUP_DEFAULT_PORTION,
  TABLE_GROUP_DEFAULT,
  foodGroupOf,
  type GroupMapping,
} from "./data/foodGroups";
export { DEFAULT_LEVEL, GUIDELINE_ROWS, PORTIONS, guidelineRow, targetFor } from "./data/guidelines";
export { NAME_RULES, foldName, nameRuleOf, type NameMatch, type NameRule } from "./data/nameRules";
export {
  CATEGORY_PROCESSING,
  DECLARED_PROCESSING,
  TABLE_GROUP_PROCESSING,
  declaredProcessingOf,
} from "./data/processing";
export { DIET_SOURCES } from "./data/sources";

export {
  ACTION_FEASIBILITY,
  ADVICE_RULES,
  CERTAINTY_FACTOR,
  DEFAULT_MAX_ADVICE,
  MAX_ACTIONS,
  OCCASIONAL_PER_WEEK,
  OWN_TREND_MIN_WEEKS,
  RECIPE_IN_HOME_FEASIBILITY,
  RECIPE_IN_HOME_SHARE,
  SHOPPING_NAME_OF_GROUP,
  adviceKey,
  briefingAdvice,
  buildAdvice,
  computeOutcomes,
  evaluateRule,
  feasibilityOf,
  hasRealAction,
  type CatalogRule,
  type MaybeClearRecipe,
  type RuleEvaluation,
} from "./advice";
