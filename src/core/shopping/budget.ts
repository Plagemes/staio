// Tetto di spesa: quali voci ridurre o togliere per rientrarci, dalle più deboli. Mai in silenzio.
import { InvalidShoppingInputError, cmp, round9, type ShoppingLine } from "./common";
import { findUsablePrice, type PriceAgeOptions, type PriceBook } from "./prices";
import type { ReasonKind } from "./list";

export interface BudgetLine extends ShoppingLine {
  /** Priorità 0-1: le più basse si tagliano per prime. */
  priority: number;
  /** Fino a qui si può ridurre senza perdere ciò che la ragione richiede; assente = non riducibile. */
  essentialQuantity?: number;
  reasons?: ReadonlyArray<{ kind: ReasonKind }>;
}

export interface BudgetAdjustment {
  itemId: string;
  action: "reduce" | "remove";
  fromQuantity: number;
  toQuantity: number;
  savedCents: number;
  priority: number;
  reasonKinds: ReasonKind[];
}

export interface BudgetOptions extends PriceAgeOptions {
  /** Calcola i costi con i prezzi di un solo negozio; assente = ultimo prezzo osservato ovunque. */
  store?: string;
}

export interface BudgetResult<T extends BudgetLine> {
  capCents: number;
  totalBeforeCents: number;
  totalAfterCents: number;
  /** Voci rimaste, con le quantità eventualmente ridotte, nell'ordine di ingresso. */
  items: T[];
  adjustments: BudgetAdjustment[];
  /** Voci senza prezzo: non pesano sul tetto e non si possono tagliare per risparmiare. */
  unpricedItemIds: string[];
  /** Tra le voci senza prezzo: quelle con soli prezzi oltre `maxAgeDays`, non usati. */
  tooOldItemIds: string[];
  /** Voci il cui prezzo usato è più vecchio di `staleAfterDays`: il costo è meno affidabile. */
  staleItemIds: string[];
}

/**
 * Porta il costo stimato sotto `capCents`. Prima riduce le voci (dalle più deboli) fino al loro
 * minimo essenziale, poi, se serve ancora, toglie le voci intere dalle più deboli. Ogni intervento
 * è elencato in `adjustments`.
 */
export function applyBudget<T extends BudgetLine>(
  lines: readonly T[],
  book: PriceBook,
  capCents: number,
  options: BudgetOptions = {},
): BudgetResult<T> {
  if (!Number.isFinite(capCents) || capCents < 0) {
    throw new InvalidShoppingInputError("applyBudget: il tetto deve essere un numero non negativo");
  }
  const rate = new Map<string, number>();
  const stale: string[] = [];
  const tooOld: string[] = [];
  for (const l of lines) {
    const q = { key: l.key, barcode: l.barcode, unit: l.unit, store: options.store };
    const u = findUsablePrice(book, q, options);
    if (u) {
      rate.set(l.id, u.series.last.centsPerBase);
      if (u.stale) stale.push(l.id);
    } else if (findUsablePrice(book, q, {})) {
      tooOld.push(l.id);
    }
  }
  const costOf = (id: string, qty: number): number => {
    const r = rate.get(id);
    return r === undefined ? 0 : Math.round(round9(r * qty));
  };
  const qty = new Map(lines.map((l) => [l.id, l.quantity]));
  const total = () => lines.reduce((s, l) => s + costOf(l.id, qty.get(l.id) ?? 0), 0);
  const totalBefore = total();

  // Dal più debole: priorità bassa, poi costo alto (risparmia di più), poi id.
  const weakFirst = lines
    .filter((l) => rate.has(l.id))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        costOf(b.id, b.quantity) - costOf(a.id, a.quantity) ||
        cmp(a.id, b.id),
    );

  // Fase 1: riduzioni fino al minimo essenziale, solo di quanto serve.
  for (const l of weakFirst) {
    const over = total() - capCents;
    if (over <= 0) break;
    const essential = l.essentialQuantity;
    const current = qty.get(l.id) ?? 0;
    if (essential === undefined || !(essential > 0) || !(essential < current)) continue;
    const r = rate.get(l.id) as number;
    const target = r > 0 ? Math.max(essential, Math.ceil(current - over / r)) : essential;
    if (target < current) qty.set(l.id, target);
  }
  // Fase 2: voci tolte, dalle più deboli.
  for (const l of weakFirst) {
    if (total() - capCents <= 0) break;
    if ((qty.get(l.id) ?? 0) > 0) qty.set(l.id, 0);
  }

  const adjustments: BudgetAdjustment[] = [];
  for (const l of weakFirst) {
    const to = qty.get(l.id) ?? 0;
    if (to === l.quantity) continue;
    adjustments.push({
      itemId: l.id,
      action: to === 0 ? "remove" : "reduce",
      fromQuantity: l.quantity,
      toQuantity: to,
      savedCents: costOf(l.id, l.quantity) - costOf(l.id, to),
      priority: l.priority,
      reasonKinds: (l.reasons ?? []).map((r) => r.kind),
    });
  }
  const totalAfter = total();
  return {
    capCents,
    totalBeforeCents: totalBefore,
    totalAfterCents: totalAfter,
    items: lines
      .filter((l) => (qty.get(l.id) ?? 0) > 0)
      .map((l) => ({ ...l, quantity: qty.get(l.id) as number })),
    adjustments,
    unpricedItemIds: lines.filter((l) => !rate.has(l.id)).map((l) => l.id),
    tooOldItemIds: tooOld,
    staleItemIds: stale,
  };
}
