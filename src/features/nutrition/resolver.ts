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
  type IntakeSubject,
  type ResolvedComposition,
  type ResolverResult,
} from "@/core/nutrition";
import type { PrepRecord } from "@/core/prep";
import { composePrepPortion, type PrepPortionInfo } from "./prepPortion";

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
  /** Preparazioni per lotto di porzioni (`batchLotId`): le loro porzioni si calcolano dagli ingredienti. */
  preps?: ReadonlyMap<string, PrepRecord>;
}

/**
 * Ordine: per il lotto di porzioni di una preparazione, i nutrienti calcolati dagli ingredienti; poi i valori
 * d'etichetta del prodotto (collegato al lotto dal suo campo `barcode`, o con il codice come riferimento), poi la
 * scelta manuale ricordata per quel nome, poi la tabella per somiglianza di nome. Una voce con un alimento scelto
 * (`foodId`) non passa dal nome né dalla scelta ricordata. Un nome ambiguo o troppo diverso non dà alcuna
 * composizione: la voce resta non riconosciuta.
 */
export function buildResolverWithInfo(inputs: ResolverInputs): {
  resolve: CompositionResolver;
  /** Che cosa si sa delle porzioni di preparazione risolte finora, per `ref` (`prep:<id>`). */
  prepInfo: ReadonlyMap<string, PrepPortionInfo>;
} {
  const foodsById = new Map(inputs.foods.map((f) => [f.id, f]));
  const table = createResolver({ foods: inputs.foods, productByRef: (ref) => inputs.products.get(ref) });
  const infos = new Map<string, PrepPortionInfo>();
  const cached = new Map<string, ResolvedComposition | undefined>();

  const fromOverride = (name: string): ResolvedComposition | undefined => {
    const id = inputs.overrides[overrideKeyOf(name)];
    const food = id !== undefined ? foodsById.get(id) : undefined;
    return food ? compositionFromFood(food) : undefined;
  };

  /** `stack`: le preparazioni in corso di calcolo, per non girare in tondo se una usa le porzioni di sé stessa. */
  function resolve(subject: IntakeSubject, stack: ReadonlySet<string> = new Set()): ResolverResult {
    if (subject.kind === "pantry") {
      const prep = inputs.preps?.get(subject.lotId);
      if (prep && !stack.has(prep.prepId)) {
        let composition: ResolvedComposition | undefined;
        if (stack.size === 0 && cached.has(prep.prepId)) composition = cached.get(prep.prepId);
        else {
          const out = composePrepPortion(prep, (s) => resolve(s, new Set([...stack, prep.prepId])));
          infos.set(out.info.ref, out.info);
          composition = out.composition;
          if (stack.size === 0) cached.set(prep.prepId, composition);
        }
        if (composition) return composition;
      }
      const barcode = inputs.barcodes.get(subject.lotId);
      const product = barcode ? inputs.products.get(barcode) : undefined;
      const label = product ? compositionFromProduct(product) : undefined;
      if (label) return label;
      return fromOverride(subject.productRef) ?? table(subject);
    }
    if (subject.foodId !== undefined) return table(subject);
    return fromOverride(subject.name) ?? table(subject);
  }

  return { resolve: (subject) => resolve(subject), prepInfo: infos };
}

export function buildResolver(inputs: ResolverInputs): CompositionResolver {
  return buildResolverWithInfo(inputs).resolve;
}
