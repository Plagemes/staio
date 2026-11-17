export { assessProduct, dimensionOf, summarize } from "./assess";
export type { AssessOptions, DimensionById } from "./assess";
export {
  assessAdditives,
  assessDensity,
  assessNova,
  assessNutriScore,
  assessNutrient,
  isDrink,
} from "./dimensions";
export { personalVerdict } from "./personal";
export type {
  PersonalEffect,
  PersonalGoal,
  PersonalNutrient,
  PersonalStatement,
  PersonalVerdict,
} from "./personal";
export { IMPACT_METRICS, dietImpact } from "./impact";
export type {
  ConsumptionEntry,
  Contributor,
  ImpactChange,
  ImpactMetric,
  ImpactOptions,
  ImpactReport,
  MetricImpact,
} from "./impact";
export { COMPARABLE_DIMENSIONS, DEFAULT_VALUE_TOLERANCE, bestUnitPrice, findAlternatives } from "./alternatives";
export type {
  Alternative,
  AlternativeOptions,
  AlternativesResult,
  Candidate,
  ComparableDimensionId,
  DescriptiveDifference,
  DimensionDifference,
  NoAlternativeReason,
  PriceObservation,
  UnitPrice,
  ValueTolerance,
} from "./alternatives";
export { shelfVerdict } from "./shelf";
export type { PantryMatchBy, PantryStock, ShelfInput, ShelfVerdict } from "./shelf";
export { OUTCOME_LABEL, OUTCOME_RANK } from "./types";
export type {
  AdditiveEntry,
  AdditivesDimension,
  AssessmentSummary,
  DensityDimension,
  Dimension,
  DimensionId,
  DimensionKind,
  NovaDimension,
  NutriScoreDimension,
  NutrientDimension,
  NutrientDimensionId,
  Outcome,
  QualityAssessment,
  SourceRef,
  TrafficBand,
} from "./types";
export {
  TRAFFIC_LIGHT_DRINK,
  TRAFFIC_LIGHT_FOOD,
  TRAFFIC_LIGHT_PAGE,
  TRAFFIC_LIGHT_SOURCE,
  TRAFFIC_LIGHT_TABLES,
} from "./data/thresholds";
export type { Cutoff, TrafficLightTable } from "./data/thresholds";
export {
  NOVA_DEFINITIONS,
  NOVA_OFF_SOURCE,
  NOVA_SOURCE,
  NUTRI_SCORE_OUTCOME,
  NUTRI_SCORE_SOURCE,
} from "./data/definitions";
export type { NovaDefinition } from "./data/definitions";
export { ADDITIVE_STATEMENTS, normalizeAdditiveCode, statementFor } from "./data/additives";
export type { AdditiveStatement } from "./data/additives";
