// Alternative per la scheda di un prodotto: per ogni dimensione ordinabile su cui il prodotto non è
// favorevole si cercano candidati migliori tra i prodotti noti. Logica pura, sopra `findAlternatives`.

import {
  COMPARABLE_DIMENSIONS,
  assessProduct,
  dimensionOf,
  findAlternatives,
  type Alternative,
  type AlternativesResult,
  type Candidate,
  type ComparableDimensionId,
  type UnitPrice,
} from "@/core/quality";

export interface AlternativeGroup {
  dimension: ComparableDimensionId;
  label: string;
  alternatives: Alternative[];
}

export interface AlternativesView {
  /** `no_category`: il prodotto non ha categorie; `none`: nessun candidato migliore; `ok`: almeno una. */
  status: "ok" | "none" | "no_category" | "nothing_to_improve";
  /** Motivo in italiano, preso dalla logica di qualità, quando non ci sono alternative. */
  reason?: string;
  referenceUnitPrice?: UnitPrice;
  groups: AlternativeGroup[];
}

export function alternativesView(reference: Candidate, candidates: readonly Candidate[]): AlternativesView {
  const assessment = assessProduct(reference.product);
  const targets = COMPARABLE_DIMENSIONS.filter((id) => {
    const d = dimensionOf(assessment, id);
    return d !== undefined && (d.outcome === "intermediate" || d.outcome === "unfavorable");
  });
  if (targets.length === 0) {
    return { status: "nothing_to_improve", reason: "Su nessuna dimensione confrontabile il prodotto risulta intermedio o sfavorevole: non cerco alternative.", groups: [] };
  }
  const groups: AlternativeGroup[] = [];
  const results: AlternativesResult[] = [];
  let referenceUnitPrice: UnitPrice | undefined;
  for (const id of targets) {
    const result = findAlternatives(reference, candidates, id);
    if (result.emptyReason === "no_category") {
      return { status: "no_category", ...(result.emptyReasonText ? { reason: result.emptyReasonText } : {}), groups: [] };
    }
    results.push(result);
    if (result.referenceUnitPrice) referenceUnitPrice = result.referenceUnitPrice;
    if (result.alternatives.length > 0) {
      groups.push({ dimension: id, label: dimensionOf(assessment, id)?.label ?? id, alternatives: result.alternatives });
    }
  }
  const why = results.find((r) => r.emptyReason === "none_better") ?? results[0];
  return {
    status: groups.length > 0 ? "ok" : "none",
    ...(groups.length === 0 && why?.emptyReasonText ? { reason: why.emptyReasonText } : {}),
    ...(referenceUnitPrice ? { referenceUnitPrice } : {}),
    groups,
  };
}
