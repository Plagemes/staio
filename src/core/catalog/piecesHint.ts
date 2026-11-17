// Pezzi dentro la confezione, ricavati da ciò che Open Food Facts dichiara. Sempre una proposta.
import type { BaseUnit, PackageQuantity, PiecesHint, ServingSize } from "./types";

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;
const MAX_SERVING_PIECES = 12;

export interface PackagingPart {
  count: number;
  each: number;
  unit: BaseUnit;
}

/**
 * Ordine di fiducia: la scritta della confezione («2 x 100 g»), poi i singoli imballaggi dichiarati, poi la porzione.
 * La porzione conta solo se divide esattamente la confezione: 200 g con porzione da 100 g sono 2 pezzi, 170 g no.
 */
export function piecesHintFrom(
  quantity: PackageQuantity | undefined,
  serving: ServingSize | undefined,
  packagings: readonly PackagingPart[] = [],
): PiecesHint | undefined {
  if (!quantity || quantity.value === undefined || quantity.unit === undefined || quantity.unit === "pz") return undefined;
  const { value: total, unit } = quantity;

  if (quantity.count !== undefined && quantity.count >= 2) {
    return { count: quantity.count, each: Math.round((total / quantity.count) * 1000) / 1000, source: "label" };
  }
  for (const p of packagings) {
    if (p.unit === unit && p.count >= 2 && Math.abs(p.count * p.each - total) <= Math.max(total * 0.01, 0.5)) {
      return { count: p.count, each: p.each, source: "packagings" };
    }
  }
  if (serving && serving.unit === unit && serving.value > 0) {
    const count = total / serving.value;
    if (isWhole(count) && count >= 2 && count <= MAX_SERVING_PIECES) {
      return { count: Math.round(count), each: serving.value, source: "serving" };
    }
  }
  return undefined;
}
