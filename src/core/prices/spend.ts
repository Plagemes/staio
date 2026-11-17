// Spesa del periodo: dagli acquisti del registro. Un acquisto annullato o corretto non è più nel
// libro derivato, quindi non conta (o conta col prezzo corretto). Mai un prezzo inventato:
// gli acquisti senza prezzo si contano a parte e il totale diventa un minimo.
import { addDays, DEFAULT_TIME_ZONE } from "../expiry";
import type { Certainty, PantryState } from "../ledger";
import { worseCertainty } from "../ledger";
import { calendarDateOf, cmp } from "../shopping/common";

export type SpendPeriodId = "7" | "30" | "month";

export interface SpendRange {
  id: SpendPeriodId;
  /** Primo giorno compreso, `YYYY-MM-DD`. */
  from: string;
  /** Ultimo giorno compreso (oggi). */
  to: string;
}

export interface CategorySpend {
  /** Categoria del lotto; `null` se non indicata. */
  category: string | null;
  cents: number;
  pricedCount: number;
  unpricedCount: number;
}

export interface SpendSummary {
  range: SpendRange;
  /** Somma dei soli acquisti con prezzo, in centesimi interi. */
  totalCents: number;
  pricedCount: number;
  unpricedCount: number;
  /** Tutti gli acquisti del periodo, con o senza prezzo. */
  purchaseCount: number;
  /** Vero se qualche acquisto non ha prezzo: `totalCents` è almeno quel valore. */
  isMinimum: boolean;
  /** Dal più speso al meno speso; a parità, per nome. */
  byCategory: CategorySpend[];
  /** Certezza peggiore tra i prezzi contati; assente senza prezzi. */
  certainty?: Certainty;
}

/** Ultimi 7 giorni (oggi compreso), ultimi 30 e mese in corso dal primo del mese. */
export function spendRanges(today: string): SpendRange[] {
  return [
    { id: "7", from: addDays(today, -6), to: today },
    { id: "30", from: addDays(today, -29), to: today },
    { id: "month", from: `${today.slice(0, 7)}-01`, to: today },
  ];
}

export function summarizeSpend(
  pantry: PantryState,
  range: SpendRange,
  timeZone: string = DEFAULT_TIME_ZONE,
): SpendSummary {
  const byCat = new Map<string, CategorySpend>();
  let totalCents = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let certainty: Certainty | undefined;
  for (const lot of pantry.lots) {
    if (lot.origin !== "purchase") continue;
    const date = calendarDateOf(lot.createdAt, timeZone);
    if (date < range.from || date > range.to) continue;
    const label = lot.category?.trim() ? lot.category.trim() : null;
    const key = label === null ? "" : label.toLowerCase();
    let c = byCat.get(key);
    if (!c) {
      c = { category: label, cents: 0, pricedCount: 0, unpricedCount: 0 };
      byCat.set(key, c);
    }
    if (lot.priceCents === undefined) {
      unpricedCount += 1;
      c.unpricedCount += 1;
      continue;
    }
    totalCents += lot.priceCents;
    pricedCount += 1;
    c.cents += lot.priceCents;
    c.pricedCount += 1;
    const lc = lot.priceCertainty ?? "estimated";
    certainty = certainty === undefined ? lc : worseCertainty(certainty, lc);
  }
  const byCategory = [...byCat.values()].sort(
    (a, b) => b.cents - a.cents || cmp(a.category ?? "￿", b.category ?? "￿"),
  );
  return {
    range,
    totalCents,
    pricedCount,
    unpricedCount,
    purchaseCount: pricedCount + unpricedCount,
    isMinimum: unpricedCount > 0,
    byCategory,
    ...(certainty !== undefined ? { certainty } : {}),
  };
}

export interface MonthlyBudgetProgress {
  capCents: number;
  spentCents: number;
  /** Centesimi ancora disponibili; mai negativo. */
  remainingCents: number;
  /** Centesimi oltre il tetto; 0 se dentro. */
  overCents: number;
  /** Quota spesa del tetto, 0-1 (oltre 1 se superato). 0 se il tetto è 0. */
  share: number;
  /** La spesa è un minimo perché ci sono acquisti senza prezzo. */
  isMinimum: boolean;
  /** Giorni del mese che restano, oggi escluso. */
  daysLeft: number;
}

/** Avanzamento rispetto a un tetto mensile; descrive, non consiglia. */
export function monthlyBudgetProgress(month: SpendSummary, capCents: number): MonthlyBudgetProgress {
  const [y, m, d] = month.range.to.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    capCents,
    spentCents: month.totalCents,
    remainingCents: Math.max(0, capCents - month.totalCents),
    overCents: Math.max(0, month.totalCents - capCents),
    share: capCents > 0 ? month.totalCents / capCents : 0,
    isMinimum: month.isMinimum,
    daysLeft: daysInMonth - d,
  };
}
