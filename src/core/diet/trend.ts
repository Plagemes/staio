// Andamento di un indicatore su 4-8 settimane chiuse.

import { frameSufficient } from "./indicators";
import {
  DIET_THRESHOLDS,
  type DietThresholds,
  type IndicatorId,
  type Trend,
  type WeekFrame,
} from "./types";

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Confronta la media della metà recente delle settimane con dati con quella della metà vecchia (con un numero dispari
 * quella di mezzo resta fuori). Una lacuna è `null` e non entra nelle medie: mai 0 al suo posto.
 */
export function trendOf(
  values: readonly (number | null)[],
  t: Pick<DietThresholds, "trendMinWeeks" | "trendMinRelativeChange"> = DIET_THRESHOLDS,
): Trend {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const base = { weeksWithData: known.length, values: [...values] };
  if (known.length < t.trendMinWeeks || known.length < 2) return { direction: "insufficient", ...base };
  const half = Math.floor(known.length / 2);
  const older = mean(known.slice(0, half));
  const recent = mean(known.slice(known.length - half));
  if (older === recent) return { direction: "flat", ...base };
  if (older === 0) return { direction: recent > 0 ? "up" : "down", ...base };
  const change = (recent - older) / Math.abs(older);
  if (Math.abs(change) < t.trendMinRelativeChange) return { direction: "flat", ...base };
  return { direction: change > 0 ? "up" : "down", ...base };
}

/**
 * Andamenti di tutti gli indicatori sulle settimane chiuse (tutte tranne l'ultima, che è in corso): `values[i]` è la
 * settimana `weeks[i]`. Una settimana insufficiente, nel complesso o per l'indicatore, resta `null`.
 */
export function trendsOf(
  weeks: readonly WeekFrame[],
  t: DietThresholds = DIET_THRESHOLDS,
): Partial<Record<IndicatorId, Trend>> {
  const closed = weeks.filter((w) => !w.inProgress);
  const ids = new Set<IndicatorId>();
  for (const w of closed) for (const i of w.indicators) ids.add(i.id);
  const out: Partial<Record<IndicatorId, Trend>> = {};
  for (const id of ids) {
    const values = closed.map((w) => {
      if (!frameSufficient(w, t)) return null;
      const ind = w.indicators.find((i) => i.id === id);
      if (!ind || ind.status === "insufficient" || ind.value === undefined) return null;
      return ind.value;
    });
    out[id] = trendOf(values, t);
  }
  return out;
}
