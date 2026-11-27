// Dati di prova per i test del quadro. Tabelle e classificazioni FINTE, scelte per far tornare i conti a mente: non
// sono i valori delle linee guida (quelli stanno in `data/guidelines.ts`) e non vanno usati altrove.

import type { Certainty } from "../ledger";
import type { DayIntake, FoodComposition, IntakeLine, NutrientTotal, NutrientTotals } from "../nutrition";
import type { DietTables } from "./indicators";
import {
  DIET_GROUPS,
  DIET_THRESHOLDS,
  ENERGY_LEVELS,
  GROUP_ROW_IDS,
  PORTION_KEYS,
  type ClassPart,
  type DietGroup,
  type DietHistoryInput,
  type EnergyLevel,
  type GroupTally,
  type GuidelineRow,
  type GuidelineRowId,
  type LineClass,
  type PortionKey,
  type PortionStandard,
  type PortionTable,
  type TargetKind,
  type TargetView,
  type WeekFrame,
} from "./types";

function row(
  id: GuidelineRowId,
  groups: readonly DietGroup[],
  kind: TargetKind,
  bound?: { min?: number; max?: number },
  portionKeys?: readonly PortionKey[],
): GuidelineRow {
  const byLevel = bound
    ? (Object.fromEntries(ENERGY_LEVELS.map((l) => [l, bound])) as Record<EnergyLevel, { min?: number; max?: number }>)
    : undefined;
  return {
    id,
    groups,
    kind,
    ...(byLevel ? { byLevel } : {}),
    ...(portionKeys ? { portionKeys } : {}),
    quote: "riga finta",
    source: "app",
    where: "test",
    reading: "read",
  };
}

/** Righe finte: numeri tondi, uguali a ogni livello. */
export const FAKE_ROWS: readonly GuidelineRow[] = [
  row("vegetables", ["vegetables"], "perDay", { min: 2 }),
  row("fruit", ["fruit"], "perDay", { min: 2 }),
  row("vegFruitTotal", [], "gramsPerDayMin", { min: 400 }),
  row("bread", ["refinedGrains", "wholeGrains"], "perDay", { min: 2 }, ["bread"]),
  row("grains", ["refinedGrains", "wholeGrains"], "perDay", { min: 1 }, ["grains"]),
  row("wholeGrainShare", [], "shareMin", { min: 0.5 }),
  row("legumes", ["legumes"], "perWeek", { min: 2, max: 4 }),
  row("fish", ["fish"], "perWeek", { min: 2 }),
  row("redMeat", ["redMeat"], "maxPerWeek", { max: 1 }),
  row("processedMeat", ["processedMeat"], "occasional"),
  row("alcohol", ["alcohol"], "notAdvised"),
  row("sugar", ["sugars"], "maxPerDay", { max: 2 }, ["sugar"]),
  row("salt", [], "gramsPerDayMax", { max: 5 }),
  row("freeSugars", [], "percentEnergyMax", { max: 10 }),
  row("fiber", [], "gramsPerDayMin", { min: 25 }),
];

/** Ogni porzione finta vale 100 g (o ml). */
export const FAKE_PORTIONS: PortionTable = Object.fromEntries(
  PORTION_KEYS.map((key): [PortionKey, PortionStandard] => [
    key,
    { key, amount: 100, unit: "g", basis: "raw", source: "app", where: "test" },
  ]),
) as PortionTable;

export const FAKE_TABLES: DietTables = {
  rows: FAKE_ROWS,
  portions: FAKE_PORTIONS,
  targetFor(id, level): TargetView | undefined {
    const r = FAKE_ROWS.find((x) => x.id === id);
    if (!r || r.kind === "occasional" || r.kind === "notAdvised") return undefined;
    const b = r.byLevel?.[level];
    if (!b) return undefined;
    return { kind: r.kind, row: r.id, source: r.source, where: r.where, ...b };
  },
};

export function part(group: ClassPart["group"], extra: Partial<ClassPart> = {}): ClassPart {
  return { group, basis: "food", certainty: "label", label: group, ...extra };
}

let lineSeq = 0;

export function lineClass(date: string, parts: ClassPart[], extra: Partial<LineClass> = {}): LineClass {
  const lineKey = extra.lineKey ?? `l${++lineSeq}`;
  return { lineKey, date, occasionKey: extra.occasionKey ?? lineKey, parts, ...extra };
}

function total(value: number, missingShare = 0, certainty: Certainty = "label"): NutrientTotal {
  return {
    value,
    missingShare,
    shareBy: "weight",
    missingCount: missingShare > 0 ? 1 : 0,
    count: 1,
    partial: missingShare > 0,
    certainty,
  };
}

export interface FakeDayOptions {
  complete?: boolean;
  energyKcal?: number;
  saltG?: number;
  fiberG?: number;
  /** `missingShare` di sale e fibre. */
  missingShare?: number;
  /** Righe vere del diario (per la varietà vegetale). */
  lines?: IntakeLine[];
}

export function fakeDay(date: string, o: FakeDayOptions = {}): DayIntake {
  const totals: NutrientTotals = {};
  if (o.energyKcal !== undefined) totals.energyKcal = total(o.energyKcal);
  if (o.saltG !== undefined) totals.saltG = total(o.saltG, o.missingShare ?? 0);
  if (o.fiberG !== undefined) totals.fiberG = total(o.fiberG, o.missingShare ?? 0);
  return {
    date,
    complete: o.complete ?? true,
    reasons: o.complete === false ? ["missing_meals"] : [],
    coverage: { date, status: o.complete === false ? "partial" : "complete", tracked: 3, untracked: 0, skipped: [], missing: [] } as unknown as DayIntake["coverage"],
    meals: [],
    standalone: o.lines ?? [],
    drinks: [],
    totals,
    unresolved: [],
  };
}

/** Riga del diario associata a un alimento della tabella. */
export function foodLine(eventId: string, ref: string, grams = 100): IntakeLine {
  return {
    kind: "mealItem",
    label: ref,
    quantity: { value: grams, unit: "g" } as IntakeLine["quantity"],
    quantityCertainty: "measured",
    eventId,
    status: "ok",
    composition: { name: ref, ref, origin: "table", selection: "explicit" },
    nutrients: {},
    certainty: "label",
  };
}

/** Classificatore finto: restituisce le classificazioni preparate per data. */
export function fakeClassifier(byDate: ReadonlyMap<string, LineClass[]> | Record<string, LineClass[]>) {
  const get = (date: string) => (byDate instanceof Map ? byDate.get(date) : (byDate as Record<string, LineClass[]>)[date]);
  return { day: (day: DayIntake) => get(day.date) ?? [] };
}

export function historyInput(
  days: DayIntake[],
  today: string,
  byDate: Record<string, LineClass[]>,
  extra: Partial<DietHistoryInput> = {},
): DietHistoryInput {
  return {
    days,
    today,
    classifier: fakeClassifier(byDate),
    level: 2000,
    foods: new Map<string, FoodComposition>(),
    ...extra,
  };
}

/** Tally vuoto, sovrascrivibile. */
export function tally(extra: Partial<GroupTally> = {}): GroupTally {
  return { occasions: 0, servings: 0, grams: 0, gramsKnown: true, days: 0, certainty: "label", ...extra };
}

/**
 * Quadro finto senza indicatori: una settimana chiusa con 7 giorni completi e tutto riconosciuto. I test cambiano
 * solo ciò che serve.
 */
export function fakeFrame(extra: Partial<Omit<WeekFrame, "indicators">> = {}): Omit<WeekFrame, "indicators"> {
  const tallies = Object.fromEntries(DIET_GROUPS.map((g) => [g, tally()])) as WeekFrame["tallies"];
  const rowTallies = Object.fromEntries(GROUP_ROW_IDS.map((g) => [g, tally()])) as WeekFrame["rowTallies"];
  return {
    weekStart: "2026-11-09",
    weekEnd: "2026-11-15",
    inProgress: false,
    daysElapsed: 7,
    daysWithData: 7,
    completeDays: 7,
    coverage: { lines: 100, classifiedLines: 100, estimatedLines: 0, energyKcal: 14000, classifiedKcal: 14000, share: 1 },
    tallies,
    rowTallies,
    salt: { completeDays: 7, missingShare: 0, partial: false, average: 4, certainty: "label" },
    fiber: { completeDays: 7, missingShare: 0, partial: false, average: 30, certainty: "label" },
    freeSugars: { grams: 20, percentEnergy: 4, lowerBound: true, certainty: "estimated" },
    processed: { nova4Kcal: 2000, knownKcal: 10000, totalKcal: 14000, share: 0.2, coverage: 0.714, certainty: "estimated" },
    plantVariety: { count: 12, partial: false },
    gaps: [],
    ...extra,
  };
}

export const THRESHOLDS = DIET_THRESHOLDS;
