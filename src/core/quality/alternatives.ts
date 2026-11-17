// Alternative migliori, solo tra i candidati forniti (prodotti già letti o comprati dall'utente).
// Nessun prodotto inventato: se nessun candidato è migliore e non peggiore, l'elenco è vuoto.

import type { BaseUnit, Product } from "../catalog";
import { assessProduct, dimensionOf } from "./assess";
import { fmt, isAmount, productLabel } from "./common";
import { OUTCOME_LABEL, OUTCOME_RANK, type AdditivesDimension, type Dimension, type DimensionId, type QualityAssessment } from "./types";

/** Una spesa osservata: quanto è stato pagato per quale quantità. */
export interface PriceObservation {
  totalCents: number;
  amount: number;
  unit: BaseUnit;
  store?: string;
}

export interface Candidate {
  product: Product;
  prices?: readonly PriceObservation[];
}

/** Dimensioni su cui ha senso cercare un'alternativa migliore (hanno un valore ordinabile). */
export type ComparableDimensionId = "fat" | "saturatedFat" | "sugars" | "salt" | "nutriScore" | "nova";

export const COMPARABLE_DIMENSIONS: readonly ComparableDimensionId[] = [
  "fat",
  "saturatedFat",
  "sugars",
  "salt",
  "nutriScore",
  "nova",
];

export interface UnitPrice {
  cents: number;
  per: "kg" | "l" | "pz";
  store?: string;
}

/** Una dimensione in cui il candidato è peggiore o non è confrontabile, con il motivo in italiano. */
export interface DimensionDifference {
  dimension: DimensionId;
  label: string;
  reason: string;
}

/** Differenza su una dimensione solo descrittiva (o sul solo numero di additivi): nessun giudizio. */
export interface DescriptiveDifference {
  dimension: DimensionId;
  label: string;
  text: string;
}

/**
 * Tolleranza sul peggioramento DENTRO la stessa fascia: il candidato è peggiore se il valore sale di più
 * del maggiore tra la quota relativa del valore del prodotto e il margine assoluto (grammi). È una scelta
 * di progetto per non scartare differenze irrilevanti, non una soglia di una fonte.
 */
export interface ValueTolerance {
  relative: number;
  absolute: number;
}

export const DEFAULT_VALUE_TOLERANCE: ValueTolerance = { relative: 0.1, absolute: 0.1 };

export interface AlternativeOptions {
  valueTolerance?: ValueTolerance;
  /** Restituisce anche i candidati peggiori su qualche dimensione, con l'elenco in `worseOn`. Predefinito: no. */
  allowWorse?: boolean;
}

export interface Alternative {
  product: Product;
  dimension: ComparableDimensionId;
  /** Valore del riferimento e del candidato sulla dimensione scelta, già in testo italiano. */
  before: string;
  after: string;
  /** Dimensioni con giudizio su cui il candidato è migliore (oltre a quella scelta). */
  alsoBetter: DimensionId[];
  /** Dimensioni su cui l'esito è uguale. */
  same: DimensionId[];
  /** Dimensioni che non si possono confrontare perché manca il dato nel candidato o nel riferimento. */
  notComparable: DimensionId[];
  /** Dimensioni in cui il candidato è peggiore (vuoto salvo `allowWorse`), con il motivo. Sempre popolato. */
  worseOn?: DimensionDifference[];
  /** Dimensioni non confrontabili, con il motivo. Se non è vuoto il testo non dice "senza peggiorare". Sempre popolato. */
  notComparableOn?: DimensionDifference[];
  /** Differenze descrittive (densità di nutrienti, numero di additivi senza giudizio). Sempre popolato. */
  descriptive?: DescriptiveDifference[];
  /** Miglior prezzo osservato per unità del candidato. */
  unitPrice?: UnitPrice;
  /** Differenza rispetto al prezzo per unità del riferimento, se confrontabile (centesimi per la stessa unità). */
  priceDifferenceCents?: number;
  explanation: string;
}

/**
 * Perché non c'è un'alternativa: il prodotto non ha categorie, la dimensione non è valutabile, nessun
 * candidato della stessa categoria, candidati che non sono migliori senza peggiorare altro, oppure
 * (solo nella modalità scaffale) nessuna dimensione da migliorare.
 */
export type NoAlternativeReason =
  | "no_category"
  | "not_assessable"
  | "no_candidates_in_category"
  | "none_better"
  | "nothing_to_improve";

export interface AlternativesResult {
  status: "ok" | "no_category" | "not_assessable";
  /** Presente quando lo stato non è "ok". */
  reason?: string;
  /** Presente quando l'elenco è vuoto: il motivo come valore enumerato e il suo testo in italiano. */
  emptyReason?: NoAlternativeReason;
  emptyReasonText?: string;
  referenceUnitPrice?: UnitPrice;
  alternatives: Alternative[];
}

const PER: Readonly<Record<BaseUnit, { per: UnitPrice["per"]; factor: number }>> = {
  g: { per: "kg", factor: 1000 },
  ml: { per: "l", factor: 1000 },
  pz: { per: "pz", factor: 1 },
};

/** Il prezzo per unità più basso tra le osservazioni valide, nell'unità richiesta (o nella prima trovata). */
export function bestUnitPrice(prices: readonly PriceObservation[] | undefined, per?: UnitPrice["per"]): UnitPrice | undefined {
  let best: UnitPrice | undefined;
  for (const p of prices ?? []) {
    if (!isAmount(p.totalCents) || p.totalCents <= 0 || !isAmount(p.amount) || p.amount <= 0) continue;
    const u = PER[p.unit];
    if (per !== undefined && u.per !== per) continue;
    if (per === undefined && best !== undefined && u.per !== best.per) continue;
    const cents = Math.round((p.totalCents / p.amount) * u.factor);
    if (best === undefined || cents < best.cents) best = { cents, per: u.per, ...(p.store !== undefined ? { store: p.store } : {}) };
  }
  return best;
}

/** Valore ordinabile della dimensione (più basso = meglio) e il suo testo. */
function scalar(d: Dimension | undefined): { n: number; text: string } | undefined {
  if (!d || d.outcome === "not_assessable") return undefined;
  switch (d.id) {
    case "fat":
    case "saturatedFat":
    case "sugars":
    case "salt":
      return d.value === undefined ? undefined : { n: d.value, text: `${fmt(d.value, 2)} g per ${d.per === "100ml" ? "100 ml" : "100 g"}` };
    case "nutriScore":
      return d.grade === undefined ? undefined : { n: "abcde".indexOf(d.grade), text: `Nutri-Score ${d.grade.toUpperCase()}` };
    case "nova":
      return d.group === undefined ? undefined : { n: d.group, text: `NOVA ${d.group}` };
    default:
      return undefined;
  }
}

function lastCategory(p: Product): string | undefined {
  const c = p.categories;
  return c && c.length > 0 ? c[c.length - 1] : undefined;
}

export function findAlternatives(
  reference: Candidate,
  candidates: readonly Candidate[],
  dimension: ComparableDimensionId,
  options: AlternativeOptions = {},
): AlternativesResult {
  const tolerance = options.valueTolerance ?? DEFAULT_VALUE_TOLERANCE;
  const category = lastCategory(reference.product);
  if (category === undefined) {
    const reason = "Il prodotto non ha categorie: non so tra quali prodotti cercare un'alternativa.";
    return { status: "no_category", reason, emptyReason: "no_category", emptyReasonText: reason, alternatives: [] };
  }
  const refAssessment = assessProduct(reference.product);
  const refDim = dimensionOf(refAssessment, dimension);
  const refScalar = scalar(refDim);
  if (!refDim || !refScalar) {
    const reason = `Per questo prodotto la dimensione «${refDim?.label ?? dimension}» non è valutabile: non posso dire se un altro prodotto è migliore.`;
    return { status: "not_assessable", reason, emptyReason: "not_assessable", emptyReasonText: reason, alternatives: [] };
  }
  const refPrice = bestUnitPrice(reference.prices);
  const out: Array<Alternative & { delta: number }> = [];

  for (const cand of candidates) {
    if (cand.product.barcode === reference.product.barcode) continue;
    if (!(cand.product.categories ?? []).includes(category)) continue;
    const assessment = assessProduct(cand.product);
    const candScalar = scalar(dimensionOf(assessment, dimension));
    if (!candScalar || candScalar.n >= refScalar.n) continue;

    const compared = compareOthers(refAssessment, assessment, dimension, tolerance);
    if (compared.worseOn.length > 0 && options.allowWorse !== true) continue;

    const unitPrice = bestUnitPrice(cand.prices, refPrice?.per);
    const priceDifferenceCents = refPrice && unitPrice ? unitPrice.cents - refPrice.cents : undefined;
    out.push({
      product: cand.product,
      dimension,
      before: refScalar.text,
      after: candScalar.text,
      alsoBetter: compared.better,
      same: compared.same,
      notComparable: compared.notComparable,
      worseOn: compared.worseOn,
      notComparableOn: compared.notComparableOn,
      descriptive: compared.descriptive,
      ...(unitPrice ? { unitPrice } : {}),
      ...(priceDifferenceCents !== undefined ? { priceDifferenceCents } : {}),
      explanation: explain(cand.product, refDim.label, refScalar.text, candScalar.text, compared, unitPrice, priceDifferenceCents),
      delta: refScalar.n - candScalar.n,
    });
  }

  out.sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    if (b.alsoBetter.length !== a.alsoBetter.length) return b.alsoBetter.length - a.alsoBetter.length;
    const pa = a.unitPrice?.cents ?? Infinity;
    const pb = b.unitPrice?.cents ?? Infinity;
    if (pa !== pb) return pa - pb;
    return productLabel(a.product).localeCompare(productLabel(b.product));
  });

  let empty: Pick<AlternativesResult, "emptyReason" | "emptyReasonText"> = {};
  if (out.length === 0) {
    const inCategory = candidates.some((c) => c.product.barcode !== reference.product.barcode && (c.product.categories ?? []).includes(category));
    empty = inCategory
      ? {
          emptyReason: "none_better",
          emptyReasonText: `Tra i prodotti che conosci della stessa categoria nessuno è migliore su «${refDim.label}» senza peggiorare altre dimensioni.`,
        }
      : {
          emptyReason: "no_candidates_in_category",
          emptyReasonText: "Tra i prodotti che conosci non ce n'è nessuno della stessa categoria.",
        };
  }

  return {
    status: "ok",
    ...empty,
    ...(refPrice ? { referenceUnitPrice: refPrice } : {}),
    alternatives: out.map((a) => {
      const copy: Alternative & { delta?: number } = { ...a };
      delete copy.delta;
      return copy;
    }),
  };
}

interface OthersComparison {
  better: DimensionId[];
  same: DimensionId[];
  notComparable: DimensionId[];
  worseOn: DimensionDifference[];
  notComparableOn: DimensionDifference[];
  descriptive: DescriptiveDifference[];
}

const NUTRIENT_IDS: readonly DimensionId[] = ["fat", "saturatedFat", "sugars", "salt"];

/**
 * Confronta tutte le altre dimensioni. Peggiore = fascia peggiore, oppure stessa fascia con il valore
 * salito oltre la tolleranza; per gli additivi, un additivo con giudizio ufficiale che il prodotto non ha.
 * Le dimensioni solo descrittive non danno giudizio ma le differenze sono elencate.
 */
function compareOthers(ref: QualityAssessment, cand: QualityAssessment, chosen: DimensionId, tol: ValueTolerance): OthersComparison {
  const res: OthersComparison = { better: [], same: [], notComparable: [], worseOn: [], notComparableOn: [], descriptive: [] };
  const notComparable = (d: Dimension, reason: string) => {
    res.notComparable.push(d.id);
    res.notComparableOn.push({ dimension: d.id, label: d.label, reason });
  };

  for (const r of ref.dimensions) {
    if (r.id === chosen || r.id === "nutrientDensity") continue;
    const c: Dimension | undefined = dimensionOf(cand, r.id);
    if (r.id === "additives") {
      compareAdditives(r, c?.id === "additives" ? c : undefined, res);
      continue;
    }
    if (r.kind !== "graded") continue;
    if (!c || c.outcome === "not_assessable" || r.outcome === "not_assessable") {
      const missing = r.outcome === "not_assessable" && (!c || c.outcome === "not_assessable") ? "nel prodotto e nel candidato" : r.outcome === "not_assessable" ? "nel prodotto" : "nel candidato";
      notComparable(r, `dato mancante ${missing}`);
      continue;
    }
    const sr = scalar(r);
    const sc = scalar(c);
    const diff = OUTCOME_RANK[c.outcome] - OUTCOME_RANK[r.outcome];
    const text = sr && sc ? `da ${sr.text} a ${sc.text}` : `da ${OUTCOME_LABEL[r.outcome]} a ${OUTCOME_LABEL[c.outcome]}`;
    if (diff > 0) {
      res.worseOn.push({ dimension: r.id, label: r.label, reason: `${text} (${OUTCOME_LABEL[r.outcome]} → ${OUTCOME_LABEL[c.outcome]})` });
      continue;
    }
    if (diff < 0) {
      res.better.push(r.id);
      continue;
    }
    if (sr && sc) {
      const margin = NUTRIENT_IDS.includes(r.id) ? Math.max(sr.n * tol.relative, tol.absolute) : 0;
      if (sc.n - sr.n > margin) {
        res.worseOn.push({ dimension: r.id, label: r.label, reason: `${text}, nella stessa fascia ma più alto` });
        continue;
      }
    }
    res.same.push(r.id);
  }

  const rd = ref.dimensions.find((d) => d.id === "nutrientDensity");
  const cd = cand.dimensions.find((d) => d.id === "nutrientDensity");
  if (rd?.id === "nutrientDensity" && cd?.id === "nutrientDensity") {
    const parts: string[] = [];
    if (rd.proteinGPer100Kcal !== undefined && cd.proteinGPer100Kcal !== undefined && rd.proteinGPer100Kcal !== cd.proteinGPer100Kcal) {
      parts.push(`proteine da ${fmt(rd.proteinGPer100Kcal, 2)} a ${fmt(cd.proteinGPer100Kcal, 2)} g`);
    }
    if (rd.fiberGPer100Kcal !== undefined && cd.fiberGPer100Kcal !== undefined && rd.fiberGPer100Kcal !== cd.fiberGPer100Kcal) {
      parts.push(`fibre da ${fmt(rd.fiberGPer100Kcal, 2)} a ${fmt(cd.fiberGPer100Kcal, 2)} g`);
    }
    if (parts.length > 0) {
      res.descriptive.push({ dimension: "nutrientDensity", label: rd.label, text: `${parts.join(", ")} ogni 100 kcal (solo descrittivo)` });
    }
  }
  return res;
}

function compareAdditives(r: AdditivesDimension, c: AdditivesDimension | undefined, res: OthersComparison): void {
  const flagged = (d: AdditivesDimension) => d.items.filter((i) => i.statement).map((i) => i.code);
  if (!c || c.count === undefined) {
    res.notComparable.push("additives");
    res.notComparableOn.push({ dimension: "additives", label: r.label, reason: "il candidato non riporta gli additivi" });
    return;
  }
  const refFlagged = new Set(flagged(r));
  const added = flagged(c).filter((code) => !refFlagged.has(code));
  if (added.length > 0) {
    res.worseOn.push({ dimension: "additives", label: r.label, reason: `aggiunge ${added.join(", ")}, con dichiarazione ufficiale (vedi la dimensione additivi)` });
    return;
  }
  if (r.count === undefined) {
    res.notComparable.push("additives");
    res.notComparableOn.push({ dimension: "additives", label: r.label, reason: "il prodotto non riporta gli additivi" });
    return;
  }
  const candFlagged = new Set(flagged(c));
  (flagged(r).some((code) => !candFlagged.has(code)) ? res.better : res.same).push("additives");
  if (c.count !== r.count) {
    res.descriptive.push({ dimension: "additives", label: r.label, text: `additivi dichiarati da ${r.count} a ${c.count} (solo presenza, senza giudizio)` });
  }
}

function explain(
  product: Product,
  label: string,
  before: string,
  after: string,
  c: OthersComparison,
  price: UnitPrice | undefined,
  diff: number | undefined,
): string {
  let text = `${productLabel(product)}: ${label.toLowerCase()} da ${before} a ${after}`;
  if (c.worseOn.length === 0 && c.notComparableOn.length === 0) {
    text += ", senza peggiorare le altre dimensioni.";
  } else {
    text += ".";
    if (c.worseOn.length > 0) text += ` Peggiora: ${c.worseOn.map((d) => `${d.label.toLowerCase()} (${d.reason})`).join("; ")}.`;
    if (c.notComparableOn.length > 0) {
      text += ` Non confrontabile: ${c.notComparableOn.map((d) => `${d.label.toLowerCase()} (${d.reason})`).join("; ")}; non posso dire che non peggiori.`;
    }
  }
  if (c.descriptive.length > 0) text += ` Solo descrittivo: ${c.descriptive.map((d) => `${d.label.toLowerCase()}, ${d.text}`).join("; ")}.`;
  if (price) {
    const euro = `${fmt(price.cents / 100, 2)} € al ${price.per === "pz" ? "pezzo" : price.per}${price.store ? ` (${price.store})` : ""}`;
    text += ` Prezzo osservato: ${euro}`;
    if (diff !== undefined) text += diff === 0 ? ", uguale a quello del prodotto." : `, ${fmt(Math.abs(diff) / 100, 2)} € ${diff < 0 ? "in meno" : "in più"} del prodotto.`;
    else text += ".";
  }
  return text;
}
