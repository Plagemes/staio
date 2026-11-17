// Riepilogo settimanale e mensile: scelta e spostamento del periodo, testi delle sezioni.
import {
  reportPeriod,
  type PeriodicReport,
  type ReportKind,
  type ReportPeriod,
  type SpendSection,
  type WasteSection,
  type WeightSection,
} from "@/core/analysis";
import { addDays } from "@/core/diary";
import { formatQuantity } from "@/core/units";
import { formatCalendarDate, formatPrice } from "../format";
import { DISCARD_REASON_LABELS } from "../labels";
import { REPORT_MIN } from "./config";
import { RELIABILITY_LABELS, days, formatDecimal, formatKgValue, plural, weighIns, type InsufficientView } from "./present";

export const REPORT_KINDS: { id: ReportKind; label: string }[] = [
  { id: "week", label: "Settimana" },
  { id: "month", label: "Mese" },
  { id: "year", label: "Anno" },
  { id: "range", label: "Intervallo" },
];

/** Un intervallo scelto non supera un anno bisestile: oltre, il rapporto non è più leggibile né stampabile. */
export const RANGE_MAX_DAYS = 366;

const MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

const dayMonth = (date: string): string => formatCalendarDate(date).replace(/ \d{4}$/, "");

/** "9 – 15 nov 2026" per la settimana e l'intervallo, "novembre 2026" per il mese, "2026" per l'anno. */
export function periodTitle(period: ReportPeriod): string {
  if (period.kind === "year") return period.from.slice(0, 4);
  if (period.kind === "month") {
    const [y, m] = period.from.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  const from = sameMonth ? String(Number(period.from.slice(8))) : dayMonth(period.from);
  return `${from} – ${formatCalendarDate(period.to)}`;
}

/** Il periodo precedente (`-1`) o successivo (`1`) allo stesso tipo. */
export function shiftPeriod(period: ReportPeriod, direction: -1 | 1): ReportPeriod {
  if (period.kind === "range") {
    const from = direction === -1 ? addDays(period.from, -period.days) : addDays(period.to, 1);
    return { kind: "range", from, to: addDays(from, period.days - 1), days: period.days };
  }
  return reportPeriod(period.kind, direction === -1 ? addDays(period.from, -1) : addDays(period.to, 1));
}

/** Non si va oltre il periodo che contiene oggi: un periodo futuro non ha dati. */
export function canGoNext(period: ReportPeriod, today: string): boolean {
  return addDays(period.to, 1) <= today;
}

/** Nota per il periodo non finito: i giorni a venire non si contano, né come tracciati né come vuoti. */
export function partialNote(period: ReportPeriod): string | undefined {
  if (!period.partial) return undefined;
  const elapsed = period.elapsedDays ?? 0;
  if (elapsed === 0) return "Il periodo non è ancora iniziato: non c'è niente da contare.";
  const through = period.through !== undefined ? ` (fino al ${formatCalendarDate(period.through)})` : "";
  return `Il periodo non è finito: ${elapsed} ${elapsed === 1 ? "giorno trascorso" : "giorni trascorsi"} su ${period.days}${through}. I conteggi riguardano solo i giorni passati; quelli a venire non sono contati come vuoti.`;
}

export function trackingText(section: PeriodicReport["tracking"]): string {
  const total = section.basis.periodDays;
  const unit = section.basis.partial ? "trascorsi" : "del periodo";
  const parts = [`${days(section.completeDays)} tracciati per intero su ${total} ${unit}`];
  if (section.declaredDays > 0) parts.push(`${plural(section.declaredDays, "giorno", "giorni")} con un pasto dichiarato non tracciato`);
  parts.push(`${plural(section.gapDays, "giorno", "giorni")} con vuoti`);
  return parts.join(" · ");
}

/** «3 pranzi saltati, 1 cena saltata»: solo un conteggio di ciò che hai dichiarato, senza giudizio. */
export function skippedText(skipped: PeriodicReport["meals"]["skipped"]): string | undefined {
  if (skipped.total === 0) return undefined;
  const parts: string[] = [];
  if (skipped.breakfast > 0) parts.push(plural(skipped.breakfast, "colazione saltata", "colazioni saltate"));
  if (skipped.lunch > 0) parts.push(plural(skipped.lunch, "pranzo saltato", "pranzi saltati"));
  if (skipped.dinner > 0) parts.push(plural(skipped.dinner, "cena saltata", "cene saltate"));
  return parts.join(", ");
}

export function mealsText(section: PeriodicReport["meals"]): string {
  const parts = [`${plural(section.tracked, "pasto tracciato", "pasti tracciati")}`];
  if (section.untracked > 0) parts.push(`${plural(section.untracked, "pasto segnato", "pasti segnati")} come non tracciato`);
  const skipped = skippedText(section.skipped);
  if (skipped !== undefined) parts.push(skipped);
  if (section.trackedPerCompleteDay !== undefined) {
    parts.push(`${formatDecimal(section.trackedPerCompleteDay, 1)} al giorno nei giorni completi`);
  }
  return parts.join(" · ");
}

export function weightReportText(section: Extract<WeightSection, { status: "ok" }>): string[] {
  const change = section.changeKg;
  const changeText =
    change === 0
      ? "invariato"
      : `${change > 0 ? "+" : "−"}${formatDecimal(Math.abs(change), 1)} kg`;
  return [
    `Dal ${dayMonth(section.first.date)} (${formatKgValue(section.first.kg)}) al ${dayMonth(section.last.date)} (${formatKgValue(section.last.kg)}): ${changeText}.`,
    `Media ${formatKgValue(section.averageKg)}, da ${formatKgValue(section.minKg)} a ${formatKgValue(section.maxKg)}.`,
    "Il confronto è tra due singole pesate, non una tendenza: il peso oscilla da un giorno all'altro.",
  ];
}

export function reportWeightBasis(section: Extract<WeightSection, { status: "ok" }>): string {
  return `${weighIns(section.weighIns)} · affidabilità ${RELIABILITY_LABELS[section.reliability]}`;
}

export function spendText(section: SpendSection): string[] {
  const total = section.purchasesWithPrice + section.purchasesWithoutPrice;
  if (section.purchasesWithPrice === 0) {
    return [`Spesa non nota: nessun acquisto ha il prezzo registrato (${plural(total, "acquisto", "acquisti")}).`];
  }
  const lines = [
    `${formatPrice(section.spentCents)} su ${plural(section.purchasesWithPrice, "acquisto con il prezzo registrato", "acquisti con il prezzo registrato")}.`,
  ];
  if (section.purchasesWithoutPrice > 0) {
    lines.push(
      `${plural(section.purchasesWithoutPrice, "acquisto", "acquisti")} senza prezzo: ${section.purchasesWithoutPrice === 1 ? "non è contato" : "non sono contati"}, quindi la spesa vera può essere più alta.`,
    );
  }
  return lines;
}

/** "5 acquisti in 1 giorno": il conteggio con la sua unità, concordata. */
export function occurrencesText(count: number, one: string, many: string, dayCount: number): string {
  return `${plural(count, one, many)} in ${plural(dayCount, "giorno", "giorni")}`;
}

export function wasteItemText(item: WasteSection["items"][number]): string {
  return `${DISCARD_REASON_LABELS[item.reason]}: ${formatQuantity({ value: item.quantity, unit: item.unit })} (${plural(item.events, "volta", "volte")})`;
}

export function wasteCostText(section: WasteSection): string[] {
  const lines: string[] = [];
  if (section.discardsWithPrice > 0) {
    lines.push(`Costo stimato della parte buttata: ${formatPrice(section.costCents)}, dei soli lotti con il prezzo registrato.`);
  }
  if (section.discardsWithoutPrice > 0) {
    lines.push(`${plural(section.discardsWithoutPrice, "scarto", "scarti")} senza prezzo del lotto: non ${section.discardsWithoutPrice === 1 ? "è contato" : "sono contati"} nel costo.`);
  }
  return lines;
}

const TITLE = "Dati insufficienti";

/** Sezione senza registrazioni: "non registrato" non è "zero", e la schermata lo dice. */
export function noRecordsView(what: string): InsufficientView {
  return {
    title: TITLE,
    reasons: [`Nessun dato registrato nel periodo per ${what}.`],
    missing: ["Non vuol dire zero: vuol dire che non è stato registrato."],
  };
}

export function weightInsufficientView(section: Extract<WeightSection, { status: "insufficient" }>): InsufficientView {
  if (section.reasons.some((r) => r === "few_records")) {
    const have = section.basis.usedDays;
    return {
      title: TITLE,
      reasons: [`Nel periodo ci sono ${weighIns(have)}.`],
      missing: [`Mancano ancora ${weighIns(Math.max(0, REPORT_MIN.weighIns - have))}: servono almeno ${REPORT_MIN.weighIns} per mostrare il peso.`],
    };
  }
  return noRecordsView("il peso");
}

export function nutrientsInsufficientView(completeDays: number): InsufficientView {
  return {
    title: TITLE,
    reasons: [`Nel periodo ci sono ${days(completeDays)} tracciati per intero.`],
    missing: [`Mancano ancora ${days(Math.max(0, REPORT_MIN.completeDays - completeDays))}: servono almeno ${REPORT_MIN.completeDays} per il confronto con i riferimenti.`],
  };
}
