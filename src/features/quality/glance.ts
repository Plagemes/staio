// Qualità «a colpo d'occhio»: le poche dimensioni con un esito, prima quelle a sfavore, per le schermate dove il
// prodotto compare (lettura del codice, scheda in dispensa, voce della spesa). Nessun punteggio unico. Logica pura.
import type { Product } from "@/core/catalog";
import { assessProduct, type Outcome } from "@/core/quality";
import { isDoubtfulProduct, isLocalProduct } from "./codes";

export interface GlanceChip {
  id: string;
  label: string;
  outcome: Exclude<Outcome, "not_assessable">;
}

export interface QualityGlanceView {
  /** Al massimo `GLANCE_MAX` dimensioni con un esito: sfavorevoli, poi intermedie, poi favorevoli. */
  chips: GlanceChip[];
  /** Una riga a parole, senza giudizi complessivi. */
  line: string;
  /** Quante dimensioni con esito restano fuori dai chip. */
  hidden: number;
}

export const GLANCE_MAX = 4;

const ORDER: Record<GlanceChip["outcome"], number> = { unfavorable: 0, intermediate: 1, favorable: 2 };

function shortLabel(label: string): string {
  return label.replace(" (NOVA)", "").replace("Grado di lavorazione", "Lavorazione");
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `null` per i codici interni dei negozi (la scheda può essere di un altro prodotto) e per i prodotti scritti a mano:
 * la scheda completa valuta solo le schede di Open Food Facts, e il riquadro non deve dire più di lei.
 */
export function qualityGlance(product: Product): QualityGlanceView | null {
  if (isDoubtfulProduct(product) || isLocalProduct(product)) return null;
  const { dimensions, summary } = assessProduct(product);
  const judged = dimensions
    .map((d, index) => ({ d, index }))
    .filter(({ d }) => d.kind === "graded" && d.outcome !== "not_assessable")
    .sort((a, b) => ORDER[a.d.outcome as GlanceChip["outcome"]] - ORDER[b.d.outcome as GlanceChip["outcome"]] || a.index - b.index)
    .map(({ d }) => ({ id: d.id, label: shortLabel(d.label), outcome: d.outcome as GlanceChip["outcome"] }));
  if (judged.length === 0) {
    return { chips: [], line: "Mancano i dati per dare un esito.", hidden: 0 };
  }
  const parts: string[] = [];
  if (summary.unfavorable > 0) parts.push(count(summary.unfavorable, "punto a sfavore", "punti a sfavore"));
  if (summary.intermediate > 0) parts.push(count(summary.intermediate, "punto intermedio", "punti intermedi"));
  if (summary.favorable > 0) parts.push(count(summary.favorable, "punto a favore", "punti a favore"));
  const chips = judged.slice(0, GLANCE_MAX);
  return { chips, line: `${parts.join(", ")}.`, hidden: judged.length - chips.length };
}
