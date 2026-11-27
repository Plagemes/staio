// Contratto del modulo «qualità di ciò che mangi»: solo tipi e costanti-elenco, nessuna logica.
// Gli altri file di `core/diet` (classificatore, linee guida, quadro, consigli) lo condividono.

import type { Certainty, Lot, Quantity } from "../ledger";
import type { Product } from "../catalog";
import type {
  CompositionResolver,
  DayIntake,
  DrinkIntake,
  FoodComposition,
  IntakeLine,
} from "../nutrition";

// ---------------------------------------------------------------------------
// Tassonomia
// ---------------------------------------------------------------------------

export const DIET_GROUPS = [
  "vegetables",
  "fruit",
  "legumes",
  "wholeGrains",
  "refinedGrains",
  "potatoes",
  "fish",
  "whiteMeat",
  "redMeat",
  "processedMeat",
  "milkYogurt",
  "cheese",
  "eggs",
  "nutsSeeds",
  "oilsFats",
  "sweets",
  "sugars",
  "sugaryDrinks",
  "saltySnacks",
  "alcohol",
  "otherDrinks",
  "condiments",
  "mixedDish",
] as const;
export type DietGroup = (typeof DIET_GROUPS)[number];

/** Non sono gruppi: una parte così riduce la copertura. */
export const UNCLASSIFIED = ["unknown", "outOfHome"] as const;
export type Unclassified = (typeof UNCLASSIFIED)[number];

/** Livello NOVA: 1 non lavorato o poco, 2 ingrediente da cucina, 3 lavorato, 4 molto lavorato. */
export const PROCESSING_LEVELS = [1, 2, 3, 4] as const;
export type ProcessingLevel = (typeof PROCESSING_LEVELS)[number];

export const CLASS_BASES = [
  "user",
  "product",
  "food",
  "category",
  "name",
  "prep",
  "outOfHome",
  "none",
] as const;
/** Da dove viene il gruppo di una parte. */
export type ClassBasis = (typeof CLASS_BASES)[number];

export const PORTION_KEYS = [
  "vegetables",
  "leafySalad",
  "fruit",
  "driedFruit",
  "bread",
  "grains",
  "freshEggPasta",
  "breadSubstitutes",
  "sweetBakery",
  "breakfastCereals",
  "potatoes",
  "legumes",
  "legumesDry",
  "soy",
  "fish",
  "fishPreserved",
  "whiteMeat",
  "redMeat",
  "processedMeat",
  "eggs",
  "milk",
  "yogurt",
  "cheeseFresh",
  "cheeseAged",
  "oil",
  "butter",
  "nutsSeeds",
  "cakes",
  "snacks",
  "spreads",
  "sugaryDrinks",
  "sugar",
  "honeyJam",
] as const;
/** Chiave della porzione standard (CREA-LG) con cui si contano le porzioni di una parte. */
export type PortionKey = (typeof PORTION_KEYS)[number];

// ---------------------------------------------------------------------------
// Classificazione delle righe
// ---------------------------------------------------------------------------

export interface ProcessingInfo {
  level: ProcessingLevel;
  certainty: Certainty;
  /** "product": `product.nova`; "declared": mappa dell'app; "category": categoria del lotto. */
  basis: "product" | "declared" | "category" | "user";
}

export interface ClassPart {
  group: DietGroup | Unclassified;
  portionKey?: PortionKey;
  processing?: ProcessingInfo;
  basis: ClassBasis;
  /** "label": scheda prodotto, alimento scelto, correzione; "estimated": nome, categoria, mappa. */
  certainty: Certainty;
  /** Equivalente crudo in g (ml per le bevande). Assente se non noto: mai zero al posto di un dato mancante. */
  grams?: number;
  gramsCertainty?: Certainty;
  energyKcal?: number;
  sugarsG?: number;
  saltG?: number;
  /** Preparazione da cui viene la parte (ingrediente scomposto). */
  prepId?: string;
  /** Nome mostrato: della voce o dell'ingrediente. */
  label: string;
}

export interface LineClass {
  /** `${eventId}` per dispensa e bevande, `${eventId}#${itemIndex}` per le voci libere: la chiave di Oggi. */
  lineKey: string;
  date: string;
  /** `mealId`, oppure `lineKey` per consumi e bevande fuori pasto. */
  occasionKey: string;
  parts: ClassPart[];
  /** Chiave di `ClassOverrides` con cui l'utente può correggere la riga. */
  overrideKey?: string;
}

/** Correzione dell'utente (impostazione `quality.classOverrides`). */
export interface ClassOverride {
  group?: DietGroup;
  processing?: ProcessingLevel;
}
/** Chiavi `b:<barcode>` oppure `n:<nome normalizzato>`. */
export type ClassOverrides = Readonly<Record<string, ClassOverride>>;

export interface PrepForDiet {
  prepId: string;
  batchLotId: string;
  portions: number;
  ingredients: readonly { lotId: string; productRef: string; quantity: Quantity }[];
}

export interface ClassifierSources {
  foods: ReadonlyMap<string, FoodComposition>;
  products: ReadonlyMap<string, Product>;
  lotOfConsume: (consumeEventId: string) => Lot | undefined;
  /** Per gli ingredienti delle preparazioni. */
  lots: ReadonlyMap<string, Lot>;
  /** Per `batchLotId`. */
  preps: ReadonlyMap<string, PrepForDiet>;
  /** Lo stesso risolutore di `intakeFor`, per gli ingredienti. */
  resolve?: CompositionResolver;
  overrides: ClassOverrides;
}

export interface Classifier {
  line(line: IntakeLine, date: string): LineClass;
  drink(drink: DrinkIntake, date: string): LineClass;
  /** Pasti, consumi fuori pasto e bevande del giorno. */
  day(day: DayIntake): LineClass[];
  /** Per ricette, piano e spesa: solo nome e, se c'è, id della tabella. */
  name(name: string, foodId?: string): ClassPart;
}

export interface RecipeDietFacts {
  recipeId: string;
  groups: readonly DietGroup[];
  servingsByGroup: Partial<Record<DietGroup, number>>;
  certainty: Certainty;
}

export interface PlannedDiet {
  /** Lunedì della settimana. */
  weekStart: string;
  servingsByGroup: Partial<Record<DietGroup, number>>;
  entriesByGroup: Partial<Record<DietGroup, number>>;
  /** Voci del piano senza gruppo riconosciuto. */
  unresolved: number;
}

// ---------------------------------------------------------------------------
// Linee guida e fonti
// ---------------------------------------------------------------------------

/** Livelli energetici di esempio della Tab. 9.1 CREA. */
export const ENERGY_LEVELS = [1500, 2000, 2500] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export const SOURCE_IDS = [
  "crea-lg-2018",
  "who-sugars-2015",
  "who-healthy-diet",
  "who-salt",
  "efsa-drv",
  "nova-fao-2019",
  "app",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Righe delle linee guida che contano porzioni od occasioni di gruppi: diventano `group:<riga>`. */
export const GROUP_ROW_IDS = [
  "vegetables",
  "fruit",
  "bread",
  "grains",
  "breadSubstitutes",
  "sweetBakery",
  "breakfastCereals",
  "potatoes",
  "legumes",
  "fish",
  "fishPreserved",
  "whiteMeat",
  "redMeat",
  "processedMeat",
  "eggs",
  "milkYogurt",
  "cheese",
  "oilsFats",
  "nutsSeeds",
  "cakesIceCream",
  "snacksChocolate",
  "sugaryDrinks",
  "sugar",
  "honeyJam",
  "alcohol",
] as const;
export type GroupRowId = (typeof GROUP_ROW_IDS)[number];

/** Righe che non contano porzioni: hanno un indicatore proprio (vedi `ROW_INDICATOR`). */
export const MEASURE_ROW_IDS = [
  "vegFruitTotal",
  "wholeGrainShare",
  "salt",
  "freeSugars",
  "fiber",
] as const;
export type MeasureRowId = (typeof MEASURE_ROW_IDS)[number];

export const GUIDELINE_ROW_IDS = [...GROUP_ROW_IDS, ...MEASURE_ROW_IDS] as const;
export type GuidelineRowId = GroupRowId | MeasureRowId;

export const TARGET_KINDS = [
  "perDay",
  "perWeek",
  "maxPerDay",
  "maxPerWeek",
  "occasional",
  "notAdvised",
  "shareMin",
  "percentEnergyMax",
  "gramsPerDayMin",
  "gramsPerDayMax",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Indicazione risolta per un livello energetico. */
export interface TargetView {
  kind: TargetKind;
  min?: number;
  max?: number;
  row: GuidelineRowId;
  source: SourceId;
  /** Punto della fonte, per esempio «Tab. 9.1, p. 132». */
  where: string;
}

export interface Source {
  id: SourceId;
  body: string;
  document: string;
  year: string;
  url: string;
  /** Data `YYYY-MM-DD`. */
  consultedOn: string;
  verified: boolean;
}

export interface GuidelineRow {
  id: GuidelineRowId;
  groups: readonly DietGroup[];
  /** Se presenti, la riga conta solo le parti con queste chiavi di porzione. */
  portionKeys?: readonly PortionKey[];
  kind: TargetKind;
  /** Valori della Tab. 9.1 per livello; `null` se la fonte non dà un numero a quel livello. */
  byLevel?: Readonly<Record<EnergyLevel, { min?: number; max?: number } | null>>;
  /** Intervallo scritto nel testo (es. «2-4 a settimana», p. 59): vince su `byLevel`. */
  textRange?: { min?: number; max?: number; where: string };
  /** Frase originale breve, una riga. */
  quote: string;
  source: SourceId;
  where: string;
  reading: "read" | "interpretation";
  note?: string;
}

export interface PortionStandard {
  key: PortionKey;
  amount: number;
  unit: "g" | "ml";
  basis: "raw" | "ready";
  source: SourceId;
  where: string;
}
export type PortionTable = Readonly<Record<PortionKey, PortionStandard>>;

// ---------------------------------------------------------------------------
// Indicatori
// ---------------------------------------------------------------------------

export const MEASURE_INDICATOR_IDS = [
  "vegFruit",
  "wholeGrainShare",
  "processedShare",
  "salt",
  "freeSugars",
  "fiber",
  "plantVariety",
] as const;
export type MeasureIndicatorId = (typeof MEASURE_INDICATOR_IDS)[number];
export type IndicatorId = `group:${GroupRowId}` | MeasureIndicatorId;

/** Indicatore di ogni riga senza porzioni. `processedShare` e `plantVariety` non hanno riga: nessuna soglia. */
export const ROW_INDICATOR = {
  vegFruitTotal: "vegFruit",
  wholeGrainShare: "wholeGrainShare",
  salt: "salt",
  freeSugars: "freeSugars",
  fiber: "fiber",
} as const satisfies Readonly<Record<MeasureRowId, MeasureIndicatorId>>;

export const INDICATOR_STATUSES = [
  "within",
  "below",
  "above",
  "atLeast",
  "occasional",
  "noTarget",
  "insufficient",
] as const;
export type IndicatorStatus = (typeof INDICATOR_STATUSES)[number];

export type IndicatorUnit =
  | "servingsPerWeek"
  | "servingsPerDay"
  | "gramsPerDay"
  | "percentEnergy"
  | "share"
  | "count";

export type InsufficientReason = "no_data" | "few_days" | "few_complete_days" | "low_coverage";

export interface Indicator {
  id: IndicatorId;
  /** Assente se non calcolabile. */
  value?: number;
  unit: IndicatorUnit;
  /** Vero se `value` è un minimo (dati mancanti): si legge «almeno». */
  lowerBound: boolean;
  certainty: Certainty;
  /** Copertura 0..1 dei dati su cui poggia. */
  coverage: number;
  status: IndicatorStatus;
  target?: TargetView;
  insufficient?: InsufficientReason;
}

// ---------------------------------------------------------------------------
// Quadro settimanale e storia
// ---------------------------------------------------------------------------

export interface GroupTally {
  /** Occasioni distinte (per `occasionKey`). */
  occasions: number;
  servings: number;
  /** Somma dei grammi noti. */
  grams: number;
  /** Falso se almeno una parte non aveva grammi. */
  gramsKnown: boolean;
  /** Giorni con almeno una parte. */
  days: number;
  certainty: Certainty;
}

export interface Coverage {
  lines: number;
  classifiedLines: number;
  estimatedLines: number;
  energyKcal: number;
  classifiedKcal: number;
  /** min(classifiedLines/lines, classifiedKcal/energyKcal); 0 se `lines` = 0. */
  share: number;
}

/** Nutriente per giorno, solo sui giorni completi. */
export interface DailyNutrient {
  average?: number;
  completeDays: number;
  missingShare: number;
  partial: boolean;
  certainty?: Certainty;
}

export interface ProcessedShare {
  nova4Kcal: number;
  /** Kcal con livello di lavorazione noto. */
  knownKcal: number;
  totalKcal: number;
  /** nova4Kcal / knownKcal. */
  share?: number;
  /** knownKcal / totalKcal. */
  coverage: number;
  certainty: Certainty;
}

/** Zuccheri di dolci, zucchero e bevande zuccherate: sempre una stima per difetto. */
export interface FreeSugarsProxy {
  grams: number;
  percentEnergy?: number;
  lowerBound: true;
  certainty: Certainty;
}

export type CoverageGapReason = "unknown" | "outOfHome" | "mixedDish" | "noQuantity";

export interface CoverageGap {
  lineKey: string;
  date: string;
  label: string;
  energyKcal?: number;
  reason: CoverageGapReason;
}

export interface WeekFrame {
  /** Lunedì. */
  weekStart: string;
  /** Domenica. */
  weekEnd: string;
  inProgress: boolean;
  daysElapsed: number;
  daysWithData: number;
  completeDays: number;
  coverage: Coverage;
  tallies: Readonly<Record<DietGroup, GroupTally>>;
  /** Conteggi per riga delle linee guida (gruppi filtrati per `portionKeys`): base degli indicatori `group:`. */
  rowTallies: Readonly<Record<GroupRowId, GroupTally>>;
  salt: DailyNutrient;
  fiber: DailyNutrient;
  freeSugars: FreeSugarsProxy;
  processed: ProcessedShare;
  plantVariety: { count: number; partial: boolean };
  /** Al massimo 10, per energia decrescente. */
  gaps: CoverageGap[];
  indicators: Indicator[];
}

export type TrendDirection = "up" | "down" | "flat" | "insufficient";

export interface Trend {
  direction: TrendDirection;
  weeksWithData: number;
  /** Dalla settimana più vecchia; `null` per una settimana insufficiente, mai 0. */
  values: (number | null)[];
}

export interface DietHistory {
  level: EnergyLevel;
  /** Dalla più vecchia; l'ultima è la settimana in corso. */
  weeks: WeekFrame[];
  trends: Readonly<Partial<Record<IndicatorId, Trend>>>;
  /** Per data `YYYY-MM-DD`: serve alle associazioni. */
  daily: Readonly<Record<string, { processedShare?: number; coverage: number }>>;
}

export interface DietThresholds {
  minDaysWithData: number;
  minCompleteDays: number;
  minCoverage: number;
  /** Giorni e copertura minimi per dire «sotto». */
  belowDays: number;
  belowCoverage: number;
  trendMinWeeks: number;
  trendMinRelativeChange: number;
}

/** Tutte scelte dell'app, dichiarate in FONTI.md. */
export const DIET_THRESHOLDS: Readonly<DietThresholds> = Object.freeze({
  minDaysWithData: 4,
  minCompleteDays: 4,
  minCoverage: 0.7,
  belowDays: 6,
  belowCoverage: 0.8,
  trendMinWeeks: 4,
  trendMinRelativeChange: 0.15,
});

export interface DietHistoryInput {
  days: readonly DayIntake[];
  today: string;
  /** 4..8, predefinito 8. */
  weeks?: number;
  /** Data da cui riempire `daily` per le associazioni (fino a 90 giorni). */
  dailyFrom?: string;
  classifier: Pick<Classifier, "day">;
  level: EnergyLevel;
  foods: ReadonlyMap<string, FoodComposition>;
  options?: Partial<DietThresholds>;
}

export interface PeriodIndicatorSummary {
  id: IndicatorId;
  mean?: number;
  within: number;
  below: number;
  above: number;
}

export interface PeriodDietSummary {
  from: string;
  to: string;
  weeks: number;
  sufficientWeeks: number;
  indicators: PeriodIndicatorSummary[];
}

// ---------------------------------------------------------------------------
// Consigli
// ---------------------------------------------------------------------------

export const ADVICE_RULE_IDS = [
  "vegFruitLow",
  "legumesLow",
  "fishLow",
  "wholeGrainLow",
  "nutsLow",
  "fiberLow",
  "redMeatHigh",
  "processedMeatOften",
  "sweetsDrinksOften",
  "saltHigh",
  "freeSugarsHigh",
  "processedShareUp",
] as const;
export type AdviceRuleId = (typeof ADVICE_RULE_IDS)[number];

export type AdviceSource = SourceId | "ownTrend";

export interface AdviceRule {
  id: AdviceRuleId;
  indicator: IndicatorId;
  direction: "increase" | "decrease";
  /** 0..1; `undefined` = la regola non scatta. `past` sono le settimane chiuse precedenti. */
  severity(ind: Indicator, frame: WeekFrame, past: readonly WeekFrame[]): number | undefined;
  lookFor: readonly DietGroup[];
  avoid?: readonly DietGroup[];
  source: AdviceSource;
}

export type AlternativeDimension = "nova" | "salt" | "sugars";

export type AdviceAction =
  /** → /app/ricette/idee?alimento= */
  | { kind: "cookWithPantry"; foodName: string; lotIds: readonly string[]; expiresOn?: string }
  | { kind: "openRecipe"; recipeId: string; title: string; inHomeShare?: number }
  /** → PlanSheet */
  | { kind: "addToPlan"; recipeId: string; title: string; servings: number }
  | { kind: "addToShopping"; names: readonly string[] }
  | {
      kind: "seeAlternative";
      fromBarcode: string;
      fromName: string;
      toBarcode: string;
      toName: string;
      dimension: AlternativeDimension;
    }
  | { kind: "openDetail"; anchor?: "consigli" | "come" };
export type AdviceActionKind = AdviceAction["kind"];

export interface PantryFood {
  lotIds: readonly string[];
  name: string;
  group: DietGroup;
  certainty: Certainty;
  expiresOn?: string;
}

/** Solo ricette «clear» per allergeni ed esclusioni: il filtro è del collante. */
export interface KnownRecipe {
  recipeId: string;
  title: string;
  servings: number;
  facts: RecipeDietFacts;
  /** Quota 0..1 degli ingredienti già in casa. */
  inHomeShare: number;
}

export interface KnownAlternative {
  fromBarcode: string;
  fromName: string;
  toBarcode: string;
  toName: string;
  dimension: AlternativeDimension;
  /** Quota 0..1 del prodotto di partenza nei consumi recenti. */
  fromShare: number;
}

export interface AdviceInput {
  today: string;
  history: DietHistory;
  pantry: readonly PantryFood[];
  recipes: readonly KnownRecipe[];
  alternatives: readonly KnownAlternative[];
  planned?: PlannedDiet;
  /** Nomi normalizzati già nella lista della spesa. */
  shoppingNames: readonly string[];
  /** Chiavi `diet:<ruleId>:<weekStart>` lasciate così. */
  dismissed: readonly string[];
  /** Predefinito 3. */
  maxAdvice?: number;
}

export interface AdviceFact {
  indicator: Indicator;
  weekStart: string;
  /** Andamento nella settimana in corso. */
  progress?: { value?: number; daysElapsed: number };
  /** Porzioni già nel piano della settimana in corso. */
  planned?: number;
}

export interface Advice {
  /** `diet:${ruleId}:${weekStart}`. */
  key: string;
  ruleId: AdviceRuleId;
  /** Settimana del fatto (di norma l'ultima chiusa). */
  weekStart: string;
  /** Settimana su cui valgono le azioni (quella in corso). */
  targetWeekStart: string;
  fact: AdviceFact;
  source: AdviceSource;
  /** Al massimo 2, in ordine di fattibilità. */
  actions: readonly AdviceAction[];
  priority: number;
  certainty: Certainty;
}

export type AdviceSkipReason = "not_triggered" | "insufficient" | "dismissed" | "already_planned";

export interface AdviceResult {
  advice: Advice[];
  skipped: { ruleId: AdviceRuleId; reason: AdviceSkipReason }[];
}

export type AdviceOutcomeResult = "moved" | "same" | "opposite" | "insufficient";

export interface AdviceOutcome {
  ruleId: AdviceRuleId;
  weekStart: string;
  nextWeekStart: string;
  before: number;
  after?: number;
  result: AdviceOutcomeResult;
}
