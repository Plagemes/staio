export { normalizeName, InvalidShoppingInputError } from "./common";
export type { ShoppingLine } from "./common";

export { buildPriceBook, estimateCost, findSeries, findUsablePrice, seriesByStore, unitPriceOf } from "./prices";
export type {
  CostEstimate,
  PriceAgeOptions,
  PriceBook,
  PriceObservation,
  PriceOptions,
  PriceQuery,
  PriceSeries,
  PriceTrend,
  UnitPrice,
  UsablePrice,
} from "./prices";

export { findForecast, forecastConsumption, isIdle } from "./consumption";
export type {
  ConsumptionEstimate,
  ConsumptionForecast,
  ConsumptionInsufficient,
  ConsumptionOptions,
  InsufficientReason,
  RateRange,
} from "./consumption";

export {
  belowMinimum,
  emptyStockConfig,
  removeMinimum,
  setMinimum,
  suggestMinimum,
  suggestMinimums,
} from "./stock";
export type {
  BelowMinimum,
  MinimumSuggestion,
  MinimumSuggestionOptions,
  StockConfig,
  StockMinimum,
} from "./stock";

export { wasteByProduct } from "./waste";
export type {
  FormatTooBig,
  FormatWaste,
  ProductWaste,
  WasteByReasonEntry,
  WasteOptions,
} from "./waste";

export { composeList, emptyRejections, rejectItem, rejectionWeight } from "./list";
export type {
  ExpiringPair,
  ItemNote,
  ListInput,
  ListIssue,
  ListIssueCode,
  ListItem,
  ListOptions,
  ListReason,
  ManualEntry,
  PlanNeed,
  ReasonDetail,
  ReasonKind,
  RejectionEntry,
  RejectionMemory,
  ShoppingList,
} from "./list";

export { compareStores } from "./stores";
export type {
  CompareStoresOptions,
  NoSplitReason,
  SplitAssignment,
  StoreComparison,
  StoreCost,
  StoreSplit,
} from "./stores";

export { applyBudget } from "./budget";
export type { BudgetAdjustment, BudgetLine, BudgetOptions, BudgetResult } from "./budget";

export {
  addOffList,
  checkItem,
  finishTrip,
  orderForStore,
  reconcile,
  startTrip,
  tripProgress,
  uncheckItem,
} from "./trip";
export type {
  CompletedTrip,
  ExtraPurchase,
  OffListEntry,
  OrderedItem,
  ReconcileOptions,
  ReconciledItem,
  Reconciliation,
  TripItem,
  TripState,
} from "./trip";

export { recommendShoppingDay } from "./when";
export type { ShoppingDay, WhenInput, WhenOptions, WhenTrigger } from "./when";
