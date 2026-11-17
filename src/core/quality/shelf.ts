// Modalità scaffale: un verdetto breve per un prodotto appena letto. Mette insieme le dimensioni,
// che cosa aiuta o pesa per l'utente, se ne ha già in casa e un'alternativa tra i candidati forniti.

import type { BaseUnit, Product } from "../catalog";
import type { ReferenceComparison } from "../nutrition";
import {
  findAlternatives,
  COMPARABLE_DIMENSIONS,
  type Alternative,
  type AlternativesResult,
  type Candidate,
  type ComparableDimensionId,
  type NoAlternativeReason,
  type PriceObservation,
} from "./alternatives";
import { assessProduct } from "./assess";
import { fmt, productLabel } from "./common";
import { personalVerdict, type PersonalGoal, type PersonalVerdict } from "./personal";
import { OUTCOME_LABEL, OUTCOME_RANK, type QualityAssessment } from "./types";

/** Come è stato cercato il prodotto in dispensa. */
export type PantryMatchBy = "barcode" | "name" | "category";

export interface PantryStock {
  has: boolean;
  /** Quantità in casa, se nota. */
  amount?: number;
  unit?: BaseUnit;
  /**
   * Con che criterio è stata trovata la corrispondenza quando `has` è vero. Assente = per codice a barre.
   * Per nome o categoria il prodotto in casa è simile, non lo stesso.
   */
  matchedBy?: PantryMatchBy;
  /** Che cosa si è trovato per nome o categoria (per esempio il nome del prodotto in casa). */
  matchLabel?: string;
  /**
   * Con quali criteri è stata fatta la ricerca. Assente = solo per codice a barre: quando `has` è falso
   * il testo lo dice, perché una confezione senza questo codice può essere in casa con un altro codice.
   */
  searchedBy?: readonly PantryMatchBy[];
}

export interface ShelfInput {
  product: Product;
  /** Risultato del motore nutrizionale per l'utente; assente se non ce ne sono. */
  comparisons?: readonly ReferenceComparison[];
  goals?: readonly PersonalGoal[];
  /** Prodotti già letti o comprati, tra cui cercare l'alternativa. */
  candidates?: readonly Candidate[];
  /** Prezzi osservati del prodotto, per confrontare il prezzo per unità. */
  prices?: readonly PriceObservation[];
  /** Dato sulla dispensa; assente = non so se ne ha in casa. */
  pantry?: PantryStock;
  /** Il prodotto ha gli ingredienti analizzati: un elenco di additivi assente vale "nessun additivo". */
  ingredientsAnalysed?: boolean;
}

export interface ShelfVerdict {
  /** Frase breve con il conteggio degli esiti: non è un voto. */
  headline: string;
  assessment: QualityAssessment;
  personal: PersonalVerdict;
  /** Assente se il dato sulla dispensa non è stato passato. */
  pantryLine?: string;
  alternative: Alternative | null;
  /** Presenti quando non c'è un'alternativa: il motivo come valore enumerato e il testo in italiano. */
  alternativeReason?: NoAlternativeReason;
  alternativeReasonText?: string;
  /** Righe pronte da mostrare, in ordine di importanza. */
  lines: string[];
}

export function shelfVerdict(input: ShelfInput): ShelfVerdict {
  const assessment = assessProduct(input.product, input.ingredientsAnalysed === undefined ? {} : { ingredientsAnalysed: input.ingredientsAnalysed });
  const personal = personalVerdict(input.product, input.comparisons, input.goals ?? []);
  const lines: string[] = [];

  const graded = assessment.dimensions.filter((d) => d.kind === "graded");
  for (const outcome of ["unfavorable", "intermediate", "favorable"] as const) {
    const labels = graded.filter((d) => d.outcome === outcome).map((d) => d.label);
    if (labels.length > 0) lines.push(`${OUTCOME_LABEL[outcome][0].toUpperCase()}${OUTCOME_LABEL[outcome].slice(1)}: ${labels.join(", ")}.`);
  }
  const unknown = graded.filter((d) => d.outcome === "not_assessable").map((d) => d.label);
  if (unknown.length > 0) lines.push(`Non valutabile: ${unknown.join(", ")}.`);

  if (personal.status === "insufficient_data") {
    lines.push(personal.reason ?? "Dati insufficienti per dire come incide su di te.");
  } else {
    for (const s of personal.weighs) lines.push(`Per te pesa: ${s.text}`);
    for (const s of personal.helps) lines.push(`Per te aiuta: ${s.text}`);
    if (personal.weighs.length === 0 && personal.helps.length === 0) {
      lines.push("Per te: nessuna affermazione fondata sui dati disponibili.");
    }
  }

  let pantryLine: string | undefined;
  if (input.pantry) {
    pantryLine = pantryText(input.pantry);
    lines.push(pantryLine);
  }

  let alternative: Alternative | null = null;
  const results: AlternativesResult[] = [];
  const ranked = graded
    .filter((d): d is typeof d & { outcome: "intermediate" | "unfavorable" } => d.outcome === "intermediate" || d.outcome === "unfavorable")
    .filter((d) => (COMPARABLE_DIMENSIONS as readonly string[]).includes(d.id))
    .sort((a, b) => OUTCOME_RANK[b.outcome] - OUTCOME_RANK[a.outcome]);
  for (const d of ranked) {
    const result = findAlternatives({ product: input.product, ...(input.prices ? { prices: input.prices } : {}) }, input.candidates ?? [], d.id as ComparableDimensionId);
    results.push(result);
    if (result.alternatives.length > 0) {
      alternative = result.alternatives[0];
      break;
    }
  }
  if (alternative) lines.push(`Alternativa tra i tuoi prodotti: ${alternative.explanation}`);

  let alternativeReason: NoAlternativeReason | undefined;
  let alternativeReasonText: string | undefined;
  if (!alternative) {
    if (ranked.length === 0) {
      alternativeReason = "nothing_to_improve";
      alternativeReasonText = "Su nessuna dimensione confrontabile il prodotto risulta intermedio o sfavorevole: non cerco alternative.";
    } else {
      const chosen = results.find((r) => r.emptyReason === "none_better") ?? results[0];
      alternativeReason = chosen?.emptyReason;
      alternativeReasonText = chosen?.emptyReasonText;
    }
  }

  return {
    headline: `${productLabel(input.product)}: ${assessment.summary.text}`,
    assessment,
    personal,
    ...(pantryLine ? { pantryLine } : {}),
    alternative,
    ...(alternativeReason ? { alternativeReason } : {}),
    ...(alternativeReasonText ? { alternativeReasonText } : {}),
    lines,
  };
}

const MATCH_TEXT: Readonly<Record<PantryMatchBy, string>> = {
  barcode: "con questo codice",
  name: "con un nome simile",
  category: "della stessa categoria",
};

function pantryText(p: PantryStock): string {
  const amount = p.amount !== undefined && p.unit ? ` (${fmt(p.amount, 1)} ${p.unit})` : "";
  if (p.has) {
    if (p.matchedBy === undefined || p.matchedBy === "barcode") return `Ne hai già in casa${amount}.`;
    const what = p.matchLabel ? `: ${p.matchLabel}` : "";
    return `In casa hai un prodotto ${MATCH_TEXT[p.matchedBy]}${what}${amount}. Non è detto che sia lo stesso.`;
  }
  const searched = p.searchedBy ?? ["barcode"];
  if (searched.length === 1 && searched[0] === "barcode") return "Nessuna confezione con questo codice in casa.";
  const how = searched.map((x) => (x === "barcode" ? "per codice" : x === "name" ? "per nome" : "per categoria")).join(", ");
  return `Non ne hai in casa (cercato ${how}).`;
}
