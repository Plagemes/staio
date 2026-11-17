// Punti dei grafici SVG, calcolati a parte per poterli provare. Due grafici: il peso con la
// proiezione a banda e il segmento di una differenza con il suo intervallo.
import type { WeightProjection } from "@/core/analysis";
import { daysBetween, type WeightAveragePoint, type WeightPoint } from "@/core/diary";
import { formatCalendarDate } from "../format";
import { formatDecimal, formatKgPerWeek, formatKgValue, formatSigned } from "./present";

export interface XY {
  x: number;
  y: number;
}

export interface WeightChartDot extends XY {
  date: string;
  kg: number;
}

export interface ProjectionRow {
  date: string;
  daysAhead: number;
  expectedKg: number;
  trendLowKg: number;
  trendHighKg: number;
  dailyLowKg: number;
  dailyHighKg: number;
}

export interface WeightProjectionChart {
  width: number;
  height: number;
  /** Margine sinistro lasciato alle etichette dell'asse y. */
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  dots: WeightChartDot[];
  /** Media mobile a 7 giorni: la tendenza osservata. */
  average: XY[];
  /** Linea attesa dalla proiezione, a partire dall'ultima pesata. */
  expected: XY[];
  /** Banda dell'incertezza della tendenza: si allarga con la distanza. Poligono chiuso. */
  trendBand: XY[];
  /** Banda di una singola pesata (tendenza più oscillazione quotidiana). Poligono chiuso. */
  dailyBand: XY[];
  /** Ascissa dell'ultima pesata, dove finisce l'osservato e inizia la proiezione. */
  splitX?: number;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  /** Tabella equivalente al grafico, per chi non lo vede. */
  table: ProjectionRow[];
  /** Descrizione a parole del grafico. */
  description: string;
}

export interface WeightChartInput {
  weights: readonly WeightPoint[];
  average: readonly WeightAveragePoint[];
  projection?: WeightProjection;
  width?: number;
  height?: number;
}

const finite = (n: number): boolean => Number.isFinite(n);

/** Estremi "puliti" dell'asse y: almeno due chili di scala, un margine, passi interi o di mezzo chilo. */
export function niceRange(min: number, max: number): { lo: number; hi: number; step: number } {
  let lo = min;
  let hi = max;
  const minSpan = 2;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const span = hi - lo;
  const step = span <= 4 ? 0.5 : span <= 8 ? 1 : span <= 20 ? 2 : 5;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

export function buildWeightProjectionChart(input: WeightChartInput): WeightProjectionChart | undefined {
  const weights = input.weights.filter((w) => finite(w.kg));
  const projection = input.projection;
  if (weights.length === 0) return undefined;
  const width = input.width ?? 320;
  const height = input.height ?? 200;
  const plotLeft = 36;
  const plotRight = width - 6;
  const plotTop = 8;
  const plotBottom = height - 22;

  const startDate = weights[0].date;
  const endDate = projection
    ? projection.points[projection.points.length - 1].date
    : weights[weights.length - 1].date;
  const totalDays = Math.max(1, daysBetween(startDate, endDate));
  const xOf = (date: string): number => plotLeft + (daysBetween(startDate, date) / totalDays) * (plotRight - plotLeft);

  const values: number[] = weights.map((w) => w.kg);
  for (const a of input.average) values.push(a.kg);
  if (projection) {
    for (const p of projection.points) values.push(p.dailyLowKg, p.dailyHighKg, p.trendLowKg, p.trendHighKg);
  }
  const { lo, hi, step } = niceRange(Math.min(...values), Math.max(...values));
  const yOf = (kg: number): number => plotBottom - ((kg - lo) / (hi - lo)) * (plotBottom - plotTop);

  const yTicks: WeightProjectionChart["yTicks"] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push({ y: yOf(v), label: formatDecimal(v, step < 1 ? 1 : 0) });

  const dots = weights.map((w) => ({ date: w.date, kg: w.kg, x: xOf(w.date), y: yOf(w.kg) }));
  const average = input.average.filter((a) => finite(a.kg)).map((a) => ({ x: xOf(a.date), y: yOf(a.kg) }));

  const pts = projection?.points ?? [];
  const expected = pts.map((p) => ({ x: xOf(p.date), y: yOf(p.expectedKg) }));
  const band = (low: (p: (typeof pts)[number]) => number, high: (p: (typeof pts)[number]) => number): XY[] => [
    ...pts.map((p) => ({ x: xOf(p.date), y: yOf(high(p)) })),
    ...[...pts].reverse().map((p) => ({ x: xOf(p.date), y: yOf(low(p)) })),
  ];
  const trendBand = band((p) => p.trendLowKg, (p) => p.trendHighKg);
  const dailyBand = band((p) => p.dailyLowKg, (p) => p.dailyHighKg);

  const xTicks: WeightProjectionChart["xTicks"] = [
    { x: xOf(startDate), label: shortDate(startDate), anchor: "start" },
    ...(projection ? [{ x: xOf(projection.fromDate), label: shortDate(projection.fromDate), anchor: "middle" as const }] : []),
    { x: xOf(endDate), label: shortDate(endDate), anchor: "end" },
  ];
  // Con una sola pesata le tre etichette coinciderebbero.
  const uniqueTicks = xTicks.filter((t, i) => xTicks.findIndex((o) => o.label === t.label) === i);

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    dots,
    average,
    expected,
    trendBand: projection ? trendBand : [],
    dailyBand: projection ? dailyBand : [],
    ...(projection ? { splitX: xOf(projection.fromDate) } : {}),
    yTicks,
    xTicks: uniqueTicks,
    table: pts.map((p) => ({ ...p })),
    description: describeWeightChart(weights, projection),
  };
}

function shortDate(date: string): string {
  return formatCalendarDate(date).replace(/ \d{4}$/, "");
}

/** Alternativa testuale: dice ciò che il grafico mostra, con valore centrale e intervalli insieme. */
export function describeWeightChart(weights: readonly WeightPoint[], projection?: WeightProjection): string {
  if (weights.length === 0) return "Nessuna pesata nel periodo.";
  const first = weights[0];
  const last = weights[weights.length - 1];
  const observed = `Peso dal ${formatCalendarDate(first.date)} al ${formatCalendarDate(last.date)}: ${weights.length} ${
    weights.length === 1 ? "pesata" : "pesate"
  }, l'ultima ${formatKgValue(last.kg)}.`;
  if (!projection) return `${observed} Nessuna proiezione: dati insufficienti.`;
  const end = projection.points[projection.points.length - 1];
  const t = projection.trendInterval;
  return (
    `${observed} Tendenza osservata ${formatKgPerWeek(projection.trendKgPerWeek)}, intervallo da ${formatSigned(t.low, 2)} a ${formatSigned(t.high, 2)} kg a settimana. ` +
    `Se la tendenza continuasse, tra ${projection.horizonDays} giorni (${formatCalendarDate(end.date)}) il peso atteso sarebbe ${formatKgValue(end.expectedKg)}, ` +
    `con una banda della tendenza tra ${formatKgValue(end.trendLowKg)} e ${formatKgValue(end.trendHighKg)}; ` +
    `una singola pesata cadrebbe tra ${formatKgValue(end.dailyLowKg)} e ${formatKgValue(end.dailyHighKg)}. È una proiezione, non una previsione.`
  );
}

export const toPoints = (pts: readonly XY[]): string => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

// ---------------------------------------------------------------------------------------------
// Segmento della differenza con il suo intervallo

export interface IntervalPlot {
  width: number;
  /** Ascissa dello zero (nessuna differenza). */
  zeroX: number;
  lowX: number;
  highX: number;
  valueX: number;
  includesZero: boolean;
  description: string;
}

/**
 * La differenza (periodo dell'esperimento meno riferimento) con il suo intervallo, su una scala
 * che comprende sempre lo zero: se l'intervallo lo attraversa si vede subito che la differenza
 * non si distingue dalla variabilità abituale.
 */
export function buildIntervalPlot(
  difference: number,
  low: number,
  high: number,
  unit: string,
  digits: number,
  width = 300,
  provisional = false,
): IntervalPlot {
  const pad = 12;
  const lo = Math.min(low, 0, difference);
  const hi = Math.max(high, 0, difference);
  const span = hi - lo || 1;
  const xOf = (v: number): number => pad + ((v - lo) / span) * (width - 2 * pad);
  const includesZero = low <= 0 && high >= 0;
  return {
    width,
    zeroX: xOf(0),
    lowX: xOf(low),
    highX: xOf(high),
    valueX: xOf(difference),
    includesZero,
    description: provisional
      ? `Differenza provvisoria ${formatSigned(difference, digits)} ${unit}, intervallo provvisorio da ${formatSigned(low, digits)} a ${formatSigned(high, digits)} ${unit}: l'esperimento è in corso, non si dichiara nulla.`
      : `Differenza ${formatSigned(difference, digits)} ${unit}, intervallo da ${formatSigned(low, digits)} a ${formatSigned(high, digits)} ${unit}: ${
          includesZero ? "comprende lo zero, quindi non si distingue dalla variabilità abituale" : "non comprende lo zero"
        }.`,
  };
}
