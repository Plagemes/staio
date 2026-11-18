// Salute: acqua, peso, bevande, integratori. Letture di testo, grafico del peso, valori tipici. Logica pura.
import {
  addDays,
  createMood,
  createSymptom,
  dateRange,
  daysBetween,
  waterByDay,
  weightMovingAverage,
  weightSeries,
  type DiaryState,
  type SymptomKind,
  type WeightAveragePoint,
  type WeightPoint,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { formatQuantity } from "@/core/units";
import { readQuantity } from "./capture";

export const DEFAULT_WATER_GOAL_ML = 2000;
export const WATER_GOAL_RANGE_ML = { min: 500, max: 8000 } as const;
export const WATER_AMOUNT_RANGE_ML = { min: 10, max: 5000 } as const;

export const WATER_PRESETS = [
  { label: "Bicchiere", ml: 200 },
  { label: "Bottiglietta", ml: 500 },
] as const;

export function formatMl(ml: number): string {
  return formatQuantity({ value: ml, unit: "ml" });
}

export type NumberReading = { ok: true; value: number } | { ok: false; error: string };

function mlFrom(text: string, range: { min: number; max: number }, what: string): NumberReading {
  const q = readQuantity(/^[\d.,\s]+$/.test(text.trim()) && text.trim() !== "" ? `${text.trim()} ml` : text);
  if (!q.ok) return { ok: false, error: `Scrivi ${what}, per esempio 300 ml o 1,5 l.` };
  if (q.quantity.unit !== "ml") return { ok: false, error: "Scrivi la quantità in litri o millilitri." };
  if (q.quantity.value < range.min || q.quantity.value > range.max) {
    return { ok: false, error: `Deve stare tra ${formatMl(range.min)} e ${formatMl(range.max)}.` };
  }
  return { ok: true, value: Math.round(q.quantity.value) };
}

/** Una quantità d'acqua scritta a mano ("300", "300 ml", "0,5 l"): un numero da solo vale come millilitri. */
export function parseWaterAmount(text: string): NumberReading {
  return mlFrom(text, WATER_AMOUNT_RANGE_ML, "quanta acqua");
}

/** Obiettivo giornaliero ("2 l", "2500"). */
export function parseWaterGoal(text: string): NumberReading {
  const t = text.trim();
  // "2" o "2,5" da soli sono litri: nessuno beve 2 ml al giorno
  if (/^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 50) return mlFrom(`${t} l`, WATER_GOAL_RANGE_ML, "l'obiettivo");
  return mlFrom(t, WATER_GOAL_RANGE_ML, "l'obiettivo");
}

export function parseWeightKg(text: string): NumberReading {
  const cleaned = text.replace(/kg|chili|chilogrammi/gi, "").replace(/\s+/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(cleaned)) return { ok: false, error: "Scrivi il peso in chili, per esempio 71,4." };
  const kg = Number(cleaned.replace(",", "."));
  if (kg < 1 || kg > 500) return { ok: false, error: "Il peso deve stare tra 1 e 500 kg." };
  return { ok: true, value: kg };
}

export function formatKg(kg: number): string {
  return `${(Math.round(kg * 10) / 10).toFixed(1).replace(".", ",")} kg`;
}

export const SYMPTOM_LABELS: Record<Exclude<SymptomKind, "other">, string> = {
  digestion: "Digestione",
  energy: "Energia",
  sleep: "Sonno",
};

export const SYMPTOM_ORDER: readonly Exclude<SymptomKind, "other">[] = ["digestion", "energy", "sleep"];

/** Punteggio da 1 a 5, uguale per umore e sintomi: 1 è il peggio, 5 il meglio. */
export const SCORES = [1, 2, 3, 4, 5] as const;

export interface DrinkPreset {
  id: string;
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
  /** Energia e zuccheri tipici: valori medi, non misure. */
  energyKcal?: number;
  sugarsG?: number;
  /** Come si legge il valore, per non farlo passare per misura. */
  basis: string;
}

/** Grammi di alcol di una bevanda: ml per gradazione per densità dell'etanolo (0,789 g/ml). */
export function alcoholGrams(ml: number, abvPercent: number): number {
  return Math.round(ml * (abvPercent / 100) * 0.789 * 10) / 10;
}

/** Valori tipici, non misure: si scrivono sempre come stime. */
export const DRINK_PRESETS: readonly DrinkPreset[] = [
  { id: "espresso", name: "Caffè espresso", ml: 30, caffeineMg: 63, energyKcal: 2, basis: "valore tipico, senza zucchero" },
  { id: "tea", name: "Tè", ml: 200, caffeineMg: 40, energyKcal: 1, basis: "valore tipico, senza zucchero" },
  { id: "cola", name: "Cola", ml: 330, caffeineMg: 32, energyKcal: 139, sugarsG: 35, basis: "valore tipico" },
  { id: "beer", name: "Birra", ml: 330, alcoholG: alcoholGrams(330, 5), energyKcal: 140, basis: "5% vol" },
  { id: "wine", name: "Vino", ml: 150, alcoholG: alcoholGrams(150, 12), energyKcal: 125, basis: "12% vol" },
  { id: "spirit", name: "Superalcolico", ml: 40, alcoholG: alcoholGrams(40, 40), energyKcal: 90, basis: "40% vol" },
];

/** Il nome di un integratore senza maiuscole né spazi in più: «Vitamina  D » e «vitamina d» sono lo stesso. */
export const supplementKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

const later = (a: { at: string; eventId: string }, b: { at: string; eventId: string }): boolean =>
  a.at > b.at || (a.at === b.at && a.eventId > b.eventId);

/**
 * Nomi degli integratori presi di recente, dal più frequente: per l'aggiunta con un tocco. Lo stesso integratore
 * scritto in due modi («Vitamina  D», «vitamina d») è una riga sola, con il nome scritto l'ultima volta.
 */
export function recentSupplementNames(diary: DiaryState, today: string, days = 30, limit = 6): string[] {
  const from = addDays(today, -(days - 1));
  const counts = new Map<string, { name: string; n: number; last: { at: string; eventId: string } }>();
  for (const day of diary.days) {
    if (day.date < from || day.date > today) continue;
    for (const s of day.supplements) {
      const key = supplementKey(s.name);
      const name = s.name.trim().replace(/\s+/g, " ");
      const cur = counts.get(key);
      if (!cur) counts.set(key, { name, n: 1, last: s });
      else {
        cur.n += 1;
        if (later(s, cur.last)) {
          cur.name = name;
          cur.last = s;
        }
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "it"))
    .slice(0, limit)
    .map((c) => c.name);
}

/**
 * La dose dell'ultima volta che questo integratore è stato preso, per riproporla. La memoria è il diario: se l'ultima
 * volta la dose non c'era, non se ne propone una più vecchia.
 */
export function lastSupplementDose(diary: DiaryState, name: string): string | undefined {
  const key = supplementKey(name);
  let last: { at: string; eventId: string; dose?: string } | undefined;
  for (const day of diary.days) {
    for (const s of day.supplements) {
      if (supplementKey(s.name) === key && (!last || later(s, last))) last = s;
    }
  }
  return last?.dose?.trim() || undefined;
}

/** Le misure di «Come sto», nell'ordine in cui si leggono ovunque: nel foglio, nell'avviso, nell'andamento. */
export type ScoreMeasure = "mood" | "energy" | "digestion" | "sleep";

export const SCORE_MEASURES: readonly ScoreMeasure[] = ["mood", "energy", "digestion", "sleep"];

export const SCORE_LABELS: Record<ScoreMeasure, string> = {
  mood: "Umore",
  energy: SYMPTOM_LABELS.energy,
  digestion: SYMPTOM_LABELS.digestion,
  sleep: SYMPTOM_LABELS.sleep,
};

/** Ciò che si è scelto nel foglio «Come sto»: da una a quattro misure, ognuna da 1 a 5. */
export type ScorePicks = Partial<Record<ScoreMeasure, number>>;

/** Le misure scelte, nell'ordine di sempre. */
export function pickedMeasures(picks: ScorePicks): { measure: ScoreMeasure; score: number }[] {
  return SCORE_MEASURES.flatMap((measure) => {
    const score = picks[measure];
    return score === undefined ? [] : [{ measure, score }];
  });
}

/** Gli eventi di «Come sto», da scrivere insieme: un `mood` per l'umore e un `symptom` per ogni altra misura scelta. */
export function buildScoreEvents(picks: ScorePicks, ctx: { deviceId: string; now: string }): AnyEvent[] {
  const options = { deviceId: ctx.deviceId, now: () => ctx.now };
  return pickedMeasures(picks).map(({ measure, score }) =>
    measure === "mood" ? createMood({ score }, options) : createSymptom({ kind: measure, score }, options),
  );
}

export const TREND_DAYS = 7;
/** Sotto questa soglia non si dà una media: due giorni non dicono come va una settimana. */
export const MIN_SCORE_DAYS = 3;

export interface ScoreAverage {
  measure: ScoreMeasure;
  /** Giorni della finestra con almeno un valore. */
  days: number;
  /** Media dei valori dei giorni, a una cifra dopo la virgola. Assente sotto i tre giorni. */
  average?: number;
}

/**
 * Le medie di «Come sto» negli ultimi `days` giorni, oggi compreso. Un giorno conta una volta sola per misura, con
 * l'ultimo valore segnato quel giorno: chi si corregge alle sei di sera non pesa il doppio.
 */
export function scoreAverages(diary: DiaryState, today: string, days = TREND_DAYS): ScoreAverage[] {
  const from = addDays(today, -(days - 1));
  const values = new Map<ScoreMeasure, number[]>(SCORE_MEASURES.map((m) => [m, []]));
  for (const day of diary.days) {
    if (day.date < from || day.date > today) continue;
    const last = new Map<ScoreMeasure, { at: string; eventId: string; score: number }>();
    const keep = (measure: ScoreMeasure, entry: { at: string; eventId: string; score: number }) => {
      const cur = last.get(measure);
      if (!cur || later(entry, cur)) last.set(measure, entry);
    };
    for (const m of day.moods) keep("mood", m);
    for (const s of day.symptoms) if (s.kind !== "other") keep(s.kind, s);
    for (const [measure, entry] of last) values.get(measure)?.push(entry.score);
  }
  return SCORE_MEASURES.map((measure) => {
    const list = values.get(measure) ?? [];
    if (list.length < MIN_SCORE_DAYS) return { measure, days: list.length };
    return { measure, days: list.length, average: Math.round((list.reduce((sum, v) => sum + v, 0) / list.length) * 10) / 10 };
  });
}

export interface SupplementDays {
  name: string;
  /** In quanti giorni della finestra è stato preso (due volte nello stesso giorno contano una). */
  days: number;
}

/** Gli integratori presi negli ultimi `days` giorni, oggi compreso, dal più costante. */
export function supplementDays(diary: DiaryState, today: string, days = TREND_DAYS): SupplementDays[] {
  const from = addDays(today, -(days - 1));
  const seen = new Map<string, { name: string; dates: Set<string> }>();
  for (const day of diary.days) {
    if (day.date < from || day.date > today) continue;
    for (const s of day.supplements) {
      const key = supplementKey(s.name);
      const cur = seen.get(key);
      if (cur) cur.dates.add(day.date);
      else seen.set(key, { name: s.name.trim(), dates: new Set([day.date]) });
    }
  }
  return [...seen.values()]
    .map((entry) => ({ name: entry.name, days: entry.dates.size }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "it"));
}

export interface WaterWeekDay {
  date: string;
  /** Zero se quel giorno non c'è acqua segnata: non si sa se non si è bevuto o se non si è scritto. */
  ml: number;
}

/** L'acqua degli ultimi sette giorni, dal più vecchio a oggi: sempre sette righe, nei giorni del fuso del diario. */
export function waterWeek(diary: DiaryState, today: string): WaterWeekDay[] {
  const from = addDays(today, -(TREND_DAYS - 1));
  const byDate = new Map(waterByDay(diary, { from, to: today }).map((d) => [d.date, d.ml]));
  return dateRange(from, today).map((date) => ({ date, ml: byDate.get(date) ?? 0 }));
}

export const WEIGHT_WINDOW_DAYS = 30;
/** Sotto questa soglia non si disegna un andamento: tre punti non dicono una tendenza. */
export const MIN_WEIGHT_POINTS = 3;
export const AVERAGE_WINDOW_DAYS = 7;

export interface ChartPoint {
  date: string;
  kg: number;
  x: number;
  y: number;
}

export interface WeightChart {
  /** Pesate negli ultimi 30 giorni. */
  count: number;
  /** Abbastanza punti per disegnare un andamento. */
  enough: boolean;
  from: string;
  to: string;
  width: number;
  height: number;
  yMin: number;
  yMax: number;
  dots: ChartPoint[];
  /** Media mobile a 7 giorni, nei giorni con una pesata. */
  average: ChartPoint[];
  last?: WeightPoint;
  lastAverage?: WeightAveragePoint;
}

/** Calcola le coordinate del grafico degli ultimi 30 giorni: pesate come punti e media mobile come linea. */
export function buildWeightChart(diary: DiaryState, today: string, size = { width: 320, height: 140 }): WeightChart {
  const from = addDays(today, -(WEIGHT_WINDOW_DAYS - 1));
  const series = weightSeries(diary, { from, to: today });
  const averages = weightMovingAverage(diary, { from, to: today, windowDays: AVERAGE_WINDOW_DAYS });
  const base: WeightChart = {
    count: series.length,
    enough: series.length >= MIN_WEIGHT_POINTS,
    from,
    to: today,
    width: size.width,
    height: size.height,
    yMin: 0,
    yMax: 0,
    dots: [],
    average: [],
    ...(series.length > 0 ? { last: series[series.length - 1] } : {}),
    ...(averages.length > 0 ? { lastAverage: averages[averages.length - 1] } : {}),
  };
  if (series.length === 0) return base;

  const values = [...series.map((p) => p.kg), ...averages.map((p) => p.kg)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // mai una scala più stretta di un chilo: una oscillazione di mezzo chilo non deve sembrare una frana
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const pad = (hi - lo) * 0.1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const margin = 8;
  const xOf = (date: string) => margin + (daysBetween(from, date) / (WEIGHT_WINDOW_DAYS - 1)) * (size.width - 2 * margin);
  const yOf = (kg: number) => margin + (1 - (kg - yMin) / (yMax - yMin)) * (size.height - 2 * margin);
  const toPoint = (p: { date: string; kg: number }): ChartPoint => ({ date: p.date, kg: p.kg, x: xOf(p.date), y: yOf(p.kg) });
  return { ...base, yMin, yMax, dots: series.map(toPoint), average: averages.map(toPoint) };
}

/** Variazione della media mobile tra la prima e l'ultima media nella finestra, se c'è abbastanza dati. */
export function averageChange(chart: WeightChart): number | undefined {
  if (!chart.enough || chart.average.length < 2) return undefined;
  return Math.round((chart.average[chart.average.length - 1].kg - chart.average[0].kg) * 10) / 10;
}
