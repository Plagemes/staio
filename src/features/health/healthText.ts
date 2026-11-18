// I testi di Salute: che cosa dice ogni riga di «Andamento» senza aprirla, le righe dentro, gli avvisi dei tre fogli.
// Solo numeri, giorni contati e «pochi dati»: nessun giudizio. Funzioni pure.
import { getDay, type DiaryState } from "@/core/diary";
import { parseDate } from "@/core/expiry";
import {
  SCORE_LABELS,
  TREND_DAYS,
  WEIGHT_WINDOW_DAYS,
  buildWeightChart,
  formatKg,
  formatMl,
  pickedMeasures,
  scoreAverages,
  supplementKey,
  type ScoreAverage,
  type ScorePicks,
  type SupplementDays,
  type WaterWeekDay,
} from "../health";

/** In mezzo a una frase il nome comincia con la minuscola: «vitamina D». Le sigle restano come sono. */
const inSentence = (name: string): string => name.trim().replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());

const comma = (n: number): string => String(n).replace(".", ",");

const SHORT_DATE = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "short", day: "numeric" });

/** «18 nov» da una data di calendario: dentro una finestra di trenta giorni l'anno non serve. */
export function shortDate(date: string): string {
  return SHORT_DATE.format(new Date(parseDate(date))).replace(/\./g, "");
}

/** «mar 17» */
export function weekdayLabel(date: string): string {
  return WEEKDAY.format(new Date(parseDate(date))).replace(/\./g, "");
}

const daysOutOf = (days: number, total: number): string => `${days === 1 ? "1 giorno" : `${days} giorni`} su ${total}`;

/** «72,4 kg il 18 nov · media a 7 giorni 72,1 kg»; la media solo con almeno tre pesate nei trenta giorni. */
export function weightSummary(diary: DiaryState, today: string): string {
  const chart = buildWeightChart(diary, today);
  if (!chart.last) return `nessuna pesata in ${WEIGHT_WINDOW_DAYS} giorni`;
  const last = `${formatKg(chart.last.kg)} il ${shortDate(chart.last.date)}`;
  return chart.enough && chart.lastAverage ? `${last} · media a 7 giorni ${formatKg(chart.lastAverage.kg)}` : last;
}

/** «7 giorni: umore 3,8 · energia 3,2 · sonno 4»: solo le misure che hanno una media. */
export function scoresSummary(diary: DiaryState, today: string): string {
  const parts = scoreAverages(diary, today)
    .filter((a) => a.average !== undefined)
    .map((a) => `${SCORE_LABELS[a.measure].toLowerCase()} ${comma(a.average as number)}`);
  return parts.length > 0 ? `${TREND_DAYS} giorni: ${parts.join(" · ")}` : `pochi dati negli ultimi ${TREND_DAYS} giorni`;
}

/** «oggi 0,6 l di 2 l · caffeina ~40 mg · alcol ~13 g». La tilde dove il valore è una stima. */
export function fluidsSummary(diary: DiaryState, today: string, goalMl: number): string {
  const day = getDay(diary, today);
  const parts = [`oggi ${formatMl(day?.waterMl ?? 0)} di ${formatMl(goalMl)}`];
  if (day && day.caffeineMg > 0) parts.push(`caffeina ${day.caffeineCertainty === "estimated" ? "~" : ""}${comma(Math.round(day.caffeineMg))} mg`);
  if (day && day.alcoholG > 0) parts.push(`alcol ${day.alcoholCertainty === "estimated" ? "~" : ""}${comma(Math.round(day.alcoholG * 10) / 10)} g`);
  return parts.join(" · ");
}

/** «oggi: vitamina D, magnesio»: ogni integratore una volta, nell'ordine in cui è stato preso. */
export function supplementsSummary(diary: DiaryState, today: string): string {
  const taken = [...(getDay(diary, today)?.supplements ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const names = new Map<string, string>();
  for (const s of taken) {
    const key = supplementKey(s.name);
    if (!names.has(key)) names.set(key, inSentence(s.name));
  }
  return names.size > 0 ? `oggi: ${[...names.values()].join(", ")}` : "nessuno oggi";
}

export interface TrendSummaries {
  weight: string;
  scores: string;
  fluids: string;
  supplements: string;
}

/** I riepiloghi delle quattro righe di «Andamento». `goalMl`: l'obiettivo d'acqua scelto in Oggi. */
export function trendSummaries(diary: DiaryState, today: string, goalMl: number): TrendSummaries {
  return {
    weight: weightSummary(diary, today),
    scores: scoresSummary(diary, today),
    fluids: fluidsSummary(diary, today, goalMl),
    supplements: supplementsSummary(diary, today),
  };
}

/** «Umore · media 3,8 · 5 giorni su 7»; sotto i tre giorni: «Umore · 2 giorni: troppo pochi per una media». */
export function scoreLine(average: ScoreAverage, total = TREND_DAYS): string {
  const label = SCORE_LABELS[average.measure];
  if (average.average !== undefined) return `${label} · media ${comma(average.average)} · ${daysOutOf(average.days, total)}`;
  return average.days === 1 ? `${label} · 1 giorno: troppo poco per una media` : `${label} · ${average.days} giorni: troppo pochi per una media`;
}

/** «Vitamina D · 5 giorni su 7» */
export function supplementLine(entry: SupplementDays, total = TREND_DAYS): string {
  return `${entry.name} · ${daysOutOf(entry.days, total)}`;
}

/** «mar 17 · 1,4 l»; un giorno senza acqua segnata ha il trattino, non uno zero: non si sa se non si è bevuto. */
export function waterLine(day: WaterWeekDay, today: string): string {
  return `${day.date === today ? "oggi" : weekdayLabel(day.date)} · ${day.ml > 0 ? formatMl(day.ml) : "—"}`;
}

/** «L'ultima: 72,4 kg, il 16 nov.» */
export function lastWeightText(last: { date: string; kg: number }, today: string): string {
  return `L'ultima: ${formatKg(last.kg)}, ${last.date === today ? "oggi" : `il ${shortDate(last.date)}`}.`;
}

export function weightNotice(kg: number): string {
  return `Segnato: peso ${formatKg(kg)}.`;
}

/** «umore 4, energia 3»: solo ciò che è stato scelto, nell'ordine di sempre. */
export function scoresText(picks: ScorePicks): string {
  return pickedMeasures(picks)
    .map((p) => `${SCORE_LABELS[p.measure].toLowerCase()} ${p.score}`)
    .join(", ");
}

/** «Segnato: umore 4, energia 3.» */
export function scoresNotice(picks: ScorePicks): string {
  return `Segnato: ${scoresText(picks)}.`;
}

/** «Segnato: vitamina D, 1 capsula.» */
export function supplementNotice(name: string, dose?: string): string {
  const d = dose?.trim();
  return `Segnato: ${inSentence(name)}${d ? `, ${d}` : ""}.`;
}

/** La riga piccola sotto un integratore recente: «1 capsula · preso oggi alle 08:15». Vuota se non c'è niente da dire. */
export function supplementHint(dose: string | undefined, takenTodayAt: string | undefined): string {
  return [dose?.trim() ?? "", takenTodayAt ? `preso oggi alle ${takenTodayAt}` : ""].filter((part) => part !== "").join(" · ");
}
