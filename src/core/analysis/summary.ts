// Riepilogo di un periodo lungo (mese, anno, intervallo): il cibo che è entrato, è stato mangiato e buttato, gli
// alimenti e i piatti più frequenti, l'umore, lo spreco con i suoi motivi e il confronto con il periodo
// precedente. Si somma al rapporto (`report.ts`), che già dà giorni tracciati, pasti, acqua, peso e nutrienti:
// qui non si ripete nulla di ciò. Ogni parte porta i giorni su cui poggia; dove un dato non è registrato non
// c'è uno zero. Nessun giudizio: solo ciò che è scritto nel registro.

import {
  addDays,
  dateRange,
  dayCoverage,
  localDate,
  type DiaryDay,
  type DiaryState,
} from "../diary";
import { worseCertainty, type Certainty, type DiscardReason, type Lot, type PantryState, type Unit } from "../ledger";
import { basisOf, inRange, insufficient, reliabilityBySize, type DataBasis, type Insufficient, type Reliability } from "./common";
import { countedPeriod, type ReportPeriod } from "./report";
import { mean, round } from "./stats";

/** Quanti giorni servono, in un periodo di `days` giorni, perché lo si confronti con un altro: metà, e comunque 3. */
export function comparisonMinDays(days: number): number {
  return Math.max(3, Math.ceil(days / 2));
}

export const SUMMARY_MIN = {
  /** Giorni con umore registrato per mostrare la media. */
  moodDays: 3,
  /** Giorni con acqua, pesate e giorni con umore da avere in entrambi i periodi per confrontarli. */
  comparedWaterDays: 3,
  comparedWeighIns: 3,
  comparedMoodDays: 3,
  /** Quanti alimenti e piatti mostrare. */
  topN: 5,
} as const;

export interface QuantityTotal {
  unit: Unit;
  value: number;
}

export type NoSummaryRecords = Insufficient<"no_records">;
export type FewSummaryRecords = Insufficient<"few_records">;

/** Cibo entrato, mangiato: quantità per unità (g, ml, pz non si sommano tra loro) e, dove c'è il prezzo, il valore. */
export interface FlowSection {
  status: "ok";
  quantities: QuantityTotal[];
  /** Valore delle sole parti con il prezzo del lotto registrato, in centesimi. */
  valueCents: number;
  withPrice: number;
  withoutPrice: number;
  certainty: Certainty;
  basis: DataBasis;
}

export interface EnteredSection extends Omit<FlowSection, "status"> {
  status: "ok";
  /** Acquisti (lotti nati da un acquisto) nel periodo. */
  lots: number;
  /** Lotti dichiarati «già in casa» nel periodo: non sono entrati col periodo e non si contano nelle quantità. */
  declaredLots: number;
}

export interface FoodCount {
  name: string;
  /** Giorni del periodo in cui è stato mangiato. */
  days: number;
  quantities: QuantityTotal[];
}

export type TopFoodsSection =
  | { status: "ok"; items: FoodCount[]; distinct: number; basis: DataBasis }
  | NoSummaryRecords;

export interface DishCount {
  title: string;
  count: number;
}

export type DishesSection =
  | {
      status: "ok";
      /** Pasti con un nome (un piatto cucinato dal ricettario o scritto a mano) nel periodo. */
      cooked: number;
      distinct: number;
      top: DishCount[];
      /**
       * Nomi che nel registro non comparivano prima del periodo. Assente quando il registro non ha
       * nulla prima del periodo: allora non si distingue il nuovo dal già fatto.
       */
      newTitles?: string[];
      basis: DataBasis;
    }
  | NoSummaryRecords;

export type MoodSection =
  | {
      status: "ok";
      days: number;
      /** Media dei punteggi giornalieri (1-5) sui soli giorni con umore registrato. */
      average: number;
      min: number;
      max: number;
      reliability: Reliability;
      basis: DataBasis;
    }
  | FewSummaryRecords
  | NoSummaryRecords;

export interface WasteReasonItem {
  reason: DiscardReason;
  quantities: QuantityTotal[];
  events: number;
}

export interface WasteCategoryItem {
  /** `null` = lotti senza categoria nel registro. */
  category: string | null;
  quantities: QuantityTotal[];
  events: number;
}

export interface WasteDiscards extends Omit<FlowSection, "status"> {
  status: "ok";
  /** Solo i motivi che compaiono davvero nel registro del periodo. */
  byReason: WasteReasonItem[];
  byCategory: WasteCategoryItem[];
  events: number;
}

export interface SavedSection {
  /** Lotti spostati in freezer entro la data di scadenza nel periodo (solo quelli con scadenza nota). */
  lots: number;
  /** Quantità che c'era al momento di congelare. */
  quantities: QuantityTotal[];
  /** Peggior certezza tra le scadenze dei lotti (una scadenza stimata dà `estimated`). */
  certainty: Certainty;
}

export interface WasteSummary {
  discards: WasteDiscards | NoSummaryRecords;
  /** Assente se nel periodo non c'è nulla di salvato. */
  saved?: SavedSection;
  /**
   * Lotti la cui scadenza cade nel periodo e che risultano ancora in dispensa con della quantità:
   * non sono «buttati» finché non lo si registra.
   */
  expiredUnresolved: number;
}

export type ComparisonId = "completeDays" | "waterAvg" | "weightAvg" | "moodAvg" | "eatenG" | "wastedG" | "spendCents";

export interface ComparisonMetric {
  id: ComparisonId;
  current: number;
  previous: number;
  /** `current - previous`, senza giudizio: un numero con il segno. */
  delta: number;
}

export type ComparisonSection =
  | {
      status: "ok";
      /** Il periodo precedente della stessa durata (i giorni contati). */
      previous: { from: string; to: string; days: number };
      /** Soglia usata: giorni con qualcosa di registrato richiesti a ciascun periodo. */
      minRecordedDays: number;
      recordedDays: { current: number; previous: number };
      metrics: ComparisonMetric[];
    }
  | (Insufficient<"few_recorded_days" | "no_days"> & {
      previous?: { from: string; to: string; days: number };
      minRecordedDays: number;
      recordedDays: { current: number; previous: number };
    });

export interface PeriodSummary {
  period: ReportPeriod;
  /** Giorni con almeno qualcosa di registrato (diario o dispensa). */
  recordedDays: number;
  basis: DataBasis;
  entered: EnteredSection | NoSummaryRecords;
  eaten: FlowSection | NoSummaryRecords;
  topFoods: TopFoodsSection;
  /**
   * Pasti fuori casa registrati come stima nel periodo. Non sono cibo di cui si conosca nome o quantità: non entrano
   * in `eaten`, in `topFoods` né nei piatti, e si dicono a parte.
   */
  outOfHomeMeals: number;
  dishes: DishesSection;
  mood: MoodSection;
  waste: WasteSummary;
  comparison: ComparisonSection;
}

export interface SummaryInput {
  diary: DiaryState;
  pantry: PantryState;
}

export interface SummaryOptions {
  /** Oggi (`YYYY-MM-DD`): i giorni dopo oggi non contano come giorni con vuoti. */
  today?: string;
}

// ---------------------------------------------------------------- raccolta per finestra di giorni

const norm = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

class Quantities {
  private readonly by = new Map<Unit, number>();
  add(unit: Unit, value: number): void {
    this.by.set(unit, (this.by.get(unit) ?? 0) + value);
  }
  get(unit: Unit): number {
    return this.by.get(unit) ?? 0;
  }
  list(): QuantityTotal[] {
    return (["g", "ml", "pz"] as const)
      .filter((u) => this.by.has(u))
      .map((unit) => ({ unit, value: round(this.by.get(unit) as number, 3) }));
  }
}

interface FlowAcc {
  q: Quantities;
  value: number;
  withPrice: number;
  withoutPrice: number;
  certainty: Certainty;
  days: Set<string>;
  events: number;
}

const newFlow = (): FlowAcc => ({
  q: new Quantities(),
  value: 0,
  withPrice: 0,
  withoutPrice: 0,
  certainty: "measured",
  days: new Set(),
  events: 0,
});

function addToFlow(acc: FlowAcc, lot: Lot, amount: number, certainty: Certainty, day: string, fraction?: number): void {
  acc.q.add(lot.unit, amount);
  acc.days.add(day);
  acc.events += 1;
  acc.certainty = worseCertainty(acc.certainty, certainty);
  if (lot.priceCents !== undefined && lot.initial > 0) {
    acc.value += lot.priceCents * (fraction ?? Math.min(amount / lot.initial, 1));
    acc.withPrice += 1;
    acc.certainty = worseCertainty(acc.certainty, lot.priceCertainty ?? "estimated");
  } else acc.withoutPrice += 1;
}

interface Window {
  from: string;
  /** Ultimo giorno contato; precede `from` se la finestra è vuota. */
  to: string;
  days: number;
  recorded: Set<string>;
  completeDays: number;
  water: { days: number; totalMl: number };
  weight: number[];
  mood: { perDay: number[] };
  entered: FlowAcc & { declaredLots: number };
  eaten: FlowAcc;
  eatenFoods: Map<string, { name: string; days: Set<string>; q: Quantities }>;
  outOfHomeMeals: number;
  wasted: FlowAcc;
  wasteReasons: Map<DiscardReason, { q: Quantities; events: number }>;
  wasteCategories: Map<string, { category: string | null; q: Quantities; events: number }>;
  dishes: Map<string, { title: string; count: number }>;
  saved: { lots: number; q: Quantities; certainty: Certainty };
  expiredUnresolved: number;
  spend: { cents: number; priced: number };
}

function hasDiaryData(d: DiaryDay): boolean {
  return (
    d.meals.length > 0 ||
    d.untrackedMeals.length > 0 ||
    d.declarations.length > 0 ||
    d.waterCertainty !== undefined ||
    d.drinks.length > 0 ||
    d.weights.length > 0 ||
    d.moods.length > 0
  );
}

function collect(from: string, to: string, input: SummaryInput, expiredBefore: string): Window {
  const { diary, pantry } = input;
  const tz = diary.timeZone;
  const dayOf = (instant: string): string | undefined => localDate(instant, tz);
  const span = dateRange(from, to);
  const w: Window = {
    from,
    to,
    days: span.length,
    recorded: new Set(),
    completeDays: 0,
    water: { days: 0, totalMl: 0 },
    weight: [],
    mood: { perDay: [] },
    entered: { ...newFlow(), declaredLots: 0 },
    eaten: newFlow(),
    eatenFoods: new Map(),
    outOfHomeMeals: 0,
    wasted: newFlow(),
    wasteReasons: new Map(),
    wasteCategories: new Map(),
    dishes: new Map(),
    saved: { lots: 0, q: new Quantities(), certainty: "label" },
    expiredUnresolved: 0,
    spend: { cents: 0, priced: 0 },
  };

  const byDate = new Map(diary.days.map((d) => [d.date, d]));
  for (const date of span) {
    const d = byDate.get(date);
    if (dayCoverage(d, date).status === "complete") w.completeDays++;
  }
  const eatFood = (name: string, day: string, unit: Unit, amount: number): void => {
    const key = norm(name);
    if (key === "") return;
    const f = w.eatenFoods.get(key) ?? { name: name.trim().replace(/\s+/g, " "), days: new Set<string>(), q: new Quantities() };
    f.days.add(day);
    f.q.add(unit, amount);
    w.eatenFoods.set(key, f);
  };

  // Diario.
  for (const d of diary.days) {
    if (!inRange(d.date, from, to)) continue;
    if (hasDiaryData(d)) w.recorded.add(d.date);
    if (d.waterCertainty !== undefined) {
      w.water.days++;
      w.water.totalMl += d.waterMl;
    }
    if (d.weightKg !== undefined) w.weight.push(d.weightKg);
    if (d.moods.length > 0) w.mood.perDay.push(mean(d.moods.map((m) => m.score)));
    for (const m of d.meals) {
      for (const item of m.items) {
        // Una stima «fuori casa» («1 pz», con la sola energia) non è un alimento né una quantità mangiata: si conta a parte.
        if (item.energyKcal !== undefined) {
          w.outOfHomeMeals += 1;
          continue;
        }
        w.eaten.q.add(item.quantity.unit, item.quantity.value);
        w.eaten.days.add(d.date);
        w.eaten.events += 1;
        w.eaten.certainty = worseCertainty(w.eaten.certainty, item.certainty);
        eatFood(item.name, d.date, item.quantity.unit, item.quantity.value);
      }
      const title = m.title?.trim().replace(/\s+/g, " ");
      if (title !== undefined && title !== "") {
        const key = norm(title);
        const cur = w.dishes.get(key) ?? { title, count: 0 };
        cur.count += 1;
        w.dishes.set(key, cur);
      }
    }
  }

  // Dispensa: i lotti dei soli eventi non annullati (`derivePantry` li ha già tolti).
  for (const lot of pantry.lots) {
    const createdDay = dayOf(lot.createdAt);
    if (createdDay !== undefined && inRange(createdDay, from, to)) {
      w.recorded.add(createdDay);
      if (lot.origin === "declare") w.entered.declaredLots++;
      else {
        const e = w.entered;
        e.q.add(lot.unit, lot.initial);
        e.days.add(createdDay);
        e.events += 1;
        e.certainty = worseCertainty(e.certainty, lot.initialCertainty);
        if (lot.priceCents !== undefined) {
          e.value += lot.priceCents;
          e.withPrice += 1;
          e.certainty = worseCertainty(e.certainty, lot.priceCertainty ?? "estimated");
          w.spend.cents += lot.priceCents;
          w.spend.priced += 1;
        } else e.withoutPrice += 1;
      }
    }
    let remainingBefore = lot.initial;
    let wastedFraction = 0;
    for (const h of lot.history) {
      const delta = h.quantityDelta ?? 0;
      const day = dayOf(h.at);
      if (h.type === "move" && lot.frozenAt === h.at && day !== undefined && inRange(day, from, to)) {
        const expiryDay = lot.expiry?.date;
        if (expiryDay !== undefined && day <= expiryDay && remainingBefore > 0) {
          w.saved.lots += 1;
          w.saved.q.add(lot.unit, remainingBefore);
          if (lot.expiry?.kind === "estimated") w.saved.certainty = "estimated";
          w.recorded.add(day);
        }
      }
      if (h.type === "consume" && delta < 0 && day !== undefined && inRange(day, from, to)) {
        addToFlow(w.eaten, lot, -delta, h.certainty, day);
        eatFood(lot.productRef, day, lot.unit, -delta);
        w.recorded.add(day);
      }
      if (h.type === "discard" && h.reason !== undefined && delta < 0) {
        const amount = -delta;
        // Come nello spreco del libro mastro: la quota di prezzo buttata non supera mai il prezzo.
        const fraction = lot.initial > 0 ? Math.min(amount / lot.initial, 1 - wastedFraction) : 0;
        wastedFraction += fraction;
        if (day !== undefined && inRange(day, from, to)) {
          w.recorded.add(day);
          addToFlow(w.wasted, lot, amount, h.certainty, day, fraction);
          const r = w.wasteReasons.get(h.reason) ?? { q: new Quantities(), events: 0 };
          r.q.add(lot.unit, amount);
          r.events += 1;
          w.wasteReasons.set(h.reason, r);
          const catKey = lot.category === undefined || lot.category.trim() === "" ? "" : norm(lot.category);
          const c = w.wasteCategories.get(catKey) ?? {
            category: catKey === "" ? null : (lot.category as string).trim(),
            q: new Quantities(),
            events: 0,
          };
          c.q.add(lot.unit, amount);
          c.events += 1;
          w.wasteCategories.set(catKey, c);
        }
      }
      remainingBefore += delta;
    }
    if (
      lot.status === "active" &&
      lot.remaining > 0 &&
      lot.location !== "freezer" &&
      lot.expiry !== undefined &&
      lot.expiry.date >= from &&
      lot.expiry.date <= to &&
      lot.expiry.date < expiredBefore
    ) {
      w.expiredUnresolved++;
    }
  }
  return w;
}

// ---------------------------------------------------------------- sezioni

function flowSection(f: FlowAcc, basis: (used: number, obs: number) => DataBasis): FlowSection {
  return {
    status: "ok",
    quantities: f.q.list(),
    valueCents: Math.round(f.value),
    withPrice: f.withPrice,
    withoutPrice: f.withoutPrice,
    certainty: f.certainty,
    basis: basis(f.days.size, f.events),
  };
}

function compare(cur: Window, prev: Window, prevRange: { from: string; to: string }): ComparisonSection {
  const min = comparisonMinDays(cur.days);
  const recordedDays = { current: cur.recorded.size, previous: prev.recorded.size };
  const base = { minRecordedDays: min, recordedDays };
  if (cur.days === 0) {
    return { ...insufficient(["no_days"], basisOf(0, 0, 0), "nel periodo non c'è ancora nessun giorno da confrontare."), ...base };
  }
  const previous = { from: prevRange.from, to: prevRange.to, days: prev.days };
  if (recordedDays.current < min || recordedDays.previous < min) {
    return {
      ...insufficient(
        ["few_recorded_days"],
        basisOf(cur.days, recordedDays.current, recordedDays.current),
        `servono almeno ${min} giorni con qualcosa di registrato in ciascun periodo: ${recordedDays.current} in questo, ${recordedDays.previous} nel precedente.`,
      ),
      previous,
      ...base,
    };
  }
  const metrics: ComparisonMetric[] = [];
  const push = (id: ComparisonId, current: number, previousValue: number): void => {
    metrics.push({ id, current, previous: previousValue, delta: round(current - previousValue, 3) });
  };
  push("completeDays", cur.completeDays, prev.completeDays);
  if (cur.water.days >= SUMMARY_MIN.comparedWaterDays && prev.water.days >= SUMMARY_MIN.comparedWaterDays) {
    push("waterAvg", round(cur.water.totalMl / cur.water.days, 1), round(prev.water.totalMl / prev.water.days, 1));
  }
  if (cur.weight.length >= SUMMARY_MIN.comparedWeighIns && prev.weight.length >= SUMMARY_MIN.comparedWeighIns) {
    push("weightAvg", round(mean(cur.weight), 2), round(mean(prev.weight), 2));
  }
  if (cur.mood.perDay.length >= SUMMARY_MIN.comparedMoodDays && prev.mood.perDay.length >= SUMMARY_MIN.comparedMoodDays) {
    push("moodAvg", round(mean(cur.mood.perDay), 2), round(mean(prev.mood.perDay), 2));
  }
  if (cur.eaten.q.get("g") > 0 && prev.eaten.q.get("g") > 0) push("eatenG", round(cur.eaten.q.get("g"), 1), round(prev.eaten.q.get("g"), 1));
  if (cur.wasted.q.get("g") > 0 && prev.wasted.q.get("g") > 0) push("wastedG", round(cur.wasted.q.get("g"), 1), round(prev.wasted.q.get("g"), 1));
  if (cur.spend.priced > 0 && prev.spend.priced > 0) push("spendCents", cur.spend.cents, prev.spend.cents);
  return { status: "ok", previous, minRecordedDays: min, recordedDays, metrics };
}

/**
 * Riepilogo di un periodo. I giorni futuri non si contano (periodo parziale) e il periodo precedente è fatto dello
 * stesso numero di giorni contati, subito prima. Il confronto c'è solo se in entrambi i periodi almeno metà dei
 * giorni (e comunque 3) ha qualcosa di registrato, e ogni misura si confronta solo se ce n'è in entrambi.
 * Il giorno di un evento è il giorno locale nel fuso del diario: il cambio d'ora non sposta né duplica giorni.
 */
export function buildSummary(fullPeriod: ReportPeriod, input: SummaryInput, options: SummaryOptions = {}): PeriodSummary {
  const period = countedPeriod(fullPeriod, options.today);
  const elapsed = period.elapsedDays ?? 0;
  const to = period.through ?? addDays(period.from, -1);
  const expiredBefore = period.partial === true && options.today !== undefined ? options.today : addDays(period.to, 1);
  const cur = collect(period.from, to, input, expiredBefore);
  const extra = {
    ...(period.partial === true ? { partial: true } : {}),
    ...(period.partial === true && period.through !== undefined ? { throughDate: period.through } : {}),
  };
  const basis = (used: number, obs: number): DataBasis => basisOf(elapsed, used, obs, extra);
  const noRecords = (what: string): NoSummaryRecords =>
    insufficient(["no_records"], basis(0, 0), `nessun dato registrato nel periodo per ${what}.`);

  const entered: PeriodSummary["entered"] =
    cur.entered.events === 0 ? noRecords("gli acquisti") : { ...flowSection(cur.entered, basis), status: "ok", lots: cur.entered.events, declaredLots: cur.entered.declaredLots };
  const eaten: PeriodSummary["eaten"] = cur.eaten.events === 0 ? noRecords("il cibo mangiato") : flowSection(cur.eaten, basis);

  const foods = [...cur.eatenFoods.values()].sort(
    (a, b) => b.days.size - a.days.size || b.q.get("g") - a.q.get("g") || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const topFoods: TopFoodsSection =
    foods.length === 0
      ? noRecords("gli alimenti mangiati")
      : {
          status: "ok",
          items: foods.slice(0, SUMMARY_MIN.topN).map((f) => ({ name: f.name, days: f.days.size, quantities: f.q.list() })),
          distinct: foods.length,
          basis: basis(cur.eaten.days.size, cur.eaten.events),
        };

  // Piatti: nuovo = nome mai comparso in un pasto prima del periodo, riconoscibile solo se il registro ha qualcosa prima.
  const dishList = [...cur.dishes.values()].sort((a, b) => b.count - a.count || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  let dishes: DishesSection;
  if (dishList.length === 0) dishes = noRecords("i piatti cucinati");
  else {
    const before = new Set<string>();
    let historyBefore = false;
    for (const d of input.diary.days) {
      if (d.date >= period.from) continue;
      if (hasDiaryData(d)) historyBefore = true;
      for (const m of d.meals) {
        const t = m.title?.trim();
        if (t !== undefined && t !== "") before.add(norm(t));
      }
    }
    const dishDays = new Set<string>();
    for (const d of input.diary.days) if (inRange(d.date, period.from, to) && d.meals.some((m) => (m.title?.trim() ?? "") !== "")) dishDays.add(d.date);
    const cooked = dishList.reduce((s, d) => s + d.count, 0);
    dishes = {
      status: "ok",
      cooked,
      distinct: dishList.length,
      top: dishList.slice(0, SUMMARY_MIN.topN).map((d) => ({ title: d.title, count: d.count })),
      ...(historyBefore ? { newTitles: [...cur.dishes].filter(([k]) => !before.has(k)).map(([, v]) => v.title).sort() } : {}),
      basis: basis(dishDays.size, cooked),
    };
  }

  let mood: MoodSection;
  const moodDays = cur.mood.perDay.length;
  if (moodDays === 0) mood = noRecords("l'umore");
  else if (moodDays < SUMMARY_MIN.moodDays) {
    mood = insufficient(
      ["few_records"],
      basis(moodDays, moodDays),
      `servono almeno ${SUMMARY_MIN.moodDays} giorni con l'umore registrato nel periodo, ce ne sono ${moodDays}.`,
    );
  } else {
    mood = {
      status: "ok",
      days: moodDays,
      average: round(mean(cur.mood.perDay), 2),
      min: round(Math.min(...cur.mood.perDay), 2),
      max: round(Math.max(...cur.mood.perDay), 2),
      reliability: reliabilityBySize(moodDays, { moderate: 7, good: 14 }),
      basis: basis(moodDays, moodDays),
    };
  }

  const waste: WasteSummary = {
    discards:
      cur.wasted.events === 0
        ? noRecords("gli scarti")
        : {
            ...flowSection(cur.wasted, basis),
            status: "ok",
            byReason: [...cur.wasteReasons.entries()]
              .map(([reason, r]) => ({ reason, quantities: r.q.list(), events: r.events }))
              .sort((a, b) => b.events - a.events || (a.reason < b.reason ? -1 : 1)),
            byCategory: [...cur.wasteCategories.values()]
              .map((c) => ({ category: c.category, quantities: c.q.list(), events: c.events }))
              .sort((a, b) => b.events - a.events || String(a.category ?? "~").localeCompare(String(b.category ?? "~"), "it")),
            events: cur.wasted.events,
          },
    ...(cur.saved.lots > 0 ? { saved: { lots: cur.saved.lots, quantities: cur.saved.q.list(), certainty: cur.saved.certainty } } : {}),
    expiredUnresolved: cur.expiredUnresolved,
  };

  // Periodo precedente: stessi giorni contati, subito prima dell'inizio.
  const prevTo = addDays(period.from, -1);
  const prevFrom = addDays(period.from, -elapsed);
  const prev = elapsed > 0 ? collect(prevFrom, prevTo, input, addDays(prevTo, 1)) : collect(period.from, prevTo, input, period.from);
  const comparison = compare(cur, prev, { from: prevFrom, to: prevTo });

  return {
    period,
    recordedDays: cur.recorded.size,
    basis: basis(cur.recorded.size, cur.recorded.size),
    entered,
    eaten,
    topFoods,
    outOfHomeMeals: cur.outOfHomeMeals,
    dishes,
    mood,
    waste,
    comparison,
  };
}
