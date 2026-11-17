// Valutazione di un prodotto: l'elenco delle dimensioni con il loro esito. Nessun punteggio unico.

import type { Product } from "../catalog";
import {
  assessAdditives,
  assessDensity,
  assessNova,
  assessNutriScore,
  assessNutrient,
} from "./dimensions";
import type { AssessmentSummary, Dimension, QualityAssessment } from "./types";

export function summarize(dimensions: readonly Dimension[]): AssessmentSummary {
  const graded = dimensions.filter((d) => d.kind === "graded");
  const count = (o: Dimension["outcome"]) => graded.filter((d) => d.outcome === o).length;
  const favorable = count("favorable");
  const intermediate = count("intermediate");
  const unfavorable = count("unfavorable");
  const notAssessable = count("not_assessable");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    favorable,
    intermediate,
    unfavorable,
    notAssessable,
    graded: graded.length,
    descriptive: dimensions.length - graded.length,
    text: `${plural(favorable, "favorevole", "favorevoli")}, ${plural(intermediate, "intermedia", "intermedie")}, ${plural(unfavorable, "sfavorevole", "sfavorevoli")}, ${plural(notAssessable, "non valutabile", "non valutabili")} su ${plural(graded.length, "dimensione", "dimensioni")} con giudizio.`,
  };
}

export interface AssessOptions {
  /** Il prodotto ha gli ingredienti analizzati: un elenco di additivi assente vale "nessun additivo". */
  ingredientsAnalysed?: boolean;
}

export function assessProduct(product: Product, options: AssessOptions = {}): QualityAssessment {
  const dimensions: Dimension[] = [
    assessNutrient(product, "fat"),
    assessNutrient(product, "saturatedFat"),
    assessNutrient(product, "sugars"),
    assessNutrient(product, "salt"),
    assessNutriScore(product),
    assessNova(product),
    assessAdditives(product, options),
    assessDensity(product),
  ];
  return {
    barcode: product.barcode,
    ...(product.name !== undefined ? { name: product.name } : {}),
    dimensions,
    summary: summarize(dimensions),
  };
}

/** La dimensione che ha quell'identificativo (le dimensioni nutrizionali condividono un'unica interfaccia). */
export type DimensionById<Id extends Dimension["id"]> = Dimension extends infer D
  ? D extends { id: infer I }
    ? Id extends I
      ? D
      : never
    : never
  : never;

export function dimensionOf<Id extends Dimension["id"]>(
  assessment: QualityAssessment,
  id: Id,
): DimensionById<Id> | undefined {
  return assessment.dimensions.find((d) => d.id === id) as DimensionById<Id> | undefined;
}
