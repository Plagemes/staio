// Frasi su prezzi e spesa. Logica pura: i numeri arrivano da `core/prices`.
import type { MonthlyBudgetProgress, ProductPriceHistory, SpendSummary } from "@/core/prices";
import type { UnitPrice } from "@/core/shopping";
import { formatPrice } from "../format";
import { FOOD_CATEGORY_LABELS } from "../labels";
import { isFoodCategory } from "../lots";

const dayMonthFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const dayMonthYearFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** «12 nov»; con un anno diverso da quello di `today`, «12 nov 2025». */
export function shortDayText(date: string, today: string): string {
  const format = date.slice(0, 4) === today.slice(0, 4) ? dayMonthFormat : dayMonthYearFormat;
  return format.format(new Date(`${date}T12:00:00Z`)).replace(/\./g, "");
}

export function unitPriceText(u: UnitPrice): string {
  return `${formatPrice(u.cents)}/${u.per === "pz" ? "pezzo" : u.per}`;
}

/** «L'ultima volta 1,89 €/l, di solito 1,75 €/l.» */
export function priceNote(h: ProductPriceHistory): string {
  return `L'ultima volta ${unitPriceText({ cents: h.last.cents, per: h.per })}, di solito ${unitPriceText(h.usual)}.`;
}

export function changeText(h: ProductPriceHistory): string {
  if (h.trend === "stable") return "stabile";
  const n = Math.abs(h.changePct).toLocaleString("it-IT", { maximumFractionDigits: 1 });
  return `${h.trend === "up" ? "+" : "-"}${n}% sul solito`;
}

const voci = (n: number) => `${n} ${n === 1 ? "voce" : "voci"}`;

/** Quanto è stato speso, dicendo quanta parte degli acquisti non ha prezzo. */
export function spendText(s: SpendSummary): string {
  if (s.purchaseCount === 0) return "Nessun acquisto registrato in questo periodo.";
  if (s.pricedCount === 0) return `${voci(s.unpricedCount)} comprate, nessuna con il prezzo: non so dire quanto hai speso.`;
  if (!s.isMinimum) return `Hai speso ${formatPrice(s.totalCents)} in ${voci(s.pricedCount)}, tutte con il prezzo.`;
  return `${s.unpricedCount} ${s.unpricedCount === 1 ? "voce" : "voci"} su ${s.purchaseCount} senza prezzo: il totale è almeno ${formatPrice(s.totalCents)}.`;
}

export function budgetText(p: MonthlyBudgetProgress): string {
  const least = p.isMinimum ? "almeno " : "";
  const days = p.daysLeft === 1 ? "1 giorno" : `${p.daysLeft} giorni`;
  if (p.overCents > 0) return `Questo mese ${least}${formatPrice(p.spentCents)} su ${formatPrice(p.capCents)}: ${formatPrice(p.overCents)} oltre il tetto${p.isMinimum ? " (e mancano i prezzi di alcune voci)" : ""}. Restano ${days}.`;
  return `Questo mese ${least}${formatPrice(p.spentCents)} su ${formatPrice(p.capCents)}: ${p.isMinimum ? "restano al massimo " : "restano "}${formatPrice(p.remainingCents)}, ${days} alla fine del mese.`;
}

export function categoryLabel(category: string | null): string {
  if (category === null) return "Senza categoria";
  if (isFoodCategory(category)) return FOOD_CATEGORY_LABELS[category];
  return category.charAt(0).toUpperCase() + category.slice(1);
}
