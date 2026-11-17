// Giorno consigliato per la prossima spesa: dal primo esaurimento previsto e dai fabbisogni del piano.
import { addDays, parseDate } from "../expiry";
import { isCalendarDate, type PantryState, type Unit } from "../ledger";
import {
  InvalidShoppingInputError,
  buildStreams,
  cmp,
  normalizeName,
  round9,
  streamId,
  toBaseQuantity,
} from "./common";
import { forecastConsumption, isIdle, type ConsumptionOptions } from "./consumption";
import type { PlanNeed } from "./list";

export interface WhenInput {
  today: string;
  pantry: PantryState;
  planNeeds?: readonly PlanNeed[];
}

export interface WhenOptions {
  /** Giorni di anticipo sul primo esaurimento. Default 1. */
  leadDays?: number;
  /** Giorni della settimana in cui si fa la spesa (0 = domenica); si anticipa al più vicino. */
  shoppingWeekdays?: readonly number[];
  idleDays?: number;
  consumption?: ConsumptionOptions;
}

export interface WhenTrigger {
  key: string;
  name: string;
  unit: Unit;
  /** Primo giorno senza scorta sufficiente. */
  date: string;
}

export interface ShoppingDay {
  /** `null` se né i consumi né il piano indicano un bisogno. */
  date: string | null;
  basis: "runout" | "plan" | "both" | "none";
  firstRunout: WhenTrigger | null;
  firstPlanShortfall: WhenTrigger | null;
  /** La data è stata anticipata per cadere in un giorno di spesa abituale. */
  weekdayAdjusted: boolean;
  /** Prodotti con storico insufficiente: il loro esaurimento non è previsto. */
  insufficientHistoryCount: number;
}

const weekdayOf = (date: string): number => new Date(parseDate(date)).getUTCDay();

/**
 * Giorno consigliato: il più vicino tra il primo esaurimento previsto (al ritmo medio) e il primo
 * giorno in cui i fabbisogni cumulati del piano superano la scorta, meno i giorni di anticipo, mai
 * prima di oggi. Con `shoppingWeekdays` si anticipa al giorno di spesa abituale che precede la data.
 */
export function recommendShoppingDay(input: WhenInput, options: WhenOptions = {}): ShoppingDay {
  const { today, pantry } = input;
  if (!isCalendarDate(today)) {
    throw new InvalidShoppingInputError("recommendShoppingDay: today deve essere YYYY-MM-DD");
  }
  const lead = options.leadDays ?? 1;
  const idleDays = options.idleDays ?? 21;
  const streams = buildStreams(pantry, today);
  const stockById = new Map(streams.map((s) => [s.id, s.stock]));
  const nameById = new Map(streams.map((s) => [s.id, s.name]));

  let firstRunout: WhenTrigger | null = null;
  let insufficient = 0;
  for (const f of forecastConsumption(pantry, today, options.consumption)) {
    if (!f.sufficient) {
      insufficient += 1;
      continue;
    }
    if (isIdle(f, today, idleDays)) continue;
    if (
      firstRunout === null ||
      f.runoutDate < firstRunout.date ||
      (f.runoutDate === firstRunout.date && cmp(f.id, streamId(firstRunout.key, firstRunout.unit)) < 0)
    ) {
      firstRunout = { key: f.key, name: f.name, unit: f.unit, date: f.runoutDate };
    }
  }

  const needs = new Map<string, { name: string; key: string; unit: Unit; rows: Array<[string, number]> }>();
  for (const n of input.planNeeds ?? []) {
    const key = normalizeName(n.product);
    const q = toBaseQuantity(n.quantity);
    if (key === "" || !q || !isCalendarDate(n.date) || n.date < today) continue;
    const id = streamId(key, q.unit);
    const e = needs.get(id) ?? { name: n.product.trim(), key, unit: q.unit, rows: [] };
    e.rows.push([n.date, q.value]);
    needs.set(id, e);
  }
  let firstPlan: WhenTrigger | null = null;
  for (const [id, e] of [...needs.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const stock = stockById.get(id) ?? 0;
    let cumulative = 0;
    for (const [date, value] of [...e.rows].sort((a, b) => cmp(a[0], b[0]))) {
      cumulative = round9(cumulative + value);
      if (cumulative > stock) {
        if (firstPlan === null || date < firstPlan.date) {
          firstPlan = { key: e.key, name: nameById.get(id) ?? e.name, unit: e.unit, date };
        }
        break;
      }
    }
  }

  const dates = [firstRunout?.date, firstPlan?.date].filter((d): d is string => d !== undefined);
  if (dates.length === 0) {
    return {
      date: null,
      basis: "none",
      firstRunout: null,
      firstPlanShortfall: null,
      weekdayAdjusted: false,
      insufficientHistoryCount: insufficient,
    };
  }
  const earliest = dates.sort()[0];
  const basis: ShoppingDay["basis"] =
    firstRunout && firstPlan
      ? firstRunout.date === firstPlan.date
        ? "both"
        : firstRunout.date < firstPlan.date
          ? "runout"
          : "plan"
      : firstRunout
        ? "runout"
        : "plan";
  let target = addDays(earliest, -lead);
  if (target < today) target = today;

  let weekdayAdjusted = false;
  const allowed = options.shoppingWeekdays;
  if (allowed && allowed.length > 0) {
    for (let d = target; d >= today; d = addDays(d, -1)) {
      if (allowed.includes(weekdayOf(d))) {
        weekdayAdjusted = d !== target;
        target = d;
        break;
      }
    }
  }
  return {
    date: target,
    basis,
    firstRunout,
    firstPlanShortfall: firstPlan,
    weekdayAdjusted,
    insufficientHistoryCount: insufficient,
  };
}
