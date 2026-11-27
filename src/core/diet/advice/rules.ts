// Catalogo delle regole dei consigli. Ogni regola confronta un indicatore del quadro settimanale
// con la sua fonte (o, per i prodotti molto lavorati, con le settimane dell'utente) e dice quanto
// è lontano: 0..1. Nessun testo qui: le frasi stanno in features/diet/texts.ts.
//
// Esclusi per scelta (FONTI.md): alcol (nessun consiglio), latte e yogurt (solo descrittivi).
// Le carni citano sempre CREA, mai IARC.
import {
  DIET_THRESHOLDS,
  type AdviceRule,
  type AdviceRuleId,
  type AdviceSource,
  type AlternativeDimension,
  type DietGroup,
  type GroupRowId,
  type GuidelineRowId,
  type Indicator,
  type IndicatorId,
  type WeekFrame,
} from "../types";
import { clamp01, frameSufficient, indicatorOf, indicatorUsable, median } from "./util";

/**
 * Quante volte a settimana vale ancora «occasionale» (SCELTA DELL'APP, in FONTI.md come tale;
 * il testo cita solo «consumo occasionale secondo le Linee guida»). Oltre: «più che occasionale».
 */
export const OCCASIONAL_PER_WEEK: Readonly<Partial<Record<GuidelineRowId, number>>> = Object.freeze({
  processedMeat: 1,
  cakesIceCream: 2,
  snacksChocolate: 2,
  sugaryDrinks: 1,
});

/** Settimane chiuse e sufficienti che servono per una mediana personale (scelta dell'app). */
export const OWN_TREND_MIN_WEEKS = 3;

/**
 * Nome generico da mettere nella lista della spesa per un gruppo cercato (mappa dichiarata,
 * scelta dell'app). Sono nomi di alimenti da scrivere nella lista, non frasi dell'interfaccia.
 */
export const SHOPPING_NAME_OF_GROUP: Readonly<Partial<Record<DietGroup, string>>> = Object.freeze({
  vegetables: "verdura di stagione",
  fruit: "frutta di stagione",
  legumes: "lenticchie",
  wholeGrains: "pasta integrale",
  fish: "pesce",
  nutsSeeds: "frutta secca",
});

/** Regola del catalogo: il contratto `AdviceRule` più ciò che serve al motore. */
export interface CatalogRule extends AdviceRule {
  /** Indicatore del fatto in quel quadro (per `sweetsDrinksOften` la riga con lo scarto maggiore). */
  pick(frame: WeekFrame): Indicator | undefined;
  /** Valore confrontato settimana su settimana negli esiti (per gli «occasionali»: le volte). */
  metric(frame: WeekFrame, ind: Indicator): number | undefined;
  /** Conteggio settimanale per cui «sopra» si può dire già nella settimana in corso. */
  countBased: boolean;
  /** Dimensione delle alternative note utili alla regola. */
  alternativeDimension?: AlternativeDimension;
  /** Vero se la fonte del consiglio segue quella dell'indicazione; falso per le carni (sempre CREA). */
  sourceFromTarget: boolean;
}

type Severity = CatalogRule["severity"];

function rowOf(id: IndicatorId): GroupRowId | undefined {
  return id.startsWith("group:") ? (id.slice(6) as GroupRowId) : undefined;
}

/** Sotto il minimo dell'indicazione: solo lo stato «below» (settimana chiusa, dati bastanti). */
const belowMin: Severity = (ind) => {
  if (ind.status !== "below" || !indicatorUsable(ind)) return undefined;
  const min = ind.target?.min;
  if (min === undefined || min <= 0) return undefined;
  const gap = (min - ind.value) / min;
  return gap > 0 ? clamp01(gap) : undefined;
};

/** Sopra il massimo: «above» si può dire anche con dati parziali, perché il valore è un minimo. */
const aboveMax: Severity = (ind) => {
  if (ind.status !== "above" || !indicatorUsable(ind)) return undefined;
  const max = ind.target?.max;
  if (max === undefined || max <= 0) return 0.5;
  const excess = (ind.value - max) / max;
  return excess > 0 ? clamp01(excess) : undefined;
};

/** Volte nella settimana per una riga «occasionale»: le occasioni del conteggio per riga. */
function occasionsOf(frame: WeekFrame, row: GroupRowId, ind: Indicator): number | undefined {
  const tally = frame.rowTallies?.[row];
  if (tally) return tally.occasions;
  return typeof ind.value === "number" ? ind.value : undefined;
}

function occasionalExcess(frame: WeekFrame, row: GroupRowId, ind: Indicator | undefined): number | undefined {
  if (!ind || ind.status === "insufficient") return undefined;
  const limit = OCCASIONAL_PER_WEEK[row];
  if (limit === undefined) return undefined;
  const count = occasionsOf(frame, row, ind);
  if (count === undefined || count <= limit) return undefined;
  return clamp01((count - limit) / count);
}

const byIndicator =
  (id: IndicatorId) =>
  (frame: WeekFrame): Indicator | undefined =>
    indicatorOf(frame, id);

const valueMetric = (_frame: WeekFrame, ind: Indicator): number | undefined =>
  typeof ind.value === "number" ? ind.value : undefined;

const occasionsMetric = (frame: WeekFrame, ind: Indicator): number | undefined => {
  const row = rowOf(ind.id);
  return row ? occasionsOf(frame, row, ind) : valueMetric(frame, ind);
};

function increaseRule(
  id: AdviceRuleId,
  indicator: IndicatorId,
  lookFor: readonly DietGroup[],
  source: AdviceSource,
): CatalogRule {
  return {
    id,
    indicator,
    direction: "increase",
    severity: belowMin,
    lookFor,
    source,
    pick: byIndicator(indicator),
    metric: valueMetric,
    countBased: false,
    sourceFromTarget: true,
  };
}

function occasionalRule(
  id: AdviceRuleId,
  rows: readonly GroupRowId[],
  lookFor: readonly DietGroup[],
  avoid: readonly DietGroup[],
  alternativeDimension: AlternativeDimension | undefined,
): CatalogRule {
  const excessByRow = (frame: WeekFrame) =>
    rows.map((row) => {
      const ind = indicatorOf(frame, `group:${row}`);
      return { row, ind, excess: occasionalExcess(frame, row, ind) };
    });
  return {
    id,
    indicator: `group:${rows[0]}`,
    direction: "decrease",
    // `ind` è quello scelto da `pick`; con più righe vale lo scarto maggiore fra tutte.
    severity: (ind, frame) => {
      if (rows.length === 1) return occasionalExcess(frame, rows[0], ind);
      let best: number | undefined;
      for (const r of excessByRow(frame)) {
        if (r.excess !== undefined && (best === undefined || r.excess > best)) best = r.excess;
      }
      return best;
    },
    lookFor,
    avoid,
    source: "crea-lg-2018",
    pick: (frame) => {
      const all = excessByRow(frame);
      let chosen: (typeof all)[number] | undefined;
      for (const r of all) {
        if (r.excess !== undefined && (chosen === undefined || r.excess > (chosen.excess ?? 0))) chosen = r;
      }
      if (chosen) return chosen.ind;
      // Nessuna riga sopra: l'indicatore principale, o il primo valutabile, decide lo stato.
      return all.find((r) => r.ind && r.ind.status !== "insufficient")?.ind ?? all[0].ind;
    },
    metric: occasionsMetric,
    countBased: true,
    alternativeDimension,
    sourceFromTarget: false,
  };
}

/** Quota di energia da prodotti molto lavorati sopra la mediana delle proprie settimane chiuse. */
const processedShareUp: Severity = (ind, _frame, past) => {
  if (!indicatorUsable(ind)) return undefined;
  const values: number[] = [];
  for (const w of past) {
    if (!frameSufficient(w)) continue;
    const p = indicatorOf(w, "processedShare");
    if (indicatorUsable(p)) values.push(p.value);
  }
  if (values.length < OWN_TREND_MIN_WEEKS) return undefined;
  const m = median(values);
  if (m <= 0) return undefined;
  const rel = (ind.value - m) / m;
  return rel >= DIET_THRESHOLDS.trendMinRelativeChange ? clamp01(rel) : undefined;
};

export const ADVICE_RULES: readonly CatalogRule[] = Object.freeze([
  increaseRule("vegFruitLow", "vegFruit", ["vegetables", "fruit"], "crea-lg-2018"),
  increaseRule("legumesLow", "group:legumes", ["legumes"], "crea-lg-2018"),
  increaseRule("fishLow", "group:fish", ["fish"], "crea-lg-2018"),
  increaseRule("wholeGrainLow", "wholeGrainShare", ["wholeGrains"], "crea-lg-2018"),
  increaseRule("nutsLow", "group:nutsSeeds", ["nutsSeeds"], "crea-lg-2018"),
  increaseRule("fiberLow", "fiber", ["legumes", "wholeGrains", "vegetables", "fruit"], "efsa-drv"),
  {
    id: "redMeatHigh",
    indicator: "group:redMeat",
    direction: "decrease",
    severity: aboveMax,
    lookFor: ["fish", "legumes"],
    avoid: ["redMeat", "processedMeat"],
    source: "crea-lg-2018",
    pick: byIndicator("group:redMeat"),
    metric: valueMetric,
    countBased: true,
    sourceFromTarget: false,
  },
  occasionalRule("processedMeatOften", ["processedMeat"], ["legumes", "fish"], ["processedMeat", "redMeat"], undefined),
  // Tre righe «occasionali» in una regola: scatta sullo scarto maggiore, e il fatto riporta
  // l'indicatore di quella riga (dolci, snack o bevande zuccherate).
  occasionalRule(
    "sweetsDrinksOften",
    ["cakesIceCream", "snacksChocolate", "sugaryDrinks"],
    ["fruit", "nutsSeeds"],
    ["sweets", "sugaryDrinks", "saltySnacks"],
    "sugars",
  ),
  {
    id: "saltHigh",
    indicator: "salt",
    direction: "decrease",
    severity: aboveMax,
    lookFor: [],
    avoid: ["saltySnacks", "processedMeat", "condiments"],
    source: "crea-lg-2018",
    pick: byIndicator("salt"),
    metric: valueMetric,
    countBased: false,
    alternativeDimension: "salt",
    sourceFromTarget: true,
  },
  {
    id: "freeSugarsHigh",
    indicator: "freeSugars",
    direction: "decrease",
    severity: aboveMax,
    lookFor: ["fruit"],
    avoid: ["sweets", "sugars", "sugaryDrinks"],
    source: "who-sugars-2015",
    pick: byIndicator("freeSugars"),
    metric: valueMetric,
    countBased: false,
    alternativeDimension: "sugars",
    sourceFromTarget: true,
  },
  {
    id: "processedShareUp",
    indicator: "processedShare",
    direction: "decrease",
    severity: processedShareUp,
    lookFor: [],
    source: "ownTrend",
    pick: byIndicator("processedShare"),
    metric: valueMetric,
    countBased: false,
    alternativeDimension: "nova",
    sourceFromTarget: false,
  },
]);

/** Una regola qualunque (anche non del catalogo) vista come regola del catalogo. */
export function asCatalogRule(rule: AdviceRule): CatalogRule {
  if ("pick" in rule && "metric" in rule) return rule as CatalogRule;
  return {
    ...rule,
    pick: byIndicator(rule.indicator),
    metric: valueMetric,
    countBased: false,
    sourceFromTarget: rule.source !== "ownTrend",
  };
}

export type RuleEvaluation =
  | { kind: "insufficient" }
  | { kind: "not_triggered"; indicator: Indicator }
  | { kind: "fired"; indicator: Indicator; severity: number };

/** Valuta una regola su un quadro; `past` sono le settimane chiuse precedenti. */
export function evaluateRule(rule: CatalogRule, frame: WeekFrame, past: readonly WeekFrame[]): RuleEvaluation {
  if (!frameSufficient(frame)) return { kind: "insufficient" };
  const ind = rule.pick(frame);
  if (!ind || ind.status === "insufficient") return { kind: "insufficient" };
  const s = rule.severity(ind, frame, past);
  if (s === undefined || !Number.isFinite(s) || s <= 0) return { kind: "not_triggered", indicator: ind };
  return { kind: "fired", indicator: ind, severity: clamp01(s) };
}
