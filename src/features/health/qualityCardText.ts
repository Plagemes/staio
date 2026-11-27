// Il testo della scheda «Qualità di ciò che mangi» in Salute: una o due righe sulla settimana, da tutto ciò che è
// stato registrato, con le frasi della vista dettagliata (features/diet). Nessuna soglia nuova, nessun giudizio.
// Funzione pura. La qualità dei soli prodotti con codice a barre resta in /app/qualita.
import type { DietHistory, Indicator, IndicatorId, WeekFrame } from "@/core/diet";
import { capitalize, indicatorLabel, indicatorText, num, whenText } from "../diet/texts";

export interface QualityCardView {
  lines: string[];
  /** Il lunedì della settimana descritta; assente per la settimana in corso. */
  week?: string;
}

/** Gli indicatori nominati nella prima riga, nell'ordine in cui si dicono. */
const SUMMARY: readonly IndicatorId[] = ["vegFruit", "group:legumes", "group:fish"];

const usable = (ind: Indicator | undefined): ind is Indicator =>
  ind !== undefined && ind.status !== "insufficient" && ind.value !== undefined && Number.isFinite(ind.value);

const find = (frame: WeekFrame, id: IndicatorId): Indicator | undefined => frame.indicators.find((i) => i.id === id);

const hasUsable = (frame: WeekFrame): boolean => [...SUMMARY, "processedShare" as const].some((id) => usable(find(frame, id)));

/** `current` è il lunedì della settimana in corso (l'ultima della storia): basta a dire «la settimana scorsa». */
function opening(frame: WeekFrame, current: string): string {
  return frame.inProgress ? "Questa settimana" : capitalize(whenText(frame.weekStart, current));
}

const dayCount = (n: number): string => `${num(n)} ${n === 1 ? "giorno registrato" : "giorni registrati"}`;

/**
 * `null` quando non c'è nessuna voce nelle settimane in storia (63 giorni circa): la scheda non occupa spazio.
 * Si descrive la settimana più recente con dati sufficienti (la in corso, se già basta); se nessuna basta, si dice
 * quanti giorni sono registrati, senza numeri sulla qualità.
 */
export function qualityCardView(history: Pick<DietHistory, "weeks"> | undefined): QualityCardView | null {
  if (!history) return null;
  const current = history.weeks[history.weeks.length - 1]?.weekStart ?? "";
  const withData = [...history.weeks].reverse().filter((w) => w.daysWithData > 0);
  if (withData.length === 0) return null;

  const frame = withData.find(hasUsable);
  if (!frame) {
    const latest = withData[0];
    return { lines: [`Dati insufficienti: ${dayCount(latest.daysWithData)} su ${num(latest.daysElapsed)}.`], ...(latest.inProgress ? {} : { week: latest.weekStart }) };
  }

  const lines: string[] = [];
  const parts = SUMMARY.map((id) => find(frame, id))
    .filter(usable)
    .map((ind) => `${indicatorLabel(ind.id)} ${indicatorText(ind, frame)}`);
  lines.push(
    parts.length > 0
      ? `${opening(frame, current)}, ${dayCount(frame.daysWithData)}: ${parts.join(", ")}.`
      : `${opening(frame, current)}, ${dayCount(frame.daysWithData)} su ${num(frame.daysElapsed)}.`,
  );

  const processed = find(frame, "processedShare");
  if (usable(processed)) lines.push(`${capitalize(indicatorLabel("processedShare"))}: ${indicatorText(processed, frame)}.`);

  return { lines, ...(frame.inProgress ? {} : { week: frame.weekStart }) };
}
