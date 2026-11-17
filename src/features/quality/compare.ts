// Confronto fianco a fianco dei prodotti letti nella sessione: una riga per dimensione, una colonna
// per prodotto, ogni cella con il suo esito. Nessun totale e nessuna classifica. Logica pura.

import type { Product } from "@/core/catalog";
import type { Dimension, DimensionId, Outcome, QualityAssessment } from "@/core/quality";
import { num } from "./texts";

export interface CompareCell {
  outcome: Outcome;
  /** `descriptive`: solo valori, senza giudizio (per esempio zero additivi dichiarati). */
  kind: Dimension["kind"];
  /** Valore da mostrare accanto all'esito; vuoto se il dato manca. */
  text: string;
}

export interface CompareRow {
  id: DimensionId;
  label: string;
  kind: Dimension["kind"];
  cells: CompareCell[];
}

export interface CompareTable {
  products: { barcode: string; name: string }[];
  rows: CompareRow[];
}

export const COMPARE_MAX = 4;

function cellText(d: Dimension): string {
  switch (d.id) {
    case "fat":
    case "saturatedFat":
    case "sugars":
    case "salt":
      return d.value === undefined ? "" : `${num(d.value, 2)} g / ${d.per === "100ml" ? "100 ml" : "100 g"}`;
    case "nutriScore":
      return d.grade === undefined ? "" : d.grade.toUpperCase();
    case "nova":
      return d.group === undefined ? "" : `NOVA ${d.group}`;
    case "additives":
      return d.count === undefined ? "" : `${d.count} ${d.count === 1 ? "additivo" : "additivi"}`;
    case "nutrientDensity": {
      const parts: string[] = [];
      if (d.proteinGPer100Kcal !== undefined) parts.push(`${num(d.proteinGPer100Kcal, 2)} g proteine`);
      if (d.fiberGPer100Kcal !== undefined) parts.push(`${num(d.fiberGPer100Kcal, 2)} g fibre`);
      return parts.length > 0 ? `${parts.join(", ")} / 100 kcal` : "";
    }
  }
}

export function compareTable(items: readonly { product: Product; assessment: QualityAssessment }[]): CompareTable {
  const first = items[0]?.assessment.dimensions ?? [];
  const rows: CompareRow[] = first.map((d) => ({
    id: d.id,
    label: d.label,
    kind: d.kind,
    cells: items.map(({ assessment }) => {
      const other = assessment.dimensions.find((x) => x.id === d.id);
      return other
        ? { outcome: other.outcome, kind: other.kind, text: cellText(other) }
        : { outcome: "not_assessable" as const, kind: d.kind, text: "" };
    }),
  }));
  return {
    products: items.map(({ product }) => ({ barcode: product.barcode, name: product.name ?? product.barcode })),
    rows,
  };
}
