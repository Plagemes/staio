// Il risolutore delle voci: prodotto letto dal codice a barre, poi scelta manuale ricordata, poi tabella.
import type { Product } from "@/core/catalog";
import type { Lot } from "@/core/ledger";
import {
  compositionFromFood,
  compositionFromProduct,
  createResolver,
  normalizeName,
  type CompositionResolver,
  type FoodComposition,
  type ResolvedComposition,
} from "@/core/nutrition";

/** Scelte manuali: nome normalizzato della voce -> id dell'alimento nella tabella. */
export type FoodOverrides = Record<string, string>;
export const OVERRIDES_SETTING_KEY = "foodOverrides";

export function isFoodOverrides(value: unknown): value is FoodOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
}

/** Chiave con cui si ricorda una scelta: il nome senza maiuscole, accenti, quantità e marche. */
export const overrideKeyOf = (name: string): string => normalizeName(name);

/** Lotto -> codice a barre, dal campo `barcode` del lotto (mai dal testo di una nota). */
export function barcodesOfLots(lots: readonly Lot[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const lot of lots) if (lot.barcode) out.set(lot.lotId, lot.barcode);
  return out;
}

export interface ResolverInputs {
  foods: readonly FoodComposition[];
  products: ReadonlyMap<string, Product>;
  /** Codice a barre di ogni lotto che ne ha uno (`barcodesOfLots`). */
  barcodes: ReadonlyMap<string, string>;
  overrides: FoodOverrides;
}

/**
 * Ordine: valori d'etichetta del prodotto (collegato al lotto dal suo campo `barcode`, o con il codice come
 * riferimento), poi la scelta manuale ricordata per quel nome, poi la tabella per somiglianza di nome.
 * Un nome ambiguo o troppo diverso non dà alcuna composizione: la voce resta non riconosciuta.
 */
export function buildResolver(inputs: ResolverInputs): CompositionResolver {
  const foodsById = new Map(inputs.foods.map((f) => [f.id, f]));
  const table = createResolver({ foods: inputs.foods, productByRef: (ref) => inputs.products.get(ref) });

  const fromOverride = (name: string): ResolvedComposition | undefined => {
    const id = inputs.overrides[overrideKeyOf(name)];
    const food = id !== undefined ? foodsById.get(id) : undefined;
    return food ? compositionFromFood(food) : undefined;
  };

  return (subject) => {
    if (subject.kind === "pantry") {
      const barcode = inputs.barcodes.get(subject.lotId);
      const product = barcode ? inputs.products.get(barcode) : undefined;
      const label = product ? compositionFromProduct(product) : undefined;
      if (label) return label;
      return fromOverride(subject.productRef) ?? table(subject);
    }
    return fromOverride(subject.name) ?? table(subject);
  };
}
