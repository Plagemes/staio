// Riepilogo di un periodo (per il Rapporto): quante settimane con dati sufficienti e, per indicatore, in quante si
// stava dentro, sotto o sopra l'indicazione.

import { frameSufficient } from "./indicators";
import {
  DIET_THRESHOLDS,
  type DietHistory,
  type DietThresholds,
  type IndicatorId,
  type PeriodDietSummary,
  type PeriodIndicatorSummary,
} from "./types";

/**
 * Considera le settimane che si sovrappongono a `from`..`to`. Medie e conteggi usano solo le settimane con dati
 * sufficienti e, per ogni indicatore, solo quelle in cui l'indicatore non è insufficiente.
 */
export function summarizePeriod(
  history: Pick<DietHistory, "weeks">,
  from: string,
  to: string,
  t: Pick<DietThresholds, "minDaysWithData" | "minCoverage"> = DIET_THRESHOLDS,
): PeriodDietSummary {
  const weeks = history.weeks.filter((w) => w.weekStart <= to && w.weekEnd >= from);
  const sufficient = weeks.filter((w) => frameSufficient(w, t));
  const acc = new Map<IndicatorId, PeriodIndicatorSummary & { sum: number; n: number }>();
  for (const w of weeks) {
    for (const ind of w.indicators) {
      if (!acc.has(ind.id)) acc.set(ind.id, { id: ind.id, within: 0, below: 0, above: 0, sum: 0, n: 0 });
    }
  }
  for (const w of sufficient) {
    for (const ind of w.indicators) {
      const a = acc.get(ind.id);
      if (!a || ind.status === "insufficient") continue;
      if (ind.value !== undefined) {
        a.sum += ind.value;
        a.n++;
      }
      if (ind.status === "within") a.within++;
      else if (ind.status === "below") a.below++;
      else if (ind.status === "above") a.above++;
    }
  }
  const indicators: PeriodIndicatorSummary[] = [...acc.values()].map(({ sum, n, ...rest }) =>
    n > 0 ? { ...rest, mean: Math.round((sum / n) * 100) / 100 } : rest,
  );
  return { from, to, weeks: weeks.length, sufficientWeeks: sufficient.length, indicators };
}
