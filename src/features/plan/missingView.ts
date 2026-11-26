// «Che cosa manca» di un momento del piano, a parole. I conti li fa `missingFor` (core/plan/missing.ts): qui solo la
// dispensa nella forma che serve e i testi. Logica pura.
import type { Lot } from "@/core/ledger";
import type { MissingLine, MissingResult, QuantityUnit, StockLine } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import { stockFromLots } from "@/core/recipes";
import { formatQuantity } from "@/core/units";

/** La dispensa per nome e unità, dai lotti attivi. */
export function stockLines(lots: readonly Lot[]): StockLine[] {
  const isBase = (unit: string): unit is QuantityUnit => unit === "g" || unit === "ml" || unit === "pz";
  return stockFromLots(lots).flatMap((s) => (isBase(s.quantity.unit) ? [{ name: s.name ?? s.ref, unit: s.quantity.unit, quantity: s.quantity.value }] : []));
}

/** Le porzioni ancora pronte di una preparazione, dal suo lotto. */
export function portionsLeftOf(preps: readonly PrepRecord[], lots: readonly Lot[]): (prepId: string) => number {
  return (prepId) => {
    const prep = preps.find((p) => p.prepId === prepId);
    return prep ? (lots.find((l) => l.lotId === prep.batchLotId)?.remaining ?? 0) : 0;
  };
}

const SHOWN_NAMES = 3;

/** «Manca: passata, basilico», «Hai tutto in casa»; con ricette sparite e niente di certo, lo dice. */
export function missingSummary(result: Pick<MissingResult, "lines" | "unresolved">): string {
  if (result.lines.length > 0) {
    const names = result.lines.map((l) => l.name);
    const more = names.length - SHOWN_NAMES;
    return `Manca: ${names.slice(0, SHOWN_NAMES).join(", ")}${more > 0 ? ` e altri ${more}` : ""}`;
  }
  return result.unresolved.length > 0 ? "Non so che cosa serve" : "Hai tutto in casa";
}

/** «passata · servono 400 g, ne hai 0». */
export function missingLineText(line: Pick<MissingLine, "name" | "unit" | "needed" | "have">): string {
  const have = line.have > 0 ? formatQuantity({ value: line.have, unit: line.unit }) : "0";
  return `${line.name} · servono ${formatQuantity({ value: line.needed, unit: line.unit })}, ne hai ${have}`;
}

/** «Hai già: pasta, olio.», o niente se la dispensa non copre nulla. */
export function coveredText(result: Pick<MissingResult, "covered">): string | undefined {
  if (result.covered.length === 0) return undefined;
  return `Hai già: ${[...new Set(result.covered.map((l) => l.name))].join(", ")}.`;
}

/** Il testo per una ricetta o una preparazione che non si trova più. */
export const UNRESOLVED_TEXT = "Non trovo più una ricetta o una preparazione del piano: non so che cosa serve.";

/** «Aggiunte alla spesa: 3 voci.» */
export function listedText(count: number): string {
  return count === 1 ? "Aggiunta alla spesa: 1 voce." : `Aggiunte alla spesa: ${count} voci.`;
}
