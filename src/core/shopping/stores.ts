// Scelta per negozio: costo stimato comprando tutto in un negozio, o diviso su due negozi.
// Solo prezzi osservati: le voci senza prezzo non sono stimate, sono contate.
import type { Certainty } from "../ledger";
import { cmp, normalizeName, round9, type ShoppingLine } from "./common";
import { findUsablePrice, type PriceAgeOptions, type PriceBook } from "./prices";

export interface StoreCost {
  store: string;
  storeKey: string;
  /** Voci con un prezzo osservato in questo negozio. */
  pricedItemIds: string[];
  /** Voci con prezzo altrove ma mai osservato qui: non incluse nel costo. */
  missingItemIds: string[];
  /** Somma dei costi delle voci con prezzo osservato qui (ultimo prezzo), in centesimi. */
  costCents: number;
  /** Voci di questo negozio il cui prezzo è vecchio (oltre `staleAfterDays`). */
  staleItemIds: string[];
}

export interface SplitAssignment {
  itemId: string;
  store: string;
  costCents: number;
}

export interface StoreSplit {
  stores: [string, string];
  assignments: SplitAssignment[];
  costCents: number;
  /** Voci con prezzo osservato, ma in nessuno dei due negozi. */
  uncoveredItemIds: string[];
  /** Negozio unico con cui si confronta: ha un prezzo osservato per tutte le voci della divisione. */
  baselineStore: string;
  baselineCents: number;
  /** Risparmio dichiarato rispetto al negozio unico di confronto. */
  savingsCents: number;
  /** Risparmio in quota del costo del negozio unico di confronto (0-1). */
  savingsShare: number;
  /** Voci assegnate con un prezzo vecchio. */
  staleItemIds: string[];
}

export type NoSplitReason =
  | "fewer_than_two_stores"
  | "no_saving"
  /** C'è un risparmio, ma sotto la soglia: la differenza non giustifica due negozi. */
  | "below_threshold"
  | "no_comparable_single_store";

export interface StoreComparison {
  /** Voci con almeno un prezzo osservato. */
  pricedCount: number;
  /** Voci senza alcun prezzo osservato: restano fuori da ogni stima. */
  unpricedItemIds: string[];
  unpricedCount: number;
  /** Tra le voci senza prezzo usabile: quelle che hanno solo prezzi oltre `maxAgeDays`. */
  tooOldItemIds: string[];
  /** Voci con prezzo il cui ultimo prezzo osservato (in qualunque negozio) è vecchio. */
  staleItemIds: string[];
  staleCount: number;
  singles: StoreCost[];
  /** Negozio con meno voci mancanti e poi costo minore. */
  bestSingle: StoreCost | null;
  split: StoreSplit | null;
  /** Migliore divisione sotto soglia, per dire di quanto è la differenza; `null` se non c'è. */
  belowThresholdSplit: StoreSplit | null;
  noSplitReason: NoSplitReason | null;
  certainty: Certainty;
}

interface Priced {
  cents: number;
  stale: boolean;
}
type Costs = Map<string, Map<string, Priced>>; // itemId -> storeKey -> costo

export interface CompareStoresOptions extends PriceAgeOptions {
  /** Risparmio minimo, in centesimi, perché valga la divisione. Default 200. */
  minSavingsCents?: number;
  /** Risparmio minimo in quota del costo di confronto (0-1). Default 0.05. */
  minSavingsShare?: number;
}

/**
 * Confronta i negozi per la lista data. Il costo di una voce in un negozio è la quantità per
 * l'ultimo prezzo osservato lì (per codice a barre se c'è, altrimenti per nome). Con `today`,
 * i prezzi oltre `staleAfterDays` (60) sono marcati vecchi e quelli oltre `maxAgeDays` (180) non
 * sono usati. La divisione su due negozi si propone solo se il risparmio supera sia
 * `minSavingsCents` (200) sia `minSavingsShare` (5%).
 */
export function compareStores(
  lines: readonly ShoppingLine[],
  book: PriceBook,
  options: CompareStoresOptions = {},
): StoreComparison {
  const minSavings = options.minSavingsCents ?? 200;
  const minShare = options.minSavingsShare ?? 0.05;
  const items = [...lines].sort((a, b) => cmp(a.id, b.id));
  const storeLabel = new Map<string, string>();
  for (const label of book.stores) storeLabel.set(normalizeName(label), label);
  const storeKeys = [...storeLabel.keys()].sort();

  const costs: Costs = new Map();
  const unpriced: string[] = [];
  const tooOld: string[] = [];
  const stale: string[] = [];
  for (const it of items) {
    const perStore = new Map<string, Priced>();
    for (const sk of storeKeys) {
      const u = findUsablePrice(
        book,
        { key: it.key, barcode: it.barcode, unit: it.unit, store: sk },
        options,
      );
      if (u) {
        perStore.set(sk, {
          cents: Math.round(round9(u.series.last.centsPerBase * it.quantity)),
          stale: u.stale,
        });
      }
    }
    if (perStore.size === 0) {
      unpriced.push(it.id);
      const any = findUsablePrice(book, { key: it.key, barcode: it.barcode, unit: it.unit }, {});
      if (any) tooOld.push(it.id);
    } else {
      costs.set(it.id, perStore);
      const latest = findUsablePrice(
        book,
        { key: it.key, barcode: it.barcode, unit: it.unit },
        options,
      );
      if (latest?.stale) stale.push(it.id);
    }
  }
  const pricedIds = items.filter((i) => costs.has(i.id)).map((i) => i.id);

  const singles: StoreCost[] = [];
  for (const sk of storeKeys) {
    const priced = pricedIds.filter((id) => costs.get(id)?.has(sk));
    if (priced.length === 0) continue;
    singles.push({
      store: storeLabel.get(sk) ?? sk,
      storeKey: sk,
      pricedItemIds: priced,
      missingItemIds: pricedIds.filter((id) => !costs.get(id)?.has(sk)),
      costCents: priced.reduce((s, id) => s + (costs.get(id)?.get(sk)?.cents ?? 0), 0),
      staleItemIds: priced.filter((id) => costs.get(id)?.get(sk)?.stale),
    });
  }
  const bestSingle =
    [...singles].sort(
      (a, b) =>
        a.missingItemIds.length - b.missingItemIds.length ||
        a.costCents - b.costCents ||
        cmp(a.storeKey, b.storeKey),
    )[0] ?? null;

  let split: StoreSplit | null = null;
  let belowThresholdSplit: StoreSplit | null = null;
  let noSplitReason: NoSplitReason | null = null;
  if (singles.length < 2) {
    noSplitReason = "fewer_than_two_stores";
  } else {
    let sawComparable = false;
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const a = singles[i].storeKey;
        const b = singles[j].storeKey;
        const assignments: Array<SplitAssignment & { sk: string }> = [];
        const uncovered: string[] = [];
        for (const id of pricedIds) {
          const ca = costs.get(id)?.get(a);
          const cb = costs.get(id)?.get(b);
          if (ca === undefined && cb === undefined) {
            uncovered.push(id);
            continue;
          }
          const useA = cb === undefined || (ca !== undefined && ca.cents <= cb.cents);
          const sk = useA ? a : b;
          assignments.push({
            itemId: id,
            sk,
            store: storeLabel.get(sk) ?? sk,
            costCents: (useA ? ca : cb)?.cents as number,
          });
        }
        const usesA = assignments.some((x) => x.sk === a);
        const usesB = assignments.some((x) => x.sk === b);
        if (!usesA || !usesB) {
          // Un solo negozio vince su tutto: la divisione non serve e il confronto è già onesto.
          if (assignments.length > 0) sawComparable = true;
          continue;
        }
        const covered = assignments.map((x) => x.itemId);
        // Confronto onesto: un negozio solo con un prezzo osservato per ogni voce coperta.
        let baseline: { sk: string; cents: number } | null = null;
        for (const sk of storeKeys) {
          if (!covered.every((id) => costs.get(id)?.has(sk))) continue;
          const cents = covered.reduce((s, id) => s + (costs.get(id)?.get(sk)?.cents ?? 0), 0);
          if (baseline === null || cents < baseline.cents) baseline = { sk, cents };
        }
        if (baseline === null) continue;
        sawComparable = true;
        const total = assignments.reduce((s, x) => s + x.costCents, 0);
        const savings = baseline.cents - total;
        if (savings <= 0) continue;
        const staleAssigned = assignments
          .filter((x) => costs.get(x.itemId)?.get(x.sk)?.stale)
          .map((x) => x.itemId);
        const candidate: StoreSplit = {
          stores: [storeLabel.get(a) ?? a, storeLabel.get(b) ?? b],
          assignments: assignments.map(({ itemId, store, costCents }) => ({
            itemId,
            store,
            costCents,
          })),
          costCents: total,
          uncoveredItemIds: uncovered,
          baselineStore: storeLabel.get(baseline.sk) ?? baseline.sk,
          baselineCents: baseline.cents,
          savingsCents: savings,
          savingsShare: baseline.cents > 0 ? Math.round((savings / baseline.cents) * 1e4) / 1e4 : 0,
          staleItemIds: staleAssigned,
        };
        const passes = savings >= minSavings && candidate.savingsShare >= minShare;
        const better = (cur: StoreSplit | null) =>
          cur === null ||
          savings > cur.savingsCents ||
          (savings === cur.savingsCents && uncovered.length < cur.uncoveredItemIds.length);
        if (passes) {
          if (better(split)) split = candidate;
        } else if (better(belowThresholdSplit)) {
          belowThresholdSplit = candidate;
        }
      }
    }
    if (split === null) {
      noSplitReason = belowThresholdSplit
        ? "below_threshold"
        : sawComparable
          ? "no_saving"
          : "no_comparable_single_store";
    }
  }

  return {
    pricedCount: pricedIds.length,
    unpricedItemIds: unpriced,
    unpricedCount: unpriced.length,
    tooOldItemIds: tooOld,
    staleItemIds: stale,
    staleCount: stale.length,
    singles,
    bestSingle,
    split,
    belowThresholdSplit,
    noSplitReason,
    certainty: "estimated",
  };
}
