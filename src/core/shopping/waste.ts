// Spreco per prodotto: quanto e perché è stato buttato, e il segnale "formato troppo grande".
import type { Certainty, DiscardReason, PantryState, Unit } from "../ledger";
import { DISCARD_REASONS, worseCertainty } from "../ledger";
import {
  buildStreams,
  cmp,
  median,
  niceRound,
  round9,
  roundTo,
  type Stream,
} from "./common";

export interface WasteOptions {
  /** Lotti chiusi minimi di un formato per giudicarlo. Default 3. */
  minLots?: number;
  /** Quota di un lotto persa (buttata o scaduta) da cui conta come "con perdita". Default 0.25. */
  lossThreshold?: number;
  /** Quota di lotti con perdita di un formato che rende il segnale ripetuto. Default 0.5. */
  repeatShare?: number;
  /** Lotti con perdita minimi. Default 2. */
  minRepeats?: number;
}

export interface WasteByReasonEntry {
  reason: DiscardReason;
  quantity: number;
  events: number;
}

export interface FormatWaste {
  /** Quantità del lotto acquistato (il "formato"). */
  size: number;
  /** Lotti chiusi: finiti oppure scaduti con avanzo. */
  closedLots: number;
  lotsWithLoss: number;
  /** Quota della quantità persa sul totale acquistato in quel formato. */
  lostShare: number;
  /** Mediana di quanto è stato effettivamente usato (consumato o regalato) per lotto. */
  typicalUsed: number;
}

export interface FormatTooBig {
  size: number;
  closedLots: number;
  lotsWithLoss: number;
  lostShare: number;
  typicalUsed: number;
  /** Formato massimo ragionevole, dalla mediana dell'usato; `null` se non ricavabile. */
  suggestedMaxSize: number | null;
  certainty: Certainty;
}

export interface ProductWaste {
  id: string;
  key: string;
  name: string;
  unit: Unit;
  /** Quantità entrata (tutti i lotti). */
  purchased: number;
  /** Buttata + rimasta in lotti già scaduti. */
  wasted: number;
  discarded: number;
  expiredUnused: number;
  /** `null` se non è entrato nulla. */
  wasteShare: number | null;
  /** Lotti chiusi sufficienti perché la quota sia indicativa. */
  shareReliable: boolean;
  closedLots: number;
  byReason: WasteByReasonEntry[];
  discardEvents: number;
  /** Costo stimato della parte persa, solo lotti con prezzo. */
  costCents: number;
  lotsWithoutPrice: number;
  formats: FormatWaste[];
  formatSignals: FormatTooBig[];
  certainty: Certainty;
}

function analyze(
  stream: Stream,
  today: string,
  o: Required<WasteOptions>,
): ProductWaste {
  let purchased = 0;
  let discarded = 0;
  let expiredUnused = 0;
  let closedLots = 0;
  let cost = 0;
  let lotsWithoutPrice = 0;
  let discardEvents = 0;
  let certainty: Certainty = "measured";
  const reasons = new Map<DiscardReason, WasteByReasonEntry>();
  const formats = new Map<number, { initial: number; lost: number; withLoss: number; used: number[] }>();

  for (const lot of stream.lots) {
    purchased = round9(purchased + lot.initial);
    const expired =
      lot.status === "active" &&
      lot.expiry !== undefined &&
      lot.expiry.date < today &&
      lot.remaining > 0;
    const unused = expired ? lot.remaining : 0;
    const lost = Math.min(lot.initial, round9(lot.discarded + unused));
    discarded = round9(discarded + lot.discarded);
    expiredUnused = round9(expiredUnused + unused);
    for (const h of lot.history) {
      if (h.type !== "discard" || h.reason === undefined) continue;
      const amount = -(h.quantityDelta ?? 0);
      if (!(amount > 0)) continue;
      const r = reasons.get(h.reason) ?? { reason: h.reason, quantity: 0, events: 0 };
      r.quantity = round9(r.quantity + amount);
      r.events += 1;
      reasons.set(h.reason, r);
      discardEvents += 1;
    }
    if (lost > 0) {
      if (lot.priceCents === undefined) {
        lotsWithoutPrice += 1;
      } else {
        cost += (lot.priceCents * lost) / lot.initial;
        certainty = worseCertainty(certainty, lot.priceCertainty ?? "estimated");
      }
    }
    const closed = lot.status === "finished" || expired;
    if (closed) closedLots += 1;
    if (closed && lot.origin === "purchase") {
      const f = formats.get(lot.initial) ?? { initial: 0, lost: 0, withLoss: 0, used: [] };
      f.initial += lot.initial;
      f.lost += lost;
      if (lost / lot.initial >= o.lossThreshold) f.withLoss += 1;
      f.used.push(lot.consumed + lot.gifted);
      formats.set(lot.initial, f);
    }
  }

  const formatList: FormatWaste[] = [...formats.entries()]
    .map(([size, f]) => ({
      size,
      closedLots: f.used.length,
      lotsWithLoss: f.withLoss,
      lostShare: roundTo(f.lost / f.initial, 3),
      typicalUsed: median(f.used) ?? 0,
    }))
    .sort((a, b) => a.size - b.size);

  const signals: FormatTooBig[] = formatList
    .filter(
      (f) =>
        f.closedLots >= o.minLots &&
        f.lotsWithLoss >= o.minRepeats &&
        f.lotsWithLoss / f.closedLots >= o.repeatShare,
    )
    .map((f) => ({
      size: f.size,
      closedLots: f.closedLots,
      lotsWithLoss: f.lotsWithLoss,
      lostShare: f.lostShare,
      typicalUsed: f.typicalUsed,
      suggestedMaxSize:
        f.typicalUsed > 0 ? Math.min(f.size, niceRound(f.typicalUsed, stream.unit, "up")) : null,
      certainty: "estimated" as const,
    }));

  const wasted = round9(discarded + expiredUnused);
  return {
    id: stream.id,
    key: stream.key,
    name: stream.name,
    unit: stream.unit,
    purchased,
    wasted,
    discarded,
    expiredUnused,
    wasteShare: purchased > 0 ? roundTo(Math.min(1, wasted / purchased), 3) : null,
    shareReliable: closedLots >= o.minLots,
    closedLots,
    byReason: [...reasons.values()].sort(
      (a, b) => DISCARD_REASONS.indexOf(a.reason) - DISCARD_REASONS.indexOf(b.reason),
    ),
    discardEvents,
    costCents: Math.round(cost),
    lotsWithoutPrice,
    formats: formatList,
    formatSignals: signals,
    certainty,
  };
}

/**
 * Spreco per prodotto. Un lotto è "chiuso" se finito o scaduto con avanzo; la quota persa conta
 * lo scartato più l'avanzo dei lotti già scaduti non ancora buttati. Il segnale "formato troppo
 * grande" scatta quando, per lo stesso formato acquistato, una quota rilevante dei lotti chiusi
 * ne perde una parte significativa, ripetutamente.
 */
export function wasteByProduct(
  state: PantryState,
  today: string,
  options: WasteOptions = {},
): ProductWaste[] {
  const o: Required<WasteOptions> = {
    minLots: options.minLots ?? 3,
    lossThreshold: options.lossThreshold ?? 0.25,
    repeatShare: options.repeatShare ?? 0.5,
    minRepeats: options.minRepeats ?? 2,
  };
  return buildStreams(state, today)
    .map((s) => analyze(s, today, o))
    .sort((a, b) => cmp(a.key, b.key) || cmp(a.unit, b.unit));
}
