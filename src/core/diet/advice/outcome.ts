// «Ha funzionato?» calcolato, non chiesto: per ogni settimana chiusa si ricalcolano le regole
// scattate (senza il contesto di allora, che non si ricostruisce: sono confronti tra settimane,
// non consigli effettivamente visti) e si guarda l'indicatore nella settimana chiusa dopo.
import {
  DIET_THRESHOLDS,
  type AdviceOutcome,
  type AdviceOutcomeResult,
  type AdviceRule,
  type DietHistory,
  type WeekFrame,
} from "../types";
import { ADVICE_RULES, asCatalogRule, evaluateRule, type CatalogRule } from "./rules";
import { addDays, frameSufficient, indicatorOf } from "./util";

function compare(
  rule: CatalogRule,
  before: number,
  after: number,
  afterLowerBound: boolean,
): AdviceOutcomeResult {
  const sign = rule.direction === "increase" ? 1 : -1;
  const delta = (after - before) * sign;
  const rel = before === 0 ? (delta === 0 ? 0 : delta > 0 ? Infinity : -Infinity) : delta / Math.abs(before);
  const t = DIET_THRESHOLDS.trendMinRelativeChange;
  const result: AdviceOutcomeResult = rel >= t ? "moved" : rel <= -t ? "opposite" : "same";
  if (!afterLowerBound) return result;
  // Con un minimo si può dire solo ciò che il minimo garantisce: «più di» sì, «meno di» no.
  const guaranteed = rule.direction === "increase" ? "moved" : "opposite";
  return result === guaranteed ? result : "insufficient";
}

export function computeOutcomes(
  history: Pick<DietHistory, "weeks">,
  rules: readonly AdviceRule[] = ADVICE_RULES,
): AdviceOutcome[] {
  const catalog = rules.map(asCatalogRule);
  const closed = history.weeks.filter((w) => !w.inProgress);
  const out: AdviceOutcome[] = [];

  for (let i = 0; i + 1 < closed.length; i++) {
    const week = closed[i];
    const next: WeekFrame = closed[i + 1];
    if (next.weekStart !== addDays(week.weekStart, 7)) continue;
    const past = closed.slice(0, i);

    const fired: { outcome: AdviceOutcome; severity: number; order: number }[] = [];
    catalog.forEach((rule, order) => {
      const ev = evaluateRule(rule, week, past);
      if (ev.kind !== "fired") return;
      const before = rule.metric(week, ev.indicator);
      if (before === undefined) return;
      const base = { ruleId: rule.id, weekStart: week.weekStart, nextWeekStart: next.weekStart, before };
      const nextInd = frameSufficient(next) ? indicatorOf(next, ev.indicator.id) : undefined;
      const after = nextInd && nextInd.status !== "insufficient" ? rule.metric(next, nextInd) : undefined;
      const outcome: AdviceOutcome =
        after === undefined || !nextInd
          ? { ...base, result: "insufficient" }
          : { ...base, after, result: compare(rule, before, after, nextInd.lowerBound) };
      fired.push({ outcome, severity: ev.severity, order });
    });
    fired.sort((a, b) => b.severity - a.severity || a.order - b.order);
    for (const f of fired) out.push(f.outcome);
  }
  return out;
}
