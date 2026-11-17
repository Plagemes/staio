// Scorte minime: i prodotti abituali con la scorta impostata e il suggerimento ricavato dai consumi, da confermare.
import type { PantryState, Unit } from "@/core/ledger";
import { forecastConsumption, normalizeName, suggestMinimum, type MinimumSuggestion, type StockConfig } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { forecastNote } from "./reasons";

export interface StockRow {
  id: string;
  name: string;
  unit: Unit;
  stockText: string;
  /** Scorta minima già impostata. */
  minimum?: number;
  minimumText?: string;
  /** Mai applicato da solo: l'utente conferma. Assente se lo storico non basta. */
  suggestion?: MinimumSuggestion;
  suggestionText?: string;
  /** Perché non c'è un suggerimento. */
  noSuggestionText?: string;
}

/** Prodotti comprati almeno due volte (abituali), più quelli con una scorta minima già impostata. */
export function stockRows(pantry: PantryState, config: StockConfig, today: string, minPurchases = 2): StockRow[] {
  const purchases = new Map<string, number>();
  for (const lot of pantry.lots) {
    if (lot.origin !== "purchase") continue;
    const id = `${normalizeName(lot.productRef)}|${lot.unit}`;
    purchases.set(id, (purchases.get(id) ?? 0) + 1);
  }
  const configured = new Map(config.minimums.map((m) => [m.id, m]));
  const rows: StockRow[] = [];
  for (const f of forecastConsumption(pantry, today)) {
    const min = configured.get(f.id);
    if ((purchases.get(f.id) ?? 0) < minPurchases && !min) continue;
    const suggestion = suggestMinimum(f) ?? undefined;
    const row: StockRow = {
      id: f.id,
      name: f.name,
      unit: f.unit,
      stockText: f.stock > 0 ? `In casa: ${formatQuantity({ value: f.stock, unit: f.unit })}` : "Non ne hai in casa",
    };
    if (min) {
      row.minimum = min.minimum;
      row.minimumText = formatQuantity({ value: min.minimum, unit: f.unit });
    }
    if (suggestion) {
      row.suggestion = suggestion;
      const { low, high } = suggestion.suggestedRange;
      row.suggestionText =
        `Suggerita dai tuoi consumi: ${formatQuantity({ value: suggestion.suggested, unit: f.unit })} ` +
        `(stima: tra ${formatQuantity({ value: low, unit: f.unit })} e ${formatQuantity({ value: high, unit: f.unit })}, ${suggestion.basis.reserveDays} giorni di scorta, da ${suggestion.basis.observations} consumi o scarti)`;
    } else {
      row.noSuggestionText = forecastNote(f)?.replace("Non so quando finirà", "Non posso suggerirla") ?? "Non posso suggerirla: i consumi di questo prodotto sono troppo pochi o nulli.";
    }
    rows.push(row);
  }
  return rows.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}
