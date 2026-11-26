// «Da cosa è fatto» per i costi di Spesa: dalle parti che i calcoli restituiscono (`view.items`, `summary.purchases`) alle
// righe del foglio comune. Qui non si ricalcola niente: sono centesimi interi, e la somma delle righe è il totale.
import { addDays } from "@/core/expiry";
import type { MonthlyBudgetProgress, SpendPurchase, SpendRange, SpendSummary } from "@/core/prices";
import type { BreakdownRow, BreakdownSheetProps } from "../common/Breakdown";
import { formatPrice } from "../format";
import { REVEAL_MAX_DAYS_BACK } from "../today/reveal";
import { itemQuantityText } from "./listText";
import { categoryLabel, shortDayText, unitPriceText } from "./priceText";
import type { ShoppingView, ViewItem } from "./view";

export type BreakdownContent = Omit<BreakdownSheetProps, "onClose">;

const byName = (a: { name: string }, b: { name: string }) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);

/* ---------- N1: costo stimato della lista ---------- */

/** «1,89 €/l · il 12 nov da Conad» */
function estimateHint(v: ViewItem, today: string): string | undefined {
  const e = v.estimate;
  if (!e) return undefined;
  return `${unitPriceText(e.unitPrice)} · il ${shortDayText(e.date, today)}${e.store ? ` da ${e.store}` : ""}`;
}

/** Il foglio «Costo stimato»: una riga per voce con un prezzo osservato, dalla più cara; sotto, le voci senza prezzo. */
export function shoppingCostContent(view: Pick<ShoppingView, "items" | "today" | "cost">): BreakdownContent {
  const priced = view.items.filter((v) => v.costCents !== null).sort((a, b) => (b.costCents as number) - (a.costCents as number) || byName(a, b));
  const unpriced = view.items.filter((v) => v.costCents === null).sort(byName);
  const rows: BreakdownRow[] = priced.map((v) => ({
    id: v.id,
    label: `${v.name} · ${itemQuantityText(v)}`,
    value: formatPrice(v.costCents as number),
    certainty: "estimated",
    ...(estimateHint(v, view.today) ? { hint: estimateHint(v, view.today) } : {}),
  }));
  const missing: BreakdownRow[] = unpriced.map((v) => ({ id: v.id, label: `${v.name} · ${itemQuantityText(v)}`, value: "non conta" }));
  const total = priced.reduce((sum, v) => sum + (v.costCents as number), 0);
  return {
    title: "Costo stimato",
    total: formatPrice(total),
    ...(unpriced.length > 0 ? { totalPrefix: "almeno" } : {}),
    totalCertainty: "estimated",
    rows,
    ...(missing.length > 0 ? { missingLabel: `Senza prezzo (${missing.length})`, missing } : {}),
    note: "È l'ultimo prezzo che hai pagato, per la quantità in lista: una stima, non un preventivo.",
  };
}

/* ---------- N4, N5: spesa del periodo ---------- */

const PERIOD_TITLE: Record<SpendRange["id"], string> = {
  "7": "Spesa degli ultimi 7 giorni",
  "30": "Spesa degli ultimi 30 giorni",
  month: "Spesa di questo mese",
};

/** `/app?voce=<id evento>`, solo se Oggi arriva fin lì (`REVEAL_MAX_DAYS_BACK` giorni). */
export function purchaseHref(p: Pick<SpendPurchase, "eventId" | "date">, today: string): string | undefined {
  if (p.date > today || p.date < addDays(today, -REVEAL_MAX_DAYS_BACK)) return undefined;
  return `/app?voce=${encodeURIComponent(p.eventId)}`;
}

/** «Tetto del mese: 300 €. Restano 70 €, 12 giorni.» */
export function budgetLead(p: MonthlyBudgetProgress): string {
  const days = p.daysLeft === 1 ? "1 giorno" : `${p.daysLeft} giorni`;
  const cap = `Tetto del mese: ${formatPrice(p.capCents)}.`;
  if (p.overCents > 0) return `${cap} Sei oltre di ${formatPrice(p.overCents)}. Restano ${days}.`;
  return `${cap} ${p.isMinimum ? "Restano al massimo " : "Restano "}${formatPrice(p.remainingCents)}, ${days}.`;
}

/**
 * Il foglio della spesa di un periodo. `range` è quello della scheda scelta (per il titolo e per «oggi»); con `progress`,
 * il tetto del mese, dice quanto resta. Gli acquisti stanno per categoria (dalla più spesa), dentro la categoria dal più caro.
 */
export function spendContent(summary: SpendSummary, range: SpendRange, progress?: MonthlyBudgetProgress | null): BreakdownContent {
  const today = range.to;
  const rank = new Map(summary.byCategory.map((c, i) => [c.category, i]));
  const order = (p: SpendPurchase) => rank.get(p.category) ?? Number.MAX_SAFE_INTEGER;
  const priced = summary.purchases
    .filter((p) => p.cents !== undefined)
    .sort((a, b) => order(a) - order(b) || (b.cents as number) - (a.cents as number) || a.date.localeCompare(b.date) || byName(a, b));
  const unpriced = summary.purchases.filter((p) => p.cents === undefined).sort((a, b) => a.date.localeCompare(b.date) || byName(a, b));
  const label = (p: SpendPurchase) => `${p.name} · ${shortDayText(p.date, today)}${p.store ? `, ${p.store}` : ""}`;
  const href = (p: SpendPurchase) => purchaseHref(p, today);
  const rows: BreakdownRow[] = priced.map((p) => ({
    id: p.eventId + ":" + p.lotId,
    label: label(p),
    value: formatPrice(p.cents as number),
    ...(p.certainty ? { certainty: p.certainty } : {}),
    hint: categoryLabel(p.category),
    ...(href(p) ? { href: href(p) } : {}),
  }));
  const missing: BreakdownRow[] = unpriced.map((p) => ({
    id: p.eventId + ":" + p.lotId,
    label: label(p),
    value: "non conta",
    hint: categoryLabel(p.category),
    ...(href(p) ? { href: href(p) } : {}),
  }));
  const total = priced.reduce((sum, p) => sum + (p.cents as number), 0);
  return {
    title: PERIOD_TITLE[range.id],
    total: formatPrice(total),
    ...(summary.isMinimum ? { totalPrefix: "almeno" } : {}),
    totalCertainty: summary.certainty ?? "estimated",
    lead: progress ? budgetLead(progress) : `Gli acquisti registrati dal ${shortDayText(range.from, today)} al ${shortDayText(range.to, today)}.`,
    rows,
    ...(missing.length > 0 ? { missingLabel: `Senza prezzo (${missing.length})`, missing } : {}),
    note: "Contano gli acquisti registrati con un prezzo; quelli annullati o corretti nel registro valgono come corretti.",
  };
}
