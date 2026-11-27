// Indicatori del quadro settimanale e loro stato rispetto alle indicazioni delle linee guida.

import { worseCertainty, type Certainty } from "../ledger";
import { GUIDELINE_ROWS, PORTIONS, targetFor } from "./data/guidelines";
import {
  GROUP_ROW_IDS,
  type DietGroup,
  type DietThresholds,
  type EnergyLevel,
  type GroupTally,
  type GuidelineRow,
  type GuidelineRowId,
  type Indicator,
  type IndicatorStatus,
  type IndicatorUnit,
  type InsufficientReason,
  type PortionTable,
  type TargetView,
  type WeekFrame,
} from "./types";

/** Tabelle delle linee guida su cui si calcola: quelle vere di `data/guidelines`, o finte nei test. */
export interface DietTables {
  rows: readonly GuidelineRow[];
  portions: PortionTable;
  targetFor(row: GuidelineRowId, level: EnergyLevel): TargetView | undefined;
}

export const DEFAULT_DIET_TABLES: DietTables = { rows: GUIDELINE_ROWS, portions: PORTIONS, targetFor };

/** Gruppi di «verdura e frutta» se la riga `vegFruitTotal` non li elenca. */
const VEG_FRUIT_GROUPS: readonly DietGroup[] = ["vegetables", "fruit"];

type FrameBase = Omit<WeekFrame, "indicators">;

/**
 * Un quadro ha dati sufficienti se ha abbastanza giorni registrati e abbastanza voci riconosciute. Gli andamenti e i
 * riepiloghi di periodo usano solo questi quadri.
 */
export function frameSufficient(
  frame: Pick<WeekFrame, "daysWithData" | "coverage">,
  t: Pick<DietThresholds, "minDaysWithData" | "minCoverage">,
): boolean {
  return frame.daysWithData >= t.minDaysWithData && frame.coverage.share >= t.minCoverage;
}

function daysReason(frame: FrameBase, t: DietThresholds): InsufficientReason | undefined {
  if (frame.daysWithData === 0) return "no_data";
  if (frame.daysWithData < t.minDaysWithData) return "few_days";
  return undefined;
}

/**
 * Si può dire «sotto» (e «dentro») solo a settimana chiusa, con abbastanza giorni e con la copertura propria
 * dell'indicatore sopra la soglia: altrimenti ciò che manca potrebbe colmare la distanza.
 */
function canConclude(frame: FrameBase, coverage: number, t: DietThresholds): boolean {
  return !frame.inProgress && frame.daysWithData >= t.belowDays && coverage >= t.belowCoverage;
}

interface StatusInput {
  value?: number;
  target?: TargetView;
  insufficient?: InsufficientReason;
  /** Il valore è un conteggio della settimana: può solo crescere, quindi «sopra» vale anche con dati parziali. */
  cumulative: boolean;
  conclude: boolean;
  /**
   * Il valore è un minimo per una ragione che le soglie di giorni e copertura di `canConclude` non misurano: grammi
   * ignoti di voci riconosciute, giorni con pasti mancanti. Allora non si dice né «sotto» né «dentro» un tetto: si dice
   * «almeno».
   */
  unmeasured?: boolean;
  /** Stime per difetto in cui «dentro» non si dichiara mai (zuccheri liberi). */
  neverWithin?: boolean;
}

function statusOf(i: StatusInput): { status: IndicatorStatus; insufficient?: InsufficientReason } {
  const kind = i.target?.kind;
  if (kind === "occasional" || kind === "notAdvised") {
    return i.insufficient ? { status: "insufficient", insufficient: i.insufficient } : { status: "occasional" };
  }
  if (i.value === undefined) return { status: "insufficient", insufficient: i.insufficient ?? "no_data" };
  const min = i.target?.min;
  const max = i.target?.max;
  if (min === undefined && max === undefined) {
    return i.insufficient ? { status: "insufficient", insufficient: i.insufficient } : { status: "noTarget" };
  }
  // Asimmetria del minimo: il valore è un minimo, se supera già il tetto lo supera di sicuro.
  if (max !== undefined && i.value > max && (i.cumulative || !i.insufficient)) return { status: "above" };
  if (i.insufficient) return { status: "insufficient", insufficient: i.insufficient };
  const conclude = i.conclude && !i.unmeasured;
  if (min !== undefined && i.value < min) return { status: conclude ? "below" : "atLeast" };
  if (i.neverWithin) return { status: "atLeast" };
  // Minimo raggiunto senza tetto: un minimo che lo raggiunge lo prova.
  if (max === undefined) return { status: "within" };
  return { status: conclude ? "within" : "atLeast" };
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** L'indicazione della riga; per i tipi qualitativi la si costruisce dalla riga, senza numeri, per citarne la fonte. */
export function targetOfRow(row: GuidelineRow, level: EnergyLevel, tables: DietTables): TargetView | undefined {
  if (row.kind === "occasional" || row.kind === "notAdvised") {
    return { kind: row.kind, row: row.id, source: row.source, where: row.where };
  }
  return tables.targetFor(row.id, level);
}

function make(
  base: Omit<Indicator, "status" | "insufficient">,
  status: { status: IndicatorStatus; insufficient?: InsufficientReason },
): Indicator {
  const out: Indicator = { ...base, status: status.status };
  if (base.value === undefined) delete out.value;
  if (base.target === undefined) delete out.target;
  if (status.status === "insufficient") out.insufficient = status.insufficient ?? "no_data";
  return out;
}

/** Valore di una riga di gruppo secondo il tipo d'indicazione. */
function groupMeasure(
  frame: FrameBase,
  tally: GroupTally,
  kind: GuidelineRow["kind"],
): { value?: number; unit: IndicatorUnit; cumulative: boolean; lowerBound: boolean; unmeasured: boolean } {
  const weekPartial = frame.inProgress || frame.daysWithData < 7 || frame.coverage.share < 1;
  const incompleteDays = frame.completeDays < frame.daysWithData;
  const dayPartial = incompleteDays || frame.coverage.share < 1;
  const perDay = (n: number) => (frame.daysWithData > 0 ? round(n / frame.daysWithData) : undefined);
  switch (kind) {
    case "perDay":
    case "maxPerDay":
      return {
        value: perDay(tally.servings),
        unit: "servingsPerDay",
        cumulative: false,
        lowerBound: dayPartial,
        unmeasured: incompleteDays,
      };
    case "gramsPerDayMin":
    case "gramsPerDayMax":
      return {
        value: perDay(tally.grams),
        unit: "gramsPerDay",
        cumulative: false,
        lowerBound: dayPartial || !tally.gramsKnown,
        // pezzi senza peso: la copertura li conta come riconosciuti, ma i loro grammi mancano dalla somma
        unmeasured: incompleteDays || !tally.gramsKnown,
      };
    case "occasional":
    case "notAdvised":
      // «Occasionale» si conta in volte, non in porzioni.
      return { value: tally.occasions, unit: "count", cumulative: true, lowerBound: weekPartial, unmeasured: incompleteDays };
    default:
      return {
        value: tally.servings,
        unit: "servingsPerWeek",
        cumulative: true,
        lowerBound: weekPartial,
        unmeasured: incompleteDays,
      };
  }
}

function worse(a: Certainty | undefined, b: Certainty): Certainty {
  return a === undefined ? b : worseCertainty(a, b);
}

/**
 * Indicatori di un quadro: uno per ogni riga di gruppo delle linee guida, poi verdura e frutta, quota integrale,
 * sale, zuccheri liberi, fibre, quota di energia da prodotti molto lavorati e varietà vegetale.
 */
export function indicatorsOf(
  frame: FrameBase,
  level: EnergyLevel,
  t: DietThresholds,
  tables: DietTables = DEFAULT_DIET_TABLES,
): Indicator[] {
  const rows = new Map(tables.rows.map((r) => [r.id, r]));
  const days = daysReason(frame, t);
  const share = frame.coverage.share;
  const classified: InsufficientReason | undefined = days ?? (share < t.minCoverage ? "low_coverage" : undefined);
  const out: Indicator[] = [];

  for (const id of GROUP_ROW_IDS) {
    const row = rows.get(id);
    if (!row) continue;
    const tally = frame.rowTallies[id];
    const target = targetOfRow(row, level, tables);
    const m = groupMeasure(frame, tally, row.kind);
    out.push(
      make(
        {
          id: `group:${id}`,
          value: m.value,
          unit: m.unit,
          lowerBound: m.lowerBound,
          certainty: tally.certainty,
          coverage: share,
          target,
        },
        statusOf({
          value: m.value,
          target,
          insufficient: classified,
          cumulative: m.cumulative,
          conclude: canConclude(frame, share, t),
          unmeasured: m.unmeasured,
        }),
      ),
    );
  }

  // Verdura e frutta insieme.
  const vfRow = rows.get("vegFruitTotal");
  if (vfRow) {
    const groups = vfRow.groups.length > 0 ? vfRow.groups : VEG_FRUIT_GROUPS;
    const sum: GroupTally = { occasions: 0, servings: 0, grams: 0, gramsKnown: true, days: 0, certainty: "label" };
    let certainty: Certainty | undefined;
    for (const g of groups) {
      const tl = frame.tallies[g];
      sum.servings += tl.servings;
      sum.grams += tl.grams;
      sum.gramsKnown &&= tl.gramsKnown;
      certainty = worse(certainty, tl.certainty);
    }
    sum.certainty = certainty ?? "label";
    const target = targetOfRow(vfRow, level, tables);
    const m = groupMeasure(frame, sum, vfRow.kind);
    out.push(
      make(
        { id: "vegFruit", value: m.value, unit: m.unit, lowerBound: m.lowerBound, certainty: sum.certainty, coverage: share, target },
        statusOf({
          value: m.value,
          target,
          insufficient: classified,
          cumulative: m.cumulative,
          conclude: canConclude(frame, share, t),
          unmeasured: m.unmeasured,
        }),
      ),
    );
  }

  // Quota integrale sui cereali: è un rapporto, non un minimo.
  const wgRow = rows.get("wholeGrainShare");
  if (wgRow) {
    const whole = frame.tallies.wholeGrains;
    const refined = frame.tallies.refinedGrains;
    const total = whole.servings + refined.servings;
    const value = total > 0 ? round(whole.servings / total) : undefined;
    const target = targetOfRow(wgRow, level, tables);
    out.push(
      make(
        {
          id: "wholeGrainShare",
          value,
          unit: "share",
          lowerBound: false,
          certainty: worse(whole.certainty, refined.certainty),
          coverage: share,
          target,
        },
        // con giorni a cui mancano pasti la quota può cambiare in un verso o nell'altro: non si conclude
        statusOf({
          value,
          target,
          insufficient: classified,
          cumulative: false,
          conclude: canConclude(frame, share, t),
          unmeasured: frame.completeDays < frame.daysWithData,
        }),
      ),
    );
  }

  // Nutrienti per giorno, sui soli giorni completi: la copertura è quella del nutriente.
  for (const key of ["salt", "fiber"] as const) {
    const row = rows.get(key);
    if (!row) continue;
    const n = frame[key];
    const coverage = round(1 - n.missingShare);
    const insufficient =
      days ??
      (n.completeDays < t.minCompleteDays ? "few_complete_days" : coverage < t.minCoverage ? "low_coverage" : undefined);
    const target = targetOfRow(row, level, tables);
    out.push(
      make(
        {
          id: key,
          value: n.average,
          unit: "gramsPerDay",
          lowerBound: n.partial,
          certainty: n.certainty ?? "estimated",
          coverage,
          target,
        },
        statusOf({
          value: n.average,
          target,
          insufficient,
          cumulative: false,
          conclude: canConclude(frame, coverage, t),
        }),
      ),
    );
  }

  // Zuccheri liberi: sempre una stima per difetto, «dentro» non si dice mai.
  const fsRow = rows.get("freeSugars");
  if (fsRow) {
    const fs = frame.freeSugars;
    const insufficient =
      classified ?? (frame.completeDays < t.minCompleteDays ? "few_complete_days" : undefined);
    const target = targetOfRow(fsRow, level, tables);
    out.push(
      make(
        {
          id: "freeSugars",
          value: fs.percentEnergy,
          unit: "percentEnergy",
          lowerBound: true,
          certainty: fs.certainty,
          coverage: share,
          target,
        },
        statusOf({
          value: fs.percentEnergy,
          target,
          insufficient,
          cumulative: false,
          conclude: canConclude(frame, share, t),
          neverWithin: true,
        }),
      ),
    );
  }

  // Molto lavorati: nessuna soglia ufficiale, solo l'andamento personale.
  const p = frame.processed;
  const pInsufficient = days ?? (p.coverage < t.minCoverage ? "low_coverage" : undefined);
  out.push(
    make(
      {
        id: "processedShare",
        value: p.share === undefined ? undefined : round(p.share, 3),
        unit: "share",
        lowerBound: false,
        certainty: p.certainty,
        coverage: round(p.coverage),
      },
      statusOf({ value: p.share, insufficient: pInsufficient, cumulative: false, conclude: false }),
    ),
  );

  out.push(
    make(
      {
        id: "plantVariety",
        value: frame.plantVariety.count,
        unit: "count",
        lowerBound: frame.plantVariety.partial,
        certainty: "estimated",
        coverage: share,
      },
      statusOf({ value: frame.plantVariety.count, insufficient: days, cumulative: true, conclude: false }),
    ),
  );

  return out;
}
