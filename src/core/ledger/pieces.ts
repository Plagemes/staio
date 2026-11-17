// Pezzi dentro una confezione: un modo di leggere la quantità del lotto, mai un'altra unità che la contraddica.
import type { Lot } from "./derive";

/** Differenza ammessa tra `count × each` e la quantità della confezione, in proporzione (e almeno mezza unità). */
export const PIECES_TOLERANCE = 0.02;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `count × each` riproduce la quantità della confezione, entro la tolleranza. */
export function piecesAgree(total: number, count: number, each: number): boolean {
  return Math.abs(count * each - total) <= Math.max(total * PIECES_TOLERANCE, 0.5);
}

export interface PiecesView {
  count: number;
  /** Quantità di un pezzo nell'unità del lotto: quella dichiarata se torna, altrimenti quantità ÷ pezzi. */
  each: number;
  name?: string;
  /** Falso se i pezzi dichiarati non tornano con la quantità: allora vale la quantità e i pezzi sono una stima. */
  agrees: boolean;
}

/** I pezzi di un lotto, o undefined se non ne ha (o se il lotto si conta già a pezzi). */
export function piecesOf(lot: Pick<Lot, "pieces" | "initial" | "unit">): PiecesView | undefined {
  const p = lot.pieces;
  if (!p || lot.unit === "pz" || !(p.count >= 2) || !(p.each > 0) || !(lot.initial > 0)) return undefined;
  const agrees = piecesAgree(lot.initial, p.count, p.each);
  return { count: p.count, each: agrees ? p.each : round2(lot.initial / p.count), ...(p.name ? { name: p.name } : {}), agrees };
}

/** Quanti pezzi restano (anche frazioni: mezzo pezzo), arrotondato al centesimo; undefined se il lotto non ha pezzi. */
export function piecesLeft(lot: Pick<Lot, "pieces" | "initial" | "unit" | "remaining">): number | undefined {
  const view = piecesOf(lot);
  return view ? round2(lot.remaining / view.each) : undefined;
}
