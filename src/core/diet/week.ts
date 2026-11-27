// Quadro settimanale di ciò che si è mangiato, a partire dalle classificazioni delle righe (già fatte dal
// classificatore) e dai giorni del diario. Puro: nessun accesso al registro.

import { addDays, daysBetween } from "../diary";
import { worseCertainty, type Certainty } from "../ledger";
import { plantKindOf, type DayIntake, type FoodComposition, type NutrientKey } from "../nutrition";
import { DEFAULT_DIET_TABLES, indicatorsOf, type DietTables } from "./indicators";
import { trendsOf } from "./trend";
import {
  DIET_GROUPS,
  DIET_THRESHOLDS,
  GROUP_ROW_IDS,
  type ClassPart,
  type Coverage,
  type CoverageGap,
  type DailyNutrient,
  type DietGroup,
  type DietHistory,
  type DietHistoryInput,
  type DietThresholds,
  type FreeSugarsProxy,
  type GroupRowId,
  type GroupTally,
  type GuidelineRow,
  type LineClass,
  type PortionKey,
  type ProcessedShare,
  type WeekFrame,
} from "./types";

/**
 * Porzione standard con cui si contano le parti senza `portionKey`. Scelta dell'app: la porzione più comune del
 * gruppo. I gruppi senza voce (bevande, condimenti, piatti misti) contano 1 porzione per occasione, stimata.
 */
export const GROUP_PORTION_KEY: Readonly<Partial<Record<DietGroup, PortionKey>>> = {
  vegetables: "vegetables",
  fruit: "fruit",
  legumes: "legumes",
  wholeGrains: "grains",
  refinedGrains: "grains",
  potatoes: "potatoes",
  fish: "fish",
  whiteMeat: "whiteMeat",
  redMeat: "redMeat",
  processedMeat: "processedMeat",
  milkYogurt: "milk",
  cheese: "cheeseAged",
  eggs: "eggs",
  nutsSeeds: "nutsSeeds",
  oilsFats: "oil",
  sweets: "cakes",
  sugars: "sugar",
  sugaryDrinks: "sugaryDrinks",
  saltySnacks: "snacks",
};

/** Gruppi i cui zuccheri contano come zuccheri liberi (stima per difetto). */
const FREE_SUGAR_GROUPS: ReadonlySet<string> = new Set<DietGroup>(["sweets", "sugars", "sugaryDrinks"]);

const MAX_GAPS = 10;
/** Quota (di energia o di parti) riconosciuta oltre la quale una riga conta come classificata. */
const LINE_CLASSIFIED_SHARE = 0.5;

interface ClassifiedDay {
  day: DayIntake;
  lines: readonly LineClass[];
}

interface FrameContext {
  level: DietHistoryInput["level"];
  foods: ReadonlyMap<string, FoodComposition>;
  t: DietThresholds;
  tables: DietTables;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function worse(a: Certainty | undefined, b: Certainty | undefined): Certainty | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return worseCertainty(a, b);
}

function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Lunedì della settimana di `date` (la settimana parte dal lunedì, come nel piano). */
export function mondayOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/** Una parte riconosciuta: ha un gruppo vero e non è un piatto misto di cui non si conoscono i gruppi. */
function isClassified(part: ClassPart): boolean {
  return part.group !== "unknown" && part.group !== "outOfHome" && part.group !== "mixedDish";
}

function portionKeyOf(part: ClassPart): PortionKey | undefined {
  if (part.portionKey) return part.portionKey;
  return isClassified(part) ? GROUP_PORTION_KEY[part.group as DietGroup] : undefined;
}

class TallyAcc {
  private readonly occasions = new Map<string, { raw: number; missing: boolean }>();
  private grams = 0;
  private gramsKnown = true;
  private readonly dates = new Set<string>();
  private certainty: Certainty | undefined;

  add(part: ClassPart, pk: PortionKey | undefined, occasionKey: string, date: string, tables: DietTables): void {
    const occ = this.occasions.get(occasionKey) ?? { raw: 0, missing: false };
    const portion = pk ? tables.portions[pk] : undefined;
    if (part.grams !== undefined && portion && portion.amount > 0) occ.raw += part.grams / portion.amount;
    else occ.missing = true;
    this.occasions.set(occasionKey, occ);
    if (part.grams !== undefined) this.grams += part.grams;
    else this.gramsKnown = false;
    this.dates.add(date);
    this.certainty = worse(this.certainty, part.certainty);
    if (part.grams !== undefined) this.certainty = worse(this.certainty, part.gramsCertainty);
  }

  result(): GroupTally {
    let servings = 0;
    let estimated = false;
    for (const o of this.occasions.values()) {
      // Porzioni per occasione arrotondate a 0,5 con un minimo di 0,5; senza grammi l'occasione vale 1, stimata.
      if (o.raw > 0) servings += Math.max(0.5, Math.round(o.raw * 2) / 2);
      else servings += o.missing ? 1 : 0.5;
      if (o.missing) estimated = true;
    }
    const certainty = estimated ? "estimated" : (this.certainty ?? "label");
    return {
      occasions: this.occasions.size,
      servings,
      grams: round(this.grams, 1),
      gramsKnown: this.gramsKnown,
      days: this.dates.size,
      certainty,
    };
  }
}

function rowMatches(row: GuidelineRow, group: DietGroup, pk: PortionKey | undefined): boolean {
  if (!row.groups.includes(group)) return false;
  return !row.portionKeys || (pk !== undefined && row.portionKeys.includes(pk));
}

function dailyNutrient(complete: readonly DayIntake[], key: NutrientKey): DailyNutrient {
  if (complete.length === 0) return { completeDays: 0, missingShare: 1, partial: true };
  let sum = 0;
  let n = 0;
  let missing = 0;
  let partial = false;
  let certainty: Certainty | undefined;
  for (const d of complete) {
    const total = d.totals[key];
    if (!total) {
      missing += 1;
      partial = true;
      continue;
    }
    sum += total.value;
    n++;
    missing += total.missingShare;
    partial ||= total.partial;
    certainty = worse(certainty, total.certainty);
  }
  const out: DailyNutrient = {
    completeDays: complete.length,
    missingShare: round(missing / complete.length),
    partial,
  };
  if (n > 0) out.average = round(sum / n);
  if (certainty) out.certainty = certainty;
  return out;
}

interface ProcessedAcc {
  nova4Kcal: number;
  knownKcal: number;
  totalKcal: number;
  certainty?: Certainty;
}

function addProcessed(acc: ProcessedAcc, part: ClassPart): void {
  const kcal = part.energyKcal;
  if (kcal === undefined) return;
  acc.totalKcal += kcal;
  if (!part.processing) return;
  acc.knownKcal += kcal;
  if (part.processing.level === 4) acc.nova4Kcal += kcal;
  acc.certainty = worse(acc.certainty, part.processing.certainty);
}

function processedOf(acc: ProcessedAcc): ProcessedShare {
  const out: ProcessedShare = {
    nova4Kcal: round(acc.nova4Kcal, 1),
    knownKcal: round(acc.knownKcal, 1),
    totalKcal: round(acc.totalKcal, 1),
    coverage: acc.totalKcal > 0 ? round(acc.knownKcal / acc.totalKcal, 3) : 0,
    certainty: acc.certainty ?? "estimated",
  };
  if (acc.knownKcal > 0) out.share = round(acc.nova4Kcal / acc.knownKcal, 3);
  return out;
}

const GAP_ORDER: Record<CoverageGap["reason"], number> = { unknown: 0, mixedDish: 1, outOfHome: 2, noQuantity: 3 };

function gapOf(line: LineClass): CoverageGap | undefined {
  let worst: { part: ClassPart; reason: CoverageGap["reason"] } | undefined;
  for (const p of line.parts) {
    let reason: CoverageGap["reason"] | undefined;
    if (p.group === "unknown") reason = "unknown";
    else if (p.group === "mixedDish") reason = "mixedDish";
    else if (p.group === "outOfHome") reason = "outOfHome";
    else if (p.grams === undefined && portionKeyOf(p) !== undefined) reason = "noQuantity";
    if (reason && (!worst || GAP_ORDER[reason] < GAP_ORDER[worst.reason])) worst = { part: p, reason };
  }
  if (!worst) return undefined;
  let energy: number | undefined;
  for (const p of line.parts) if (p.energyKcal !== undefined) energy = (energy ?? 0) + p.energyKcal;
  const gap: CoverageGap = { lineKey: line.lineKey, date: line.date, label: worst.part.label, reason: worst.reason };
  if (energy !== undefined) gap.energyKcal = round(energy, 1);
  return gap;
}

/** Riga riconosciuta: la parte riconosciuta pesa almeno metà, per energia se tutte le parti l'hanno, altrimenti per numero. */
function lineIsClassified(line: LineClass): { classified: boolean; estimated: boolean } {
  if (line.parts.length === 0) return { classified: false, estimated: false };
  let kcal = 0;
  let classifiedKcal = 0;
  let allEnergy = true;
  let count = 0;
  let estimated = false;
  for (const p of line.parts) {
    const ok = isClassified(p);
    if (ok) {
      count++;
      if (p.certainty === "estimated") estimated = true;
    }
    if (p.energyKcal === undefined) allEnergy = false;
    else {
      kcal += p.energyKcal;
      if (ok) classifiedKcal += p.energyKcal;
    }
  }
  const share = allEnergy && kcal > 0 ? classifiedKcal / kcal : count / line.parts.length;
  const classified = share >= LINE_CLASSIFIED_SHARE;
  return { classified, estimated: classified && estimated };
}

function plantVarietyOf(days: readonly ClassifiedDay[], foods: ReadonlyMap<string, FoodComposition>) {
  const keys = new Set<string>();
  let unmapped = false;
  for (const { day } of days) {
    for (const lines of [...day.meals.map((m) => m.lines), day.standalone]) {
      for (const line of lines) {
        const ref = line.status === "ok" ? line.composition.ref : undefined;
        const food = ref !== undefined ? foods.get(ref) : undefined;
        if (!food) {
          // Prodotti, preparazioni e voci non risolte possono contenere piante che qui non si vedono.
          if (!(line.status === "ok" && line.outOfHome)) unmapped = true;
          continue;
        }
        const kind = plantKindOf(food);
        if (kind) keys.add(kind.key);
      }
    }
  }
  return { count: keys.size, unmapped };
}

function emptyTallies<K extends string>(keys: readonly K[]): Record<K, GroupTally> {
  const out = {} as Record<K, GroupTally>;
  for (const k of keys) out[k] = { occasions: 0, servings: 0, grams: 0, gramsKnown: true, days: 0, certainty: "label" };
  return out;
}

/** Quadro di una settimana dai giorni già classificati (solo quelli della settimana, fino a oggi). */
function frameOf(cdays: readonly ClassifiedDay[], weekStart: string, today: string, ctx: FrameContext): WeekFrame {
  const weekEnd = addDays(weekStart, 6);
  const inProgress = today <= weekEnd;
  const daysElapsed = inProgress ? Math.max(0, Math.min(7, daysBetween(weekStart, today) + 1)) : 7;
  const { tables } = ctx;

  const rowsByGroup = new Map<DietGroup, GuidelineRow[]>();
  for (const row of tables.rows) {
    if (!(GROUP_ROW_IDS as readonly string[]).includes(row.id)) continue;
    for (const g of row.groups) {
      const list = rowsByGroup.get(g) ?? [];
      list.push(row);
      rowsByGroup.set(g, list);
    }
  }

  const groupAcc = new Map<DietGroup, TallyAcc>();
  const rowAcc = new Map<GroupRowId, TallyAcc>();
  const coverage: Coverage = { lines: 0, classifiedLines: 0, estimatedLines: 0, energyKcal: 0, classifiedKcal: 0, share: 0 };
  const processed: ProcessedAcc = { nova4Kcal: 0, knownKcal: 0, totalKcal: 0 };
  const gaps: CoverageGap[] = [];
  let sugarsG = 0;
  let sugarsCertainty: Certainty | undefined;
  let daysWithData = 0;
  const complete: DayIntake[] = [];

  for (const { day, lines } of cdays) {
    if (lines.length > 0) daysWithData++;
    if (day.complete) complete.push(day);
    for (const line of lines) {
      coverage.lines++;
      const lc = lineIsClassified(line);
      if (lc.classified) coverage.classifiedLines++;
      if (lc.estimated) coverage.estimatedLines++;
      const gap = gapOf(line);
      if (gap) gaps.push(gap);
      for (const part of line.parts) {
        if (part.energyKcal !== undefined) {
          coverage.energyKcal += part.energyKcal;
          if (isClassified(part)) coverage.classifiedKcal += part.energyKcal;
        }
        addProcessed(processed, part);
        if (!isClassified(part)) continue;
        const group = part.group as DietGroup;
        if (day.complete && FREE_SUGAR_GROUPS.has(group) && part.sugarsG !== undefined) {
          sugarsG += part.sugarsG;
          sugarsCertainty = worse(sugarsCertainty, part.certainty);
        }
        const pk = portionKeyOf(part);
        let acc = groupAcc.get(group);
        if (!acc) groupAcc.set(group, (acc = new TallyAcc()));
        acc.add(part, pk, line.occasionKey, line.date, tables);
        for (const row of rowsByGroup.get(group) ?? []) {
          if (!rowMatches(row, group, pk)) continue;
          const id = row.id as GroupRowId;
          let r = rowAcc.get(id);
          if (!r) rowAcc.set(id, (r = new TallyAcc()));
          r.add(part, pk, line.occasionKey, line.date, tables);
        }
      }
    }
  }

  coverage.energyKcal = round(coverage.energyKcal, 1);
  coverage.classifiedKcal = round(coverage.classifiedKcal, 1);
  if (coverage.lines > 0) {
    const byLines = coverage.classifiedLines / coverage.lines;
    const byKcal = coverage.energyKcal > 0 ? coverage.classifiedKcal / coverage.energyKcal : 1;
    coverage.share = round(Math.min(byLines, byKcal), 3);
  }

  const tallies = emptyTallies(DIET_GROUPS);
  for (const [g, acc] of groupAcc) tallies[g] = acc.result();
  const rowTallies = emptyTallies(GROUP_ROW_IDS);
  for (const [id, acc] of rowAcc) rowTallies[id] = acc.result();

  let energy = 0;
  for (const d of complete) energy += d.totals.energyKcal?.value ?? 0;
  const freeSugars: FreeSugarsProxy = {
    grams: complete.length > 0 ? round(sugarsG / complete.length, 1) : 0,
    lowerBound: true,
    certainty: sugarsCertainty ?? "estimated",
  };
  if (complete.length > 0 && energy > 0) freeSugars.percentEnergy = round(((sugarsG * 4) / energy) * 100, 1);

  const plants = plantVarietyOf(cdays, ctx.foods);
  gaps.sort((a, b) => (b.energyKcal ?? -1) - (a.energyKcal ?? -1) || GAP_ORDER[a.reason] - GAP_ORDER[b.reason]);

  const base: Omit<WeekFrame, "indicators"> = {
    weekStart,
    weekEnd,
    inProgress,
    daysElapsed,
    daysWithData,
    completeDays: complete.length,
    coverage,
    tallies,
    rowTallies,
    salt: dailyNutrient(complete, "saltG"),
    fiber: dailyNutrient(complete, "fiberG"),
    freeSugars,
    processed: processedOf(processed),
    plantVariety: { count: plants.count, partial: inProgress || plants.unmapped },
    gaps: gaps.slice(0, MAX_GAPS),
  };
  return { ...base, indicators: indicatorsOf(base, ctx.level, ctx.t, tables) };
}

function thresholdsOf(options: Partial<DietThresholds> | undefined): DietThresholds {
  return { ...DIET_THRESHOLDS, ...options };
}

/** Quadro di una settimana. `days` può contenere anche altri giorni: si usano quelli della settimana fino a oggi. */
export function buildWeekFrame(
  days: readonly DayIntake[],
  weekStart: string,
  today: string,
  input: Omit<DietHistoryInput, "days" | "today">,
  tables: DietTables = DEFAULT_DIET_TABLES,
): WeekFrame {
  const last = addDays(weekStart, 6) < today ? addDays(weekStart, 6) : today;
  const cdays = days
    .filter((d) => d.date >= weekStart && d.date <= last)
    .map((day) => ({ day, lines: input.classifier.day(day) }));
  return frameOf(cdays, weekStart, today, {
    level: input.level,
    foods: input.foods,
    t: thresholdsOf(input.options),
    tables,
  });
}

/** Primo indice con `date >= from` (i giorni di `computeIntake` sono in ordine di data). */
function firstIndexFrom(days: readonly DayIntake[], from: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const MAX_DAILY_DAYS = 90;

/**
 * Storia di `weeks` settimane chiuse (4..8, predefinito 8) più quella in corso, che è l'ultima. Ogni giorno si
 * classifica una volta sola; `daily` copre la stessa finestra o, se richiesto, fino a 90 giorni.
 */
export function buildDietHistory(input: DietHistoryInput, tables: DietTables = DEFAULT_DIET_TABLES): DietHistory {
  const t = thresholdsOf(input.options);
  const n = Math.min(8, Math.max(4, Math.round(input.weeks ?? 8)));
  const { today } = input;
  const current = mondayOf(today);
  const first = addDays(current, -7 * n);
  const minDaily = addDays(today, -(MAX_DAILY_DAYS - 1));
  const dailyFrom = input.dailyFrom && input.dailyFrom < first ? (input.dailyFrom < minDaily ? minDaily : input.dailyFrom) : first;
  const from = dailyFrom < first ? dailyFrom : first;

  const sorted = isSorted(input.days) ? input.days : [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const buckets: ClassifiedDay[][] = Array.from({ length: n + 1 }, () => []);
  const daily: Record<string, { processedShare?: number; coverage: number }> = {};
  for (let i = firstIndexFrom(sorted, from); i < sorted.length; i++) {
    const day = sorted[i];
    if (day.date > today) break;
    const lines = input.classifier.day(day);
    if (day.date >= first) buckets[Math.floor(daysBetween(first, day.date) / 7)].push({ day, lines });
    if (day.date >= dailyFrom && lines.length > 0) {
      const acc: ProcessedAcc = { nova4Kcal: 0, knownKcal: 0, totalKcal: 0 };
      for (const line of lines) for (const p of line.parts) addProcessed(acc, p);
      const p = processedOf(acc);
      daily[day.date] = p.share === undefined ? { coverage: p.coverage } : { processedShare: p.share, coverage: p.coverage };
    }
  }

  const ctx: FrameContext = { level: input.level, foods: input.foods, t, tables };
  const weeks = buckets.map((cdays, i) => frameOf(cdays, addDays(first, 7 * i), today, ctx));
  return { level: input.level, weeks, trends: trendsOf(weeks, t), daily };
}

function isSorted(days: readonly DayIntake[]): boolean {
  for (let i = 1; i < days.length; i++) if (days[i - 1].date > days[i].date) return false;
  return true;
}
