// Tipi dell'indice di qualità. Nessun voto unico: ogni dimensione ha il proprio esito, la propria
// spiegazione e la propria fonte. Un dato mancante dà sempre "non valutabile", mai "favorevole".

import type { NovaGroup, NutriScore } from "../catalog";

export type Outcome = "favorable" | "intermediate" | "unfavorable" | "not_assessable";

export const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  favorable: "favorevole",
  intermediate: "intermedio",
  unfavorable: "sfavorevole",
  not_assessable: "non valutabile",
};

/** Da dove viene una soglia o una definizione: ente, documento e indirizzo. */
export interface SourceRef {
  body: string;
  document: string;
  url: string;
}

export type NutrientDimensionId = "fat" | "saturatedFat" | "sugars" | "salt";

export type DimensionId = NutrientDimensionId | "nutriScore" | "nova" | "additives" | "nutrientDensity";

/**
 * `graded`: ha un esito fondato su una soglia o su un dato con fonte.
 * `descriptive`: mostra solo valori, senza giudizio (non entra nel conteggio dei non valutabili).
 */
export type DimensionKind = "graded" | "descriptive";

export type TrafficBand = "green" | "amber" | "red";

interface DimensionBase {
  label: string;
  kind: DimensionKind;
  outcome: Outcome;
  /** Spiegazione breve in italiano, con il dato su cui si fonda. */
  explanation: string;
  /** Fonti del giudizio (vuoto quando l'esito è "non valutabile" per dato mancante). */
  sources: readonly SourceRef[];
}

export interface NutrientDimension extends DimensionBase {
  id: NutrientDimensionId;
  kind: "graded";
  /** Valore del prodotto, per 100 g o 100 ml. */
  value?: number;
  per?: "100g" | "100ml";
  /** Tabella di soglie applicata. */
  table?: "food" | "drink";
  lowMax?: number;
  highAbove?: number;
  band?: TrafficBand;
}

export interface NutriScoreDimension extends DimensionBase {
  id: "nutriScore";
  kind: "graded";
  grade?: NutriScore;
}

export interface NovaDimension extends DimensionBase {
  id: "nova";
  kind: "graded";
  group?: NovaGroup;
}

export interface AdditiveEntry {
  /** Codice nella forma "E330". */
  code: string;
  /** Presente solo se esiste una dichiarazione ufficiale verificata per questo additivo. */
  statement?: {
    kind: "not_authorised_in_food" | "label_warning";
    outcome: Exclude<Outcome, "favorable" | "not_assessable">;
    name: string;
    text: string;
    source: SourceRef;
  };
}

export interface AdditivesDimension extends DimensionBase {
  id: "additives";
  /** `descriptive` quando l'elenco dichiarato è vuoto (nessun additivo, senza giudizio). */
  kind: DimensionKind;
  /** Numero di additivi dichiarati; assente se il prodotto non porta il dato. */
  count?: number;
  items: readonly AdditiveEntry[];
}

export interface DensityDimension extends DimensionBase {
  id: "nutrientDensity";
  kind: "descriptive";
  proteinGPer100Kcal?: number;
  fiberGPer100Kcal?: number;
}

export type Dimension =
  | NutrientDimension
  | NutriScoreDimension
  | NovaDimension
  | AdditivesDimension
  | DensityDimension;

export interface AssessmentSummary {
  favorable: number;
  intermediate: number;
  unfavorable: number;
  /** Dimensioni con giudizio (`graded`) che non si possono valutare. */
  notAssessable: number;
  /** Dimensioni con giudizio in totale. */
  graded: number;
  /** Dimensioni solo descrittive. */
  descriptive: number;
  /** Frase breve in italiano: elenco degli esiti, senza punteggio. */
  text: string;
}

export interface QualityAssessment {
  barcode: string;
  name?: string;
  dimensions: readonly Dimension[];
  summary: AssessmentSummary;
}

/** Ordine dal migliore al peggiore; `not_assessable` non ha posto nell'ordine. */
export const OUTCOME_RANK: Readonly<Record<Exclude<Outcome, "not_assessable">, number>> = {
  favorable: 0,
  intermediate: 1,
  unfavorable: 2,
};
