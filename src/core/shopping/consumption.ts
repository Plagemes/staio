// Ritmo di consumo per prodotto, dai consumi e dagli scarti del registro.
// Sotto un minimo di osservazioni il risultato è "storico insufficiente": nessun numero inventato.
import { addDays, diffDays } from "../expiry";
import type { Certainty, PantryState, Unit } from "../ledger";
import {
  DEFAULT_TIME_ZONE,
  buildStreams,
  calendarDateOf,
  round9,
  roundTo,
  type Stream,
} from "./common";

export interface ConsumptionOptions {
  /** Finestra di osservazione in giorni, che termina oggi. Default 56. */
  windowDays?: number;
  /** Eventi di uscita (consumi e scarti) minimi nella finestra. Default 4. */
  minObservations?: number;
  /** Giorni minimi coperti dallo storico del prodotto. Default 7. */
  minSpanDays?: number;
  /** Ampiezza dell'intervallo (errori standard della media giornaliera). Default 1.96. */
  z?: number;
  timeZone?: string;
}

export type InsufficientReason = "few_observations" | "short_history";

interface ForecastBase {
  id: string;
  key: string;
  unit: Unit;
  name: string;
  /** Quantità utilizzabile oggi. */
  stock: number;
  /** Eventi di consumo e scarto nella finestra. */
  observations: number;
  /** Giorni coperti dallo storico (dalla finestra o dal primo lotto, se più recente). */
  spanDays: number;
  /** Il ritmo è sempre una stima. */
  certainty: Certainty;
}

export interface ConsumptionInsufficient extends ForecastBase {
  sufficient: false;
  reasons: InsufficientReason[];
}

export interface RateRange {
  /** Quantità al giorno. */
  perDay: number;
  low: number;
  high: number;
}

export interface ConsumptionEstimate extends ForecastBase {
  sufficient: true;
  windowStart: string;
  windowEnd: string;
  /** Uscite totali (consumi + scarti): ciò che svuota davvero la dispensa. */
  outflow: RateRange;
  /** Solo i consumi: ciò che serve ricomprare. */
  consumed: RateRange;
  wastedPerDay: number;
  /** Giorni di scorta rimasti al ritmo di uscita medio. */
  daysLeft: number;
  /** Intervallo: ritmo alto = pochi giorni; `max` è `null` se il ritmo basso è zero. */
  daysLeftRange: { min: number; max: number | null };
  /** Ultimo giorno con scorta al ritmo medio. */
  runoutDate: string;
  runoutRange: { earliest: string; latest: string | null };
  lastOutflowDate: string;
}

export type ConsumptionForecast = ConsumptionInsufficient | ConsumptionEstimate;

const MAX_DAYS = 36_500;

function interval(daily: readonly number[], z: number): RateRange {
  const n = daily.length;
  const mean = daily.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { perDay: mean, low: mean, high: mean };
  const variance = daily.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return { perDay: mean, low: Math.max(0, mean - z * se), high: mean + z * se };
}

function forecastStream(
  stream: Stream,
  today: string,
  o: Required<ConsumptionOptions>,
): ConsumptionForecast {
  const firstDate = stream.lots.reduce<string>((min, l) => {
    const d = calendarDateOf(l.createdAt, o.timeZone);
    return min === "" || d < min ? d : min;
  }, "");
  const windowFloor = addDays(today, -(o.windowDays - 1));
  const windowStart = firstDate > windowFloor ? firstDate : windowFloor;
  const spanDays = firstDate > today ? 0 : diffDays(today, windowStart) + 1;

  const consumed = new Map<string, number>();
  const wasted = new Map<string, number>();
  let observations = 0;
  let lastOutflowDate = "";
  for (const lot of stream.lots) {
    for (const h of lot.history) {
      if (h.type !== "consume" && h.type !== "discard") continue;
      const amount = -(h.quantityDelta ?? 0);
      if (!(amount > 0)) continue;
      const date = calendarDateOf(h.at, o.timeZone);
      if (date < windowStart || date > today) continue;
      const target = h.type === "consume" ? consumed : wasted;
      target.set(date, round9((target.get(date) ?? 0) + amount));
      observations += 1;
      if (date > lastOutflowDate) lastOutflowDate = date;
    }
  }

  const base: ForecastBase = {
    id: stream.id,
    key: stream.key,
    unit: stream.unit,
    name: stream.name,
    stock: stream.stock,
    observations,
    spanDays,
    certainty: "estimated",
  };
  const reasons: InsufficientReason[] = [];
  if (observations < o.minObservations) reasons.push("few_observations");
  if (spanDays < o.minSpanDays) reasons.push("short_history");
  if (reasons.length > 0) return { ...base, sufficient: false, reasons };

  const outDaily: number[] = [];
  const consDaily: number[] = [];
  let wastedTotal = 0;
  for (let i = 0; i < spanDays; i++) {
    const d = addDays(windowStart, i);
    const c = consumed.get(d) ?? 0;
    const w = wasted.get(d) ?? 0;
    consDaily.push(c);
    outDaily.push(c + w);
    wastedTotal += w;
  }
  const outflow = interval(outDaily, o.z);
  const cons = interval(consDaily, o.z);
  const daysLeft = stream.stock / outflow.perDay;
  const dayCount = (d: number) => Math.min(MAX_DAYS, Math.floor(d));
  const minDays = stream.stock / outflow.high;
  const maxDays = outflow.low > 0 ? stream.stock / outflow.low : null;
  return {
    ...base,
    sufficient: true,
    windowStart,
    windowEnd: today,
    outflow,
    consumed: cons,
    wastedPerDay: wastedTotal / spanDays,
    daysLeft: roundTo(daysLeft, 2),
    daysLeftRange: { min: roundTo(minDays, 2), max: maxDays === null ? null : roundTo(maxDays, 2) },
    runoutDate: addDays(today, dayCount(daysLeft)),
    runoutRange: {
      earliest: addDays(today, dayCount(minDays)),
      latest: maxDays === null ? null : addDays(today, dayCount(maxDays)),
    },
    lastOutflowDate,
  };
}

/**
 * Previsione di consumo per ogni prodotto (nome normalizzato e unità) con almeno un lotto.
 * Il ritmo è calcolato sulla finestra, ma parte dal primo lotto se il prodotto è più recente:
 * i giorni prima di avere il prodotto non contano come giorni di non consumo.
 * Gli scarti contano come uscite; gli altri eventi (regali, riallineamenti) no.
 */
export function forecastConsumption(
  state: PantryState,
  today: string,
  options: ConsumptionOptions = {},
): ConsumptionForecast[] {
  const o: Required<ConsumptionOptions> = {
    windowDays: options.windowDays ?? 56,
    minObservations: options.minObservations ?? 4,
    minSpanDays: options.minSpanDays ?? 7,
    z: options.z ?? 1.96,
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
  };
  return buildStreams(state, today).map((s) => forecastStream(s, today, o));
}

export function findForecast(
  forecasts: readonly ConsumptionForecast[],
  key: string,
  unit: Unit,
): ConsumptionForecast | undefined {
  return forecasts.find((f) => f.key === key && f.unit === unit);
}

/**
 * Prodotto fermo: scorta finita e nessuna uscita da più di `idleDays` giorni.
 * Non è un fabbisogno ricorrente, quindi non fa scattare "in esaurimento".
 */
export function isIdle(f: ConsumptionEstimate, today: string, idleDays: number): boolean {
  return f.stock === 0 && diffDays(today, f.lastOutflowDate) > idleDays;
}
