// I riepiloghi delle righe richiuse di Nutrizione: che cosa c'è dentro, in poche parole. Logica pura, nessun giudizio.
import type { ProteinSpread } from "@/core/nutrition";
import type { ComparisonRow, NutritionRows } from "./prepare";
import { MOMENT_WHERE, type VarietyView } from "./weekView";

/** Detto quando non c'è abbastanza per un riepilogo. */
export const FEW_DATA = "pochi dati";

/** «soprattutto a pranzo (73%)»; «nessun momento prevale (40%)»; senza giorni completi, «pochi dati». */
export function spreadSummary(s: ProteinSpread): string {
  if (s.completeDays === 0 || s.top === undefined) return FEW_DATA;
  const top = s.moments.find((m) => m.moment === s.top);
  const pct = Math.round((top?.share ?? 0) * 100);
  return s.topIsMajority ? `soprattutto ${MOMENT_WHERE[s.top]} (${pct}%)` : `nessun momento prevale (il più alto ${pct}%)`;
}

/** «almeno 1 in 7 giorni»; senza dati, «pochi dati». */
export function varietySummary(v: VarietyView): string {
  return v.empty ? FEW_DATA : `${v.headline} in 7 giorni`;
}

/** «Voci non riconosciute (2)», senza numero quando non ce n'è nessuna. */
export const unresolvedTitle = (count: number): string => (count > 0 ? `Voci non riconosciute (${count})` : "Voci non riconosciute");

/** «Altri nutrienti (9)» */
export const otherNutrientsTitle = (count: number): string => `Altri nutrienti (${count})`;

/** Quanti nutrienti si vedono subito nel confronto con i riferimenti. */
export const SHOWN_COMPARISONS = 6;

export interface SplitRows {
  /** In vista: i primi confronti, dal più lontano dal riferimento. */
  shown: ComparisonRow[];
  /** Nella riga richiusa «Altri nutrienti». */
  more: ComparisonRow[];
  notes: ComparisonRow[];
  insufficient: ComparisonRow[];
  /** Quanti nutrienti stanno nella riga richiusa. */
  hidden: number;
}

/** Le righe del confronto: al massimo `max` in vista, il resto (con le note e i dati insufficienti) nella riga richiusa. */
export function splitComparisons(rows: NutritionRows, max = SHOWN_COMPARISONS): SplitRows {
  const shown = rows.compared.slice(0, max);
  const more = rows.compared.slice(max);
  return { shown, more, notes: rows.notes, insufficient: rows.insufficient, hidden: more.length + rows.notes.length + rows.insufficient.length };
}

/** Perché il confronto con i riferimenti non c'è, in una riga; `undefined` se c'è. */
export function comparisonGateText(options: { hasProfile: boolean; completeDays: number; required: number }): string | undefined {
  if (!options.hasProfile) return "Per il confronto servono sesso ed età.";
  if (options.completeDays < options.required) return `Per il confronto servono almeno ${options.required} giorni contati: ne hai ${options.completeDays}.`;
  return undefined;
}
