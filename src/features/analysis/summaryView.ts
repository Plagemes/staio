// Testi del riepilogo del periodo (cibo del periodo, spreco, confronto). Nessun giudizio: numeri, quota di dati e
// ciò che manca. I calcoli stanno in `core/analysis/summary`.
import type {
  ComparisonMetric,
  ComparisonSection,
  DataBasis,
  FlowSection,
  QuantityTotal,
  WasteSummary,
} from "@/core/analysis";
import { formatQuantity } from "@/core/units";
import { formatPrice } from "../format";
import { DISCARD_REASON_LABELS, FOOD_CATEGORY_LABELS } from "../labels";
import { formatCalendarDate } from "../format";
import { formatDecimal, formatSigned, plural } from "./present";

/** «1 kg · 500 ml»: le unità diverse non si sommano, restano una accanto all'altra. */
export function quantitiesText(quantities: readonly QuantityTotal[]): string {
  return quantities.map((q) => formatQuantity({ value: q.value, unit: q.unit })).join(" · ");
}

/** «22 giorni registrati su 30»: la quota di dati su cui poggia un numero (giorni trascorsi se il periodo è in corso). */
export function shareText(basis: DataBasis, what = "registrati"): string {
  const unit = basis.partial ? " trascorsi" : "";
  const used = basis.usedDays;
  const noun = what === "registrati" ? (used === 1 ? "giorno registrato" : "giorni registrati") : `${used === 1 ? "giorno" : "giorni"} ${what}`;
  return `${used} ${noun} su ${basis.periodDays}${unit}`;
}

/** Riga di base di una sezione: la quota di giorni, più (se serve) la data fino a cui si è contato. */
export function sectionBasisText(basis: DataBasis, what?: string): string {
  const head = `Su ${shareText(basis, what)}`;
  if (basis.partial && basis.throughDate !== undefined) return `${head} (fino al ${formatCalendarDate(basis.throughDate)})`;
  return head;
}

export function valueLine(flow: Pick<FlowSection, "valueCents" | "withPrice" | "withoutPrice">, what: string): string | undefined {
  if (flow.withPrice === 0) return undefined;
  const missing =
    flow.withoutPrice > 0
      ? ` Per ${plural(flow.withoutPrice, "voce", "voci")} il prezzo non è registrato: non ${flow.withoutPrice === 1 ? "è contata" : "sono contate"}, quindi il valore vero può essere più alto.`
      : "";
  return `Valore ${what}: ${formatPrice(flow.valueCents)}, delle sole voci con il prezzo registrato.${missing}`;
}

export function categoryName(category: string | null): string {
  if (category === null) return "Senza categoria";
  return (FOOD_CATEGORY_LABELS as Record<string, string>)[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

export function wasteReasonLine(reason: keyof typeof DISCARD_REASON_LABELS, quantities: readonly QuantityTotal[], events: number): string {
  return `${DISCARD_REASON_LABELS[reason]}: ${quantitiesText(quantities)} (${plural(events, "volta", "volte")})`;
}

export function savedText(saved: NonNullable<WasteSummary["saved"]>): string {
  return `${plural(saved.lots, "alimento spostato", "alimenti spostati")} in freezer prima della scadenza, ${quantitiesText(saved.quantities)} in tutto.`;
}

export function expiredUnresolvedText(count: number): string {
  return `${plural(count, "alimento ha", "alimenti hanno")} la scadenza nel periodo e ${count === 1 ? "risulta" : "risultano"} ancora in dispensa. Se ${count === 1 ? "l'hai buttato" : "li hai buttati"}, registralo: finché non c'è, non è contato come buttato.`;
}

export const COMPARISON_LABELS: Record<ComparisonMetric["id"], string> = {
  completeDays: "Giorni tracciati per intero",
  waterAvg: "Acqua nei giorni registrati",
  weightAvg: "Peso medio",
  moodAvg: "Umore medio",
  eatenG: "Cibo mangiato",
  wastedG: "Cibo buttato",
  spendCents: "Spesa (voci con prezzo)",
};

function format(id: ComparisonMetric["id"], v: number): string {
  switch (id) {
    case "completeDays":
      return plural(v, "giorno", "giorni");
    case "waterAvg":
      return `${formatDecimal(v, 0)} ml`;
    case "weightAvg":
      return `${formatDecimal(v, 1)} kg`;
    case "moodAvg":
      return `${formatDecimal(v, 1)} su 5`;
    case "eatenG":
    case "wastedG":
      return formatQuantity({ value: v, unit: "g" });
    case "spendCents":
      return formatPrice(v);
  }
}

function formatDelta(id: ComparisonMetric["id"], d: number): string {
  switch (id) {
    case "completeDays":
      return `${formatSigned(d, 0)} giorni`;
    case "waterAvg":
      return `${formatSigned(d, 0)} ml`;
    case "weightAvg":
      return `${formatSigned(d, 1)} kg`;
    case "moodAvg":
      return formatSigned(d, 1);
    case "eatenG":
    case "wastedG":
      return `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatQuantity({ value: Math.abs(d), unit: "g" })}`;
    case "spendCents":
      return `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatPrice(Math.abs(d))}`;
  }
}

/** «Acqua nei giorni registrati: 1.500 ml, prima 1.000 ml (+500 ml)». */
export function comparisonLine(m: ComparisonMetric): string {
  const change = m.delta === 0 ? "invariato" : formatDelta(m.id, m.delta);
  return `${COMPARISON_LABELS[m.id]}: ${format(m.id, m.current)}, prima ${format(m.id, m.previous)} (${change})`;
}

export function comparisonRangeText(c: Pick<Extract<ComparisonSection, { status: "ok" }>, "previous">): string {
  return `Confronto con i ${plural(c.previous.days, "giorno", "giorni")} precedenti, dal ${formatCalendarDate(c.previous.from)} al ${formatCalendarDate(c.previous.to)}.`;
}

export function comparisonThresholdText(c: { minRecordedDays: number; recordedDays: { current: number; previous: number } }): string {
  return `Il confronto serve solo se in entrambi i periodi almeno metà dei giorni (e comunque 3) ha qualcosa di registrato: qui ${plural(c.minRecordedDays, "giorno", "giorni")}. Ce ne sono ${c.recordedDays.current} in questo periodo e ${c.recordedDays.previous} nel precedente.`;
}
