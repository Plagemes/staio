// Quadri finti per i test dei consigli: non dipendono dal calcolo vero del quadro (week.ts).
import {
  DIET_GROUPS,
  GROUP_ROW_IDS,
  type DietGroup,
  type DietHistory,
  type GroupRowId,
  type GroupTally,
  type Indicator,
  type IndicatorId,
  type KnownRecipe,
  type PantryFood,
  type TargetView,
  type WeekFrame,
  type AdviceInput,
} from "../types";
import { addDays } from "./util";

export const emptyTally = (): GroupTally => ({
  occasions: 0,
  servings: 0,
  grams: 0,
  gramsKnown: true,
  days: 0,
  certainty: "label",
});

/** Indicazioni finte, di forma uguale a quelle vere (i numeri non sono quelli della fonte). */
export const FAKE_TARGETS: Partial<Record<IndicatorId, TargetView>> = {
  vegFruit: { kind: "gramsPerDayMin", min: 400, row: "vegFruitTotal", source: "who-healthy-diet", where: "t" },
  "group:legumes": { kind: "perWeek", min: 2, max: 4, row: "legumes", source: "crea-lg-2018", where: "t" },
  "group:fish": { kind: "perWeek", min: 2, max: 3, row: "fish", source: "crea-lg-2018", where: "t" },
  "group:nutsSeeds": { kind: "perWeek", min: 3, max: 7, row: "nutsSeeds", source: "crea-lg-2018", where: "t" },
  "group:redMeat": { kind: "perWeek", min: 0, max: 1, row: "redMeat", source: "crea-lg-2018", where: "t" },
  wholeGrainShare: { kind: "shareMin", min: 0.5, row: "wholeGrainShare", source: "crea-lg-2018", where: "t" },
  fiber: { kind: "gramsPerDayMin", min: 25, row: "fiber", source: "efsa-drv", where: "t" },
  salt: { kind: "gramsPerDayMax", max: 5, row: "salt", source: "who-salt", where: "t" },
  freeSugars: { kind: "percentEnergyMax", max: 10, row: "freeSugars", source: "who-sugars-2015", where: "t" },
};

const UNIT_OF: Partial<Record<IndicatorId, Indicator["unit"]>> = {
  vegFruit: "gramsPerDay",
  wholeGrainShare: "share",
  processedShare: "share",
  salt: "gramsPerDay",
  freeSugars: "percentEnergy",
  fiber: "gramsPerDay",
  plantVariety: "count",
};

export function ind(id: IndicatorId, status: Indicator["status"], value?: number, extra: Partial<Indicator> = {}): Indicator {
  const target = FAKE_TARGETS[id];
  return {
    id,
    unit: UNIT_OF[id] ?? "servingsPerWeek",
    lowerBound: false,
    certainty: "label",
    coverage: 0.9,
    status,
    ...(value !== undefined ? { value } : {}),
    ...(target ? { target } : {}),
    ...extra,
  };
}

/** Un quadro «tutto a posto»: ogni regola tace. */
export function calmIndicators(): Indicator[] {
  return [
    ind("vegFruit", "within", 450),
    ind("group:legumes", "within", 3),
    ind("group:fish", "within", 2),
    ind("group:nutsSeeds", "within", 4),
    ind("group:redMeat", "within", 1),
    ind("group:processedMeat", "occasional", 1),
    ind("group:cakesIceCream", "occasional", 1),
    ind("group:snacksChocolate", "occasional", 0),
    ind("group:sugaryDrinks", "occasional", 0),
    ind("group:milkYogurt", "below", 0),
    ind("group:alcohol", "occasional", 9),
    ind("wholeGrainShare", "within", 0.6),
    ind("fiber", "within", 27),
    ind("salt", "within", 4),
    ind("freeSugars", "within", 6, { lowerBound: true, certainty: "estimated" }),
    ind("processedShare", "noTarget", 0.2, { certainty: "estimated" }),
    ind("plantVariety", "noTarget", 20),
  ];
}

export interface FrameSpec {
  weekStart: string;
  inProgress?: boolean;
  daysWithData?: number;
  daysElapsed?: number;
  coverage?: number;
  /** Sostituisce gli indicatori con lo stesso id del quadro calmo. */
  indicators?: Indicator[];
  rowOccasions?: Partial<Record<GroupRowId, number>>;
  servings?: Partial<Record<DietGroup, number>>;
}

export function frame(spec: FrameSpec): WeekFrame {
  const tallies = Object.fromEntries(DIET_GROUPS.map((g) => [g, emptyTally()])) as Record<DietGroup, GroupTally>;
  for (const [g, s] of Object.entries(spec.servings ?? {})) tallies[g as DietGroup] = { ...emptyTally(), servings: s, occasions: s };
  const rowTallies = Object.fromEntries(GROUP_ROW_IDS.map((r) => [r, emptyTally()])) as Record<GroupRowId, GroupTally>;
  const overrides = new Map((spec.indicators ?? []).map((i) => [i.id, i]));
  const indicators = calmIndicators().map((i) => overrides.get(i.id) ?? i);
  for (const i of spec.indicators ?? []) if (!indicators.some((x) => x.id === i.id)) indicators.push(i);
  // Le volte delle righe «occasionali» seguono il valore dell'indicatore, salvo indicazione esplicita.
  for (const i of indicators) {
    if (i.id.startsWith("group:") && typeof i.value === "number") {
      const row = i.id.slice(6) as GroupRowId;
      rowTallies[row] = { ...emptyTally(), occasions: i.value, servings: i.value };
    }
  }
  for (const [r, n] of Object.entries(spec.rowOccasions ?? {})) {
    rowTallies[r as GroupRowId] = { ...rowTallies[r as GroupRowId], occasions: n };
  }
  const inProgress = spec.inProgress ?? false;
  const coverage = spec.coverage ?? 0.9;
  return {
    weekStart: spec.weekStart,
    weekEnd: addDays(spec.weekStart, 6),
    inProgress,
    daysElapsed: spec.daysElapsed ?? (inProgress ? 3 : 7),
    daysWithData: spec.daysWithData ?? (inProgress ? 3 : 7),
    completeDays: spec.daysWithData ?? (inProgress ? 3 : 7),
    coverage: { lines: 100, classifiedLines: 95, estimatedLines: 30, energyKcal: 14000, classifiedKcal: 13000, share: coverage },
    tallies,
    rowTallies,
    salt: { average: 4, completeDays: 7, missingShare: 0, partial: false },
    fiber: { average: 27, completeDays: 7, missingShare: 0, partial: false },
    freeSugars: { grams: 30, percentEnergy: 6, lowerBound: true, certainty: "estimated" },
    processed: { nova4Kcal: 2000, knownKcal: 10000, totalKcal: 13000, share: 0.2, coverage: 0.77, certainty: "estimated" },
    plantVariety: { count: 20, partial: false },
    gaps: [],
    indicators,
  };
}

/** Oggi: mercoledì 2026-11-25; settimana in corso dal 23, ultima chiusa dal 16. */
export const TODAY = "2026-11-25";
export const CURRENT = "2026-11-23";
export const LAST_CLOSED = "2026-11-16";

/** Storia di `n` settimane chiuse (l'ultima è `LAST_CLOSED`) più quella in corso. */
export function history(lastClosed: FrameSpec | Omit<FrameSpec, "weekStart"> = {}, opts: { closedWeeks?: number; past?: (weekStart: string, i: number) => Omit<FrameSpec, "weekStart">; current?: Omit<FrameSpec, "weekStart"> } = {}): DietHistory {
  const n = opts.closedWeeks ?? 4;
  const weeks: WeekFrame[] = [];
  for (let i = n - 1; i >= 1; i--) {
    const ws = addDays(LAST_CLOSED, -7 * i);
    weeks.push(frame({ ...(opts.past?.(ws, n - 1 - i) ?? {}), weekStart: ws }));
  }
  weeks.push(frame({ ...lastClosed, weekStart: LAST_CLOSED }));
  weeks.push(frame({ inProgress: true, ...(opts.current ?? {}), weekStart: CURRENT }));
  return { level: 2000, weeks, trends: {}, daily: {} };
}

export function input(h: DietHistory, extra: Partial<AdviceInput> = {}): AdviceInput {
  return {
    today: TODAY,
    history: h,
    pantry: [],
    recipes: [],
    alternatives: [],
    shoppingNames: [],
    dismissed: [],
    ...extra,
  };
}

export function pantry(name: string, group: DietGroup, expiresOn?: string, lot = name): PantryFood {
  return { lotIds: [lot], name, group, certainty: "label", ...(expiresOn ? { expiresOn } : {}) };
}

export function recipe(id: string, groups: DietGroup[], inHomeShare = 0.2, extra: Partial<KnownRecipe> = {}): KnownRecipe {
  return {
    recipeId: id,
    title: `Ricetta ${id}`,
    servings: 2,
    facts: {
      recipeId: id,
      groups,
      servingsByGroup: Object.fromEntries(groups.map((g) => [g, 1])),
      certainty: "estimated",
    },
    inHomeShare,
    ...extra,
  };
}
