// Salute: acqua, peso, bevande, integratori. Letture di testo, grafico del peso, valori tipici. Logica pura.
import {
  addDays,
  daysBetween,
  weightMovingAverage,
  weightSeries,
  type DiaryState,
  type SymptomKind,
  type WeightAveragePoint,
  type WeightPoint,
} from "@/core/diary";
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

/** Nomi degli integratori presi di recente, dal più frequente: per l'aggiunta con un tocco. */
export function recentSupplementNames(diary: DiaryState, today: string, days = 30, limit = 6): string[] {
  const from = addDays(today, -(days - 1));
  const counts = new Map<string, { name: string; n: number }>();
  for (const day of diary.days) {
    if (day.date < from || day.date > today) continue;
    for (const s of day.supplements) {
      const key = s.name.trim().toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { name: s.name.trim(), n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "it"))
    .slice(0, limit)
    .map((c) => c.name);
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
