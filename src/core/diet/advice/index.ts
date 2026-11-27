export {
  ADVICE_RULES,
  OCCASIONAL_PER_WEEK,
  OWN_TREND_MIN_WEEKS,
  SHOPPING_NAME_OF_GROUP,
  evaluateRule,
  type CatalogRule,
  type RuleEvaluation,
} from "./rules";
export {
  ACTION_FEASIBILITY,
  CERTAINTY_FACTOR,
  DEFAULT_MAX_ADVICE,
  MAX_ACTIONS,
  RECIPE_IN_HOME_FEASIBILITY,
  RECIPE_IN_HOME_SHARE,
  adviceKey,
  briefingAdvice,
  buildAdvice,
  feasibilityOf,
  hasRealAction,
  type MaybeClearRecipe,
} from "./engine";
export { computeOutcomes } from "./outcome";
