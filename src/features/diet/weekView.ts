// La vista «Qualità di ciò che mangi» di una settimana: scelta della settimana, righe degli indicatori, andamento, voci
// da controllare, fonti. Logica pura, nessun React. Le frasi vengono da `texts.ts`; qui stanno solo quelle della
// vista (titoli, ritorni, andamento, spiegazioni del calcolo), scritte con le stesse regole: fatti, mai «devi», mai un
// voto, nessun parere medico.
import {
  DIET_THRESHOLDS,
  SOURCE_IDS,
  frameSufficient,
  mondayOf,
  trendOf,
  type AdviceOutcome,
  type AdviceSource,
  type CoverageGap,
  type CoverageGapReason,
  type DietHistory,
  type Indicator,
  type IndicatorStatus,
  type SourceId,
  type TrendDirection,
  type WeekFrame,
} from "@/core/diet";
import { dietHref } from "./links";
import {
  approx,
  capitalize,
  coverageText,
  dayMonth,
  indicatorLabel,
  indicatorText,
  insufficientText,
  num,
  outcomeText,
  statusText,
  targetText,
  weekRangeText,
} from "./texts";

// ---------------------------------------------------------------------------------------------- testi della vista

export const PAGE_TITLE = "Qualità di ciò che mangi";
export const BACK_LABEL = "Torna a Salute";
export const SECTION_ADVICE = "Da guardare";
export const SECTION_INDICATORS = "Indicatori";
export const SECTION_PAST = "Settimane passate";
export const SECTION_GAPS = "Voci da controllare";
export const SECTION_HOW = "Come è calcolato";
export const WHAT_IT_MEANS = "Che cosa significa";
export const NO_DAYS_TEXT = "In questa settimana non c'è nessun giorno registrato.";
export const EMPTY_TITLE = "Qui comparirà la qualità di ciò che mangi";
export const EMPTY_TEXT = "Dopo qualche giorno di pasti registrati vedrai le settimane a confronto con le indicazioni delle Linee guida.";
export const EMPTY_ACTION = "Registra pasto";
export const SHOW_ALL_LABEL = (hidden: number): string => `Mostra gli altri ${hidden} indicatori`;
export const SHOW_FEWER_LABEL = "Mostra meno indicatori";
export const CHECK_LABEL = "Controlla";
export const LEVEL_LEGEND = "Livello energetico di esempio";
export const LEVEL_SAVED = (level: number): string => `Letto sul livello da ${num(level, 0)} kcal`;
export const LEVEL_FAILED = "Non sono riuscito a cambiare il livello. Riprova.";
export const SAVE_FAILED = "Non sono riuscito a salvarlo. Riprova.";
export const SOURCE_UNVERIFIED = "non verificata direttamente";

// ---------------------------------------------------------------------------------------------- settimana scelta

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `?settimana=`: una data `YYYY-MM-DD` che esiste, portata al lunedì della sua settimana. Altro: `undefined`. */
export function parseWeekParam(raw: string | null | undefined): string | undefined {
  const m = raw ? DATE.exec(raw) : null;
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return mondayOf(raw as string);
}

export interface PickedWeek {
  frame: WeekFrame;
  index: number;
}

/**
 * La settimana da mostrare: quella chiesta se c'è nel quadro; una più recente della settimana in corso porta a questa,
 * una più vecchia della prima del quadro porta alla prima. Senza richiesta, la settimana in corso (l'ultima).
 */
export function pickWeek(weeks: readonly WeekFrame[], requested: string | undefined): PickedWeek | undefined {
  if (weeks.length === 0) return undefined;
  const last = weeks.length - 1;
  if (requested === undefined) return { frame: weeks[last], index: last };
  const found = weeks.findIndex((w) => w.weekStart === requested);
  if (found >= 0) return { frame: weeks[found], index: found };
  const index = requested < weeks[0].weekStart ? 0 : last;
  return { frame: weeks[index], index };
}

export interface WeekLink {
  href: string;
  /** Per il lettore di schermo: «Settimana prima: 10–16 nov». */
  label: string;
}

/** Le frecce: la settimana prima e quella dopo, se il quadro le ha. La settimana in corso ha l'indirizzo senza parametro. */
export function weekNav(weeks: readonly WeekFrame[], index: number): { prev?: WeekLink; next?: WeekLink } {
  const at = (i: number, word: string): WeekLink | undefined => {
    const w = weeks[i];
    if (!w) return undefined;
    const href = i === weeks.length - 1 ? dietHref() : dietHref({ week: w.weekStart });
    return { href, label: `${word}: ${weekRangeText(w.weekStart, w.weekEnd)}` };
  };
  const prev = at(index - 1, "Settimana prima");
  const next = at(index + 1, "Settimana dopo");
  return { ...(prev ? { prev } : {}), ...(next ? { next } : {}) };
}

/** «Questa settimana», «Settimana scorsa», «Settimana del 10 nov». */
export function periodLabel(frame: Pick<WeekFrame, "weekStart">, today: string): string {
  const current = mondayOf(today);
  if (frame.weekStart === current) return "Questa settimana";
  const [y, m, d] = current.split("-").map(Number);
  const previous = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
  return frame.weekStart === previous ? "Settimana scorsa" : `Settimana del ${dayMonth(frame.weekStart)}`;
}

/** Nessuna voce in tutto il quadro: la vista non ha niente da dire e rimanda a registrare un pasto. */
export const historyIsEmpty = (history: Pick<DietHistory, "weeks">): boolean => history.weeks.every((w) => w.daysWithData === 0);

// ---------------------------------------------------------------------------------------------- andamento

export interface TrendPoint {
  weekStart: string;
  /** «10 nov». */
  weekLabel: string;
  /** Assente: lacuna (dati insufficienti), mai 0 al suo posto. */
  value: number | null;
  /** In corso o un minimo («almeno»): si disegna vuoto. */
  partial: boolean;
  /** Il valore in parole, per la tabella. */
  text: string;
}

const isCountRow = (ind: Pick<Indicator, "id" | "unit">): boolean => ind.unit === "count" && ind.id.startsWith("group:");

/** Il valore da disegnare: per le righe «occasionali» sono le volte del quadro, come nel testo. */
function plottedValue(ind: Indicator, frame: WeekFrame): number | undefined {
  if (isCountRow(ind)) return frame.rowTallies[ind.id.slice(6) as keyof WeekFrame["rowTallies"]]?.occasions;
  return ind.value;
}

/** Le settimane fino a `endIndex` compresa, al più `count`, dalla più vecchia. */
export function trendPoints(id: Indicator["id"], weeks: readonly WeekFrame[], endIndex: number, count = 8): TrendPoint[] {
  const from = Math.max(0, endIndex - count + 1);
  return weeks.slice(from, endIndex + 1).map((w) => {
    const ind = w.indicators.find((i) => i.id === id);
    const enough = frameSufficient(w, DIET_THRESHOLDS);
    const value = ind && enough && ind.status !== "insufficient" ? plottedValue(ind, w) : undefined;
    const known = value !== undefined && Number.isFinite(value);
    return {
      weekStart: w.weekStart,
      weekLabel: dayMonth(w.weekStart),
      value: known ? (value as number) : null,
      partial: known && Boolean(w.inProgress || ind?.lowerBound),
      text: known && ind ? `${w.inProgress ? "in corso: " : ""}${indicatorText(ind, w)}` : "dati insufficienti",
    };
  });
}

const DIRECTION_TEXT: Readonly<Record<TrendDirection, string>> = {
  up: "in aumento",
  down: "in calo",
  flat: "più o meno stabile",
  insufficient: "andamento non valutabile: servono almeno quattro settimane con dati",
};

/** La direzione sulle sole settimane chiuse e complete (le parziali non entrano, come in `trendsOf`). */
export function trendDirection(points: readonly TrendPoint[]): TrendDirection {
  return trendOf(points.map((p) => (p.partial ? null : p.value))).direction;
}

/** Per l'`aria-label` del grafico: «Legumi, ultime 8 settimane: 5 con dati, da 1 volta a 3 volte; in aumento.» */
export function trendSummary(label: string, points: readonly TrendPoint[]): string {
  const known = points.filter((p) => p.value !== null);
  if (known.length === 0) return `${label}, ultime ${points.length} settimane: nessuna con dati sufficienti.`;
  const first = known[0].text.replace(/^in corso: /, "");
  const last = known[known.length - 1].text.replace(/^in corso: /, "");
  const range = known.length > 1 ? `, da ${first} a ${last}` : `: ${last}`;
  return `${label}, ultime ${points.length} settimane: ${known.length} con dati${range}; ${DIRECTION_TEXT[trendDirection(points)]}.`;
}

// ---------------------------------------------------------------------------------------------- indicatori

export type StatusShape = "ring" | "dot" | "none";

export interface IndicatorView {
  id: Indicator["id"];
  label: string;
  /** Con «almeno» e la tilde se serve. */
  value: string;
  estimated: boolean;
  /** «indicate 2–4 porzioni a settimana», se la fonte dà un'indicazione. */
  target?: string;
  /** Lo stato in parole. */
  status: string;
  /** Anello per «sotto» e «almeno», pallino pieno per «sopra», niente per «dentro». */
  shape: StatusShape;
  trend?: { points: TrendPoint[]; summary: string };
}

const STATUS_ORDER: readonly IndicatorStatus[] = ["below", "above", "atLeast", "within", "occasional", "noTarget", "insufficient"];

const SHAPE: Readonly<Record<IndicatorStatus, StatusShape>> = {
  below: "ring",
  atLeast: "ring",
  above: "dot",
  within: "none",
  occasional: "none",
  noTarget: "none",
  insufficient: "none",
};

/** Una riga con valore zero e senza indicazione da raggiungere non dice niente: «sotto» sì, anche a zero. */
export function isShown(ind: Indicator): boolean {
  if (ind.status === "below" || ind.status === "above" || ind.status === "atLeast") return true;
  return ind.value !== undefined && ind.value > 0;
}

/** Gli indicatori della settimana, in ordine di attenzione (sotto, sopra, «almeno», dentro, il resto), con l'andamento. */
export function indicatorViews(weeks: readonly WeekFrame[], index: number): IndicatorView[] {
  const frame = weeks[index];
  if (!frame) return [];
  const rank = (s: IndicatorStatus): number => STATUS_ORDER.indexOf(s);
  return frame.indicators
    .filter(isShown)
    .map((ind, order) => ({ ind, order }))
    .sort((a, b) => rank(a.ind.status) - rank(b.ind.status) || a.order - b.order)
    .map(({ ind }) => {
      const label = capitalize(indicatorLabel(ind.id));
      const points = trendPoints(ind.id, weeks, index);
      const withData = points.filter((p) => p.value !== null).length;
      const target = targetText(ind.target);
      return {
        id: ind.id,
        label,
        value: indicatorText(ind, frame),
        estimated: ind.certainty === "estimated",
        ...(target ? { target } : {}),
        status: statusText(ind, frame),
        shape: SHAPE[ind.status],
        ...(withData >= 2 ? { trend: { points, summary: trendSummary(label, points) } } : {}),
      };
    });
}

/** Quando la settimana non basta per confrontare, una frase sola in cima agli indicatori. */
export function insufficientNote(frame: WeekFrame): string | undefined {
  if (frameSufficient(frame, DIET_THRESHOLDS)) return undefined;
  const reason = frame.indicators.find((i) => i.status === "insufficient")?.insufficient;
  return insufficientText(reason, frame);
}

/** Quanti indicatori mostrare prima di «Mostra gli altri». */
export const INDICATORS_VISIBLE = 8;

/** Separa il testo in pezzi «~» e non: la tilde si legge «stimato» e non si dice due volte. */
export function splitEstimate(text: string): { tilde: boolean; text: string }[] {
  return text.split(/(~)/).filter((s) => s !== "").map((s) => (s === "~" ? { tilde: true, text: s } : { tilde: false, text: s }));
}

// ---------------------------------------------------------------------------------------------- settimane passate

export interface OutcomeView {
  key: string;
  text: string;
}

/** Gli esiti più recenti per primi, al più `max`. */
export function outcomeViews(outcomes: readonly AdviceOutcome[], history: Pick<DietHistory, "weeks">, max = 4): OutcomeView[] {
  return [...outcomes]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, max)
    .map((o) => ({ key: `${o.ruleId}:${o.weekStart}`, text: outcomeText(o, history) }));
}

// ---------------------------------------------------------------------------------------------- voci da controllare

const GAP_REASON: Readonly<Record<CoverageGapReason, string>> = {
  unknown: "non riconosciuto",
  outOfHome: "pasto fuori casa: non si scompone",
  mixedDish: "piatto misto: non si scompone",
  noQuantity: "senza quantità",
};

export interface GapView {
  key: string;
  /** «Cracker integrali · 18 nov: non riconosciuto». */
  text: string;
  /** Per il lettore di schermo: «Controlla «Cracker integrali», 18 nov». */
  label: string;
  lineKey: string;
  date: string;
}

export function gapViews(gaps: readonly CoverageGap[]): GapView[] {
  return gaps.map((g, i) => ({
    key: `${g.lineKey}:${i}`,
    text: `${g.label} · ${dayMonth(g.date)}: ${GAP_REASON[g.reason]}`,
    label: `${CHECK_LABEL} «${g.label}», ${dayMonth(g.date)}`,
    lineKey: g.lineKey,
    date: g.date,
  }));
}

// ---------------------------------------------------------------------------------------------- come è calcolato

/** Le regole in parole, con le soglie vere dell'app. */
export function ruleTexts(): string[] {
  const t = DIET_THRESHOLDS;
  return [
    "Ogni voce registrata va in un gruppo di alimenti e in un livello di lavorazione: dal prodotto, dall'alimento scelto, dal nome o dagli ingredienti della preparazione. Puoi correggerla dalla scheda della voce.",
    "Si contano le porzioni standard delle Linee guida CREA e si confrontano con le indicazioni, a settimana.",
    `Una settimana si confronta solo con almeno ${num(t.minDaysWithData, 0)} giorni registrati e ${num(t.minCoverage * 100, 0)}% di ciò che hai mangiato riconosciuto. Per dire «sotto l'indicazione» servono ${num(t.belowDays, 0)} giorni e ${num(t.belowCoverage * 100, 0)}%: altrimenti ciò che manca potrebbe colmare la distanza.`,
    "Un valore con «almeno» è un minimo: mancano dei dati. Una lacuna nell'andamento resta vuota, non vale zero.",
  ];
}

/** La copertura della settimana scelta, in una riga. */
export function coverageLine(frame: WeekFrame): string {
  if (frame.coverage.lines === 0) return "In questa settimana non c'è niente da riconoscere.";
  return `${capitalize(coverageText(frame.coverage))}: ${num(frame.coverage.classifiedLines, 0)} voci su ${num(frame.coverage.lines, 0)}${frame.coverage.estimatedLines > 0 ? `, di cui ${num(frame.coverage.estimatedLines, 0)} dedotte (${approx("estimated")})` : ""}.`;
}

/** Le fonti dietro ciò che si vede: indicazioni degli indicatori, dei consigli e la scelta dell'app. In ordine di `SOURCE_IDS`. */
export function sourcesUsed(frame: WeekFrame, adviceSources: readonly AdviceSource[] = []): SourceId[] {
  const used = new Set<SourceId>(["app"]);
  for (const ind of frame.indicators) {
    if (isShown(ind) && ind.target) used.add(ind.target.source);
    if (ind.id === "processedShare" && isShown(ind)) used.add("nova-fao-2019");
  }
  for (const s of adviceSources) if (s !== "ownTrend") used.add(s);
  return SOURCE_IDS.filter((id) => used.has(id));
}
