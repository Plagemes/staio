// Consumi di prodotti dal registro, pronti per il calcolo dell'impatto sulla dieta. Logica pura.
// Si contano solo i consumi che il registro lega a un prodotto con codice a barre; il resto si conta
// a parte e viene detto, perché un consumo che non si conta non vale zero.

import type { Product } from "@/core/catalog";
import { addDays } from "@/core/diary";
import { diffDays } from "@/core/expiry";
import type { DayIntake, IntakeLine } from "@/core/nutrition";
import { isDoubtfulProduct } from "./codes";
import { dietImpact, type ConsumptionEntry, type ImpactReport } from "@/core/quality";

export const MAX_WINDOW_DAYS = 28;
/** Sotto una settimana la media a settimana sarebbe una stima su pochi giorni: si calcola comunque su sette. */
export const MIN_WINDOW_DAYS = 7;

export interface ConsumptionSummary {
  entries: ConsumptionEntry[];
  /** Giorni su cui si fa la media a settimana. */
  windowDays: number;
  from: string;
  to: string;
  /** Consumi di prodotti con codice a barre e valori letti, entrati nel calcolo. */
  productLines: number;
  /** Consumi legati a un prodotto ma non utilizzabili (senza valori, in pezzi, prodotto non più salvato). */
  unusableLines: number;
  /** Consumi di prodotti con la scheda di un codice interno del negozio: la scheda può non essere quella giusta, non entrano. */
  restrictedLines: number;
  /** Altre voci risolte (alimenti generici dai pasti): non sono prodotti con codice e non entrano. */
  otherLines: number;
}

const linesOf = (day: DayIntake): IntakeLine[] => [...day.meals.flatMap((m) => m.lines), ...day.standalone];

/**
 * Finestra: dal primo giorno con consumi registrati (al massimo 28 giorni fa) a oggi, almeno 7 giorni.
 * Senza consumi registrati la finestra è comunque di 7 giorni.
 */
export function trackedWindow(days: readonly DayIntake[], today: string): { from: string; to: string; windowDays: number } {
  const dates = days.filter((d) => d.date <= today && linesOf(d).length > 0).map((d) => d.date).sort();
  const earliest = dates[0];
  const span = earliest === undefined ? MIN_WINDOW_DAYS : diffDays(today, earliest) + 1;
  const windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, span));
  return { from: addDays(today, -(windowDays - 1)), to: today, windowDays };
}

export function consumptionEntries(days: readonly DayIntake[], products: ReadonlyMap<string, Product>, today: string): ConsumptionSummary {
  const { from, to, windowDays } = trackedWindow(days, today);
  const timesPerWeek = 7 / windowDays;
  const entries: ConsumptionEntry[] = [];
  let unusableLines = 0;
  let otherLines = 0;
  let restrictedLines = 0;

  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    for (const line of linesOf(day)) {
      if (line.status === "unresolved") {
        // un consumo di dispensa senza valori non si lega a un prodotto: si dichiara come non usabile
        if (line.kind === "pantry") unusableLines += 1;
        continue;
      }
      if (line.composition.selection !== "product" || line.composition.ref === undefined) {
        otherLines += 1;
        continue;
      }
      const product = products.get(line.composition.ref);
      const unit = line.quantity.unit;
      if (!product || (unit !== "g" && unit !== "ml") || !(line.quantity.value > 0)) {
        unusableLines += 1;
        continue;
      }
      if (isDoubtfulProduct(product)) {
        restrictedLines += 1;
        continue;
      }
      entries.push({ product, amount: line.quantity.value, unit, timesPerWeek });
    }
  }

  return { entries, windowDays, from, to, productLines: entries.length, unusableLines, restrictedLines, otherLines };
}

export interface DietImpactView {
  summary: ConsumptionSummary;
  report: ImpactReport;
}

export function buildDietImpact(days: readonly DayIntake[], products: ReadonlyMap<string, Product>, today: string): DietImpactView {
  const summary = consumptionEntries(days, products, today);
  return { summary, report: dietImpact(summary.entries, { topContributors: 3, maxChanges: 3 }) };
}

/** Una riga per dire quanti consumi restano fuori perché il codice è interno al negozio; vuota se nessuno. */
export function restrictedExcludedText(count: number): string {
  if (count <= 0) return "";
  return `${count} ${count === 1 ? "consumo resta fuori" : "consumi restano fuori"}: il codice è interno al negozio e la scheda può non essere quella giusta.`;
}
