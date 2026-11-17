// Dati per il riepilogo settimanale o mensile. Ogni sezione porta la sua base di dati: un numero
// senza i giorni su cui poggia non si mostra. Nessuna interpretazione: solo ciò che è registrato.

import {
  addDays,
  daysBetween,
  localDate,
  dayCoverage,
  dateRange,
  weightSeries,
  type DiaryState,
} from "../diary";
import { worseCertainty, type Certainty, type DiscardReason, type PantryState, type Unit } from "../ledger";
import {
  compareWithReferences,
  type DayIntake,
  type Profile,
  type ReferenceComparison,
  type ReferenceWithVariant,
} from "../nutrition";
import {
  basisOf,
  inRange,
  insufficient,
  reliabilityBySize,
  weekdayMonday0,
  type DataBasis,
  type Insufficient,
  type Reliability,
} from "./common";
import { mean, round } from "./stats";

export type ReportKind = "week" | "month";

export interface ReportPeriod {
  kind: ReportKind;
  /** Primo e ultimo giorno (inclusi). La settimana va da lunedì a domenica, il mese è di calendario. */
  from: string;
  to: string;
  days: number;
  /** Solo in `buildReport`: il periodo non è finito (con `today` prima della fine). */
  partial?: boolean;
  /** Solo in `buildReport`: ultimo giorno contato (assente se il periodo non è ancora iniziato). */
  through?: string;
  /** Solo in `buildReport`: giorni contati, cioè trascorsi fino a `through`. */
  elapsedDays?: number;
}

/** Il periodo (settimana da lunedì a domenica, o mese di calendario) che contiene la data. */
export function reportPeriod(kind: ReportKind, date: string): ReportPeriod {
  let from: string;
  let to: string;
  if (kind === "week") {
    from = addDays(date, -weekdayMonday0(date));
    to = addDays(from, 6);
  } else {
    from = `${date.slice(0, 7)}-01`;
    const [y, m] = date.split("-").map(Number);
    to = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  }
  return { kind, from, to, days: daysBetween(from, to) + 1 };
}

export interface ReportOptions {
  /** Pesate minime nel periodo per mostrare il peso. Predefinito 3. */
  minWeighIns?: number;
  /** Giorni completi minimi per confrontare i nutrienti con i riferimenti. Predefinito 5. */
  minCompleteDays?: number;
  /**
   * Oggi (`YYYY-MM-DD`). Se cade prima della fine del periodo, i giorni futuri non contano come
   * giorni con vuoti: il periodo è parziale e la base lo dichiara con `partial` e `throughDate`.
   */
  today?: string;
}

export interface ReportInput {
  diary: DiaryState;
  pantry: PantryState;
  /** Giorni con i nutrienti (da `computeIntake`). */
  intakeDays: readonly DayIntake[];
  /** Valori di riferimento e profilo: senza, la sezione dei nutrienti non c'è. */
  references?: readonly ReferenceWithVariant[];
  profile?: Profile;
}

export type NoRecords = Insufficient<"no_records">;
export type FewRecords = Insufficient<"few_records">;

export interface TrackingSection {
  basis: DataBasis;
  completeDays: number;
  /** Giorni con tutti e tre i pasti principali ma almeno uno solo dichiarato non tracciato. */
  declaredDays: number;
  /** Giorni con vuoti, compresi quelli senza alcuna voce. */
  gapDays: number;
  /** Quota dei giorni del periodo tracciati per intero, da 0 a 1. */
  completeShare: number;
}

export interface MealsSection {
  /** Pasti tracciati e pasti segnati come non tracciati nel periodo, in tutti i giorni. */
  tracked: number;
  untracked: number;
  /** Pasti tracciati per giorno, sui soli giorni completi; assente senza giorni completi. */
  trackedPerCompleteDay?: number;
  basis: DataBasis;
}

export type WaterSection =
  | {
      status: "ok";
      totalMl: number;
      /** Giorni con almeno un'acqua registrata: gli altri non dicono "zero", dicono "non registrato". */
      daysLogged: number;
      /** Media sui soli giorni con acqua registrata. */
      averageMlPerLoggedDay: number;
      certainty: Certainty;
      basis: DataBasis;
    }
  | NoRecords;

export type WeightSection =
  | {
      status: "ok";
      weighIns: number;
      first: { date: string; kg: number };
      last: { date: string; kg: number };
      /** Ultima meno prima pesata del periodo: due pesate singole, non una tendenza. */
      changeKg: number;
      averageKg: number;
      minKg: number;
      maxKg: number;
      reliability: Reliability;
      basis: DataBasis;
    }
  | FewRecords
  | NoRecords;

export interface SpendSection {
  status: "ok";
  /** Somma dei prezzi dei soli acquisti con il prezzo registrato, in centesimi. */
  spentCents: number;
  purchasesWithPrice: number;
  purchasesWithoutPrice: number;
  certainty: Certainty;
  basis: DataBasis;
}

export interface WasteItem {
  reason: DiscardReason;
  unit: Unit;
  quantity: number;
  events: number;
}

export interface WasteSection {
  status: "ok";
  items: WasteItem[];
  /** Costo stimato della parte buttata (prezzo del lotto in proporzione), dei soli lotti con prezzo. */
  costCents: number;
  discardsWithPrice: number;
  discardsWithoutPrice: number;
  certainty: Certainty;
  basis: DataBasis;
}

export type NutrientsSection =
  | { status: "ok"; comparisons: ReferenceComparison[]; completeDays: number; basis: DataBasis }
  | (Insufficient<"few_complete_days"> & { completeDays: number });

export interface PeriodicReport {
  period: ReportPeriod;
  tracking: TrackingSection;
  meals: MealsSection;
  water: WaterSection;
  weight: WeightSection;
  spend: SpendSection | NoRecords;
  waste: WasteSection | NoRecords;
  /** Assente se non si sono passati riferimenti e profilo. */
  nutrients?: NutrientsSection;
}

function noRecords(basisExtra: BasisFactory, what: string): NoRecords {
  return insufficient(["no_records"], basisExtra(0, 0), `nessun dato registrato nel periodo per ${what}.`);
}

type BasisFactory = (used: number, observations: number) => DataBasis;

/**
 * Riepilogo del periodo che contiene `date`. Giorni tracciati, pasti, acqua, peso, spesa e spreco
 * del libro mastro e confronto dei nutrienti con i riferimenti passati, ciascuno con la base di
 * dati. I nutrienti usano solo i giorni completi; la spesa e lo spreco contano soltanto ciò che
 * ha un prezzo registrato e lo dicono.
 */
export function buildReport(
  kind: ReportKind,
  date: string,
  input: ReportInput,
  options: ReportOptions = {},
): PeriodicReport {
  const fullPeriod = reportPeriod(kind, date);
  const { diary } = input;
  const { from } = fullPeriod;
  const today = options.today;
  const partial = today !== undefined && today < fullPeriod.to;
  // Ultimo giorno contato: i giorni futuri del periodo in corso non sono giorni con vuoti.
  const through = partial ? (today < from ? undefined : today) : fullPeriod.to;
  const to = through ?? addDays(from, -1);
  const elapsed = through === undefined ? 0 : daysBetween(from, through) + 1;
  const period: ReportPeriod = {
    ...fullPeriod,
    partial,
    ...(through !== undefined ? { through } : {}),
    elapsedDays: elapsed,
  };
  const basis = (used: number, observations: number): DataBasis =>
    basisOf(elapsed, used, observations, {
      ...(partial ? { partial: true } : {}),
      ...(partial && through !== undefined ? { throughDate: through } : {}),
    });
  const minWeighIns = options.minWeighIns ?? 3;
  const minCompleteDays = options.minCompleteDays ?? 5;

  // Tracciamento e pasti.
  // Calcolata giorno per giorno: un periodo senza voci è fatto di giorni con vuoti, non di zero giorni.
  const byDate = new Map(diary.days.map((d) => [d.date, d]));
  const coverageDays = dateRange(from, to).map((d) => dayCoverage(byDate.get(d), d));
  const coverage = {
    days: coverageDays,
    complete: coverageDays.filter((d) => d.status === "complete").length,
    declared: coverageDays.filter((d) => d.status === "declared").length,
    gaps: coverageDays.filter((d) => d.status === "gaps").length,
  };
  const completeSet = new Set(coverage.days.filter((d) => d.status === "complete").map((d) => d.date));
  const tracking: TrackingSection = {
    basis: basis(coverage.complete, coverage.complete),
    completeDays: coverage.complete,
    declaredDays: coverage.declared,
    gapDays: coverage.gaps,
    completeShare: elapsed > 0 ? round(coverage.complete / elapsed, 3) : 0,
  };
  const daysIn = diary.days.filter((d) => inRange(d.date, from, to));
  const tracked = daysIn.reduce((s, d) => s + d.meals.length, 0);
  const untracked = daysIn.reduce((s, d) => s + d.untrackedMeals.length, 0);
  const completeMeals = daysIn.filter((d) => completeSet.has(d.date)).map((d) => d.meals.length);
  const meals: MealsSection = {
    tracked,
    untracked,
    ...(completeMeals.length > 0 ? { trackedPerCompleteDay: round(mean(completeMeals), 2) } : {}),
    basis: basis(completeMeals.length, tracked),
  };

  // Acqua: contano solo i giorni in cui è stata registrata.
  const waterDays = daysIn.filter((d) => d.waterCertainty !== undefined);
  let water: WaterSection;
  if (waterDays.length === 0) water = noRecords(basis, "l'acqua");
  else {
    const total = waterDays.reduce((s, d) => s + d.waterMl, 0);
    let certainty: Certainty = waterDays[0].waterCertainty as Certainty;
    for (const d of waterDays) certainty = worseCertainty(certainty, d.waterCertainty as Certainty);
    water = {
      status: "ok",
      totalMl: round(total, 3),
      daysLogged: waterDays.length,
      averageMlPerLoggedDay: round(total / waterDays.length, 1),
      certainty,
      basis: basis(waterDays.length, waterDays.length),
    };
  }

  // Peso.
  const weights = weightSeries(diary, { from, to });
  let weight: WeightSection;
  if (weights.length === 0) weight = noRecords(basis, "il peso");
  else if (weights.length < minWeighIns) {
    weight = insufficient(
      ["few_records"],
      basis(weights.length, weights.length),
      `servono almeno ${minWeighIns} pesate nel periodo, ce ne sono ${weights.length}.`,
    );
  } else {
    const kgs = weights.map((w) => w.kg);
    const first = weights[0];
    const last = weights[weights.length - 1];
    weight = {
      status: "ok",
      weighIns: weights.length,
      first: { date: first.date, kg: first.kg },
      last: { date: last.date, kg: last.kg },
      changeKg: round(last.kg - first.kg, 3),
      averageKg: round(mean(kgs), 3),
      minKg: Math.min(...kgs),
      maxKg: Math.max(...kgs),
      reliability: reliabilityBySize(weights.length, { moderate: 5, good: 10 }),
      basis: basis(weights.length, weights.length),
    };
  }

  // Spesa e spreco dal libro mastro (il giorno è quello locale dell'istante dell'evento).
  const dayOf = (instant: string): string | undefined => localDate(instant, diary.timeZone);
  const purchases = input.pantry.lots.filter((l) => {
    const d = dayOf(l.createdAt);
    return l.origin === "purchase" && d !== undefined && inRange(d, from, to);
  });
  let spend: SpendSection | NoRecords;
  if (purchases.length === 0) spend = noRecords(basis, "gli acquisti");
  else {
    const priced = purchases.filter((l) => l.priceCents !== undefined);
    let certainty: Certainty = "measured";
    for (const l of priced) certainty = worseCertainty(certainty, l.priceCertainty ?? "estimated");
    spend = {
      status: "ok",
      spentCents: priced.reduce((s, l) => s + (l.priceCents ?? 0), 0),
      purchasesWithPrice: priced.length,
      purchasesWithoutPrice: purchases.length - priced.length,
      certainty,
      basis: basis(new Set(purchases.map((l) => dayOf(l.createdAt))).size, purchases.length),
    };
  }

  const buckets = new Map<string, WasteItem>();
  let wasteCost = 0;
  let withPrice = 0;
  let withoutPrice = 0;
  let wasteCertainty: Certainty = "measured";
  const wasteDays = new Set<string>();
  for (const lot of input.pantry.lots) {
    // Come nello spreco del libro mastro: la quota di prezzo buttata non supera mai il prezzo.
    let wastedFraction = 0;
    for (const h of lot.history) {
      if (h.type !== "discard" || h.reason === undefined) continue;
      const amount = -(h.quantityDelta ?? 0);
      if (amount <= 0) continue;
      const fraction = Math.min(amount / lot.initial, 1 - wastedFraction);
      wastedFraction += fraction;
      const d = dayOf(h.at);
      if (d === undefined || !inRange(d, from, to)) continue;
      wasteDays.add(d);
      const key = `${h.reason}|${lot.unit}`;
      const b = buckets.get(key) ?? { reason: h.reason, unit: lot.unit, quantity: 0, events: 0 };
      b.quantity = round(b.quantity + amount, 9);
      b.events += 1;
      buckets.set(key, b);
      wasteCertainty = worseCertainty(wasteCertainty, h.certainty);
      if (lot.priceCents !== undefined) {
        wasteCost += lot.priceCents * fraction;
        withPrice++;
        wasteCertainty = worseCertainty(wasteCertainty, lot.priceCertainty ?? "estimated");
      } else withoutPrice++;
    }
  }
  let waste: WasteSection | NoRecords;
  if (buckets.size === 0) waste = noRecords(basis, "gli scarti");
  else {
    waste = {
      status: "ok",
      items: [...buckets.values()].sort((a, b) =>
        a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0,
      ),
      costCents: Math.round(wasteCost),
      discardsWithPrice: withPrice,
      discardsWithoutPrice: withoutPrice,
      certainty: wasteCertainty,
      basis: basis(wasteDays.size, withPrice + withoutPrice),
    };
  }

  const report: PeriodicReport = { period, tracking, meals, water, weight, spend, waste };

  // Nutrienti rispetto ai riferimenti: solo giorni completi.
  if (input.references !== undefined && input.profile !== undefined) {
    const daysInPeriod = input.intakeDays.filter((d) => inRange(d.date, from, to));
    const complete = daysInPeriod.filter((d) => d.complete).length;
    const nutrientBasis = basis(complete, complete);
    report.nutrients =
      complete < minCompleteDays
        ? {
            ...insufficient(
              ["few_complete_days"],
              nutrientBasis,
              `servono almeno ${minCompleteDays} giorni tracciati per intero, ce ne sono ${complete}.`,
            ),
            completeDays: complete,
          }
        : {
            status: "ok",
            comparisons: compareWithReferences(daysInPeriod, input.references, input.profile, {
              minCompleteDays,
            }),
            completeDays: complete,
            basis: nutrientBasis,
          };
  }
  return report;
}
