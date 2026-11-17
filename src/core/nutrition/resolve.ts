// Dalle fonti di composizione (alimenti generici, prodotti letti dal codice a barre) a una
// composizione pronta per il calcolo, e un risolutore di voci pronto all'uso.

import type { Product } from "../catalog";
import type { ResolvedComposition } from "./amounts";
import { createFoodMatcher, type FoodState, type MatchOptions, type StatePreference } from "./match";
import type { FoodComposition, NutrientAmounts } from "./types";

/**
 * Stati preferiti per tipo di voce, in ordine. Chi scrive un pasto a mano intende l'alimento cotto
 * ("pasta 200 g"); un consumo di dispensa è l'alimento com'è conservato (la pasta secca).
 */
export const DEFAULT_STATE_PREFERENCE: {
  mealItem: readonly FoodState[];
  pantry: readonly FoodState[];
} = {
  mealItem: ["cooked"],
  pantry: ["dried", "raw", "as_sold"],
};

/** Che cosa chiede il motore di calcolo al risolutore. */
export type IntakeSubject =
  /** Voce libera di un pasto. */
  | {
      kind: "mealItem";
      name: string;
      mealId: string;
      /** Alimento della tabella scelto dall'utente: se c'è, si usa quello e basta. */
      foodId?: string;
      preferStates?: readonly FoodState[];
    }
  /** Consumo di un lotto di dispensa. `productRef` è un codice di catalogo oppure un nome libero. */
  | {
      kind: "pantry";
      productRef: string;
      lotId: string;
      category?: string;
      preferStates?: readonly FoodState[];
    };

/** Per ogni voce restituisce una composizione, oppure `undefined` se non ne conosce una affidabile. */
/**
 * Il risolutore ha riconosciuto l'alimento ma non può darne una composizione affidabile per un
 * motivo preciso: la voce resta "non risolta" con quel motivo.
 */
export interface ResolutionFailure {
  failure: "missing_cooked_entry" | "unknown_food_id";
  message?: string;
}

/** Composizione, un fallimento con motivo, oppure `undefined` se non conosce l'alimento. */
export type ResolverResult = ResolvedComposition | ResolutionFailure | undefined;

export type CompositionResolver = (subject: IntakeSubject) => ResolverResult;

export function compositionFromFood(
  food: FoodComposition,
  statePreference?: StatePreference,
  selection?: ResolvedComposition["selection"],
): ResolvedComposition {
  return {
    name: food.name,
    ref: food.id,
    origin: "table",
    basis: food.basis,
    per100: food.per100,
    ...(food.unitWeightG !== undefined ? { unitWeightG: food.unitWeightG } : {}),
    ...(food.densityGPerMl !== undefined ? { densityGPerMl: food.densityGPerMl } : {}),
    ...(food.state !== undefined ? { state: food.state } : {}),
    ...(statePreference !== undefined ? { statePreference } : {}),
    ...(selection !== undefined ? { selection } : {}),
  };
}

/**
 * Valori d'etichetta di un prodotto. `undefined` se il prodotto non riporta alcun nutriente.
 * Non deduce il peso di un pezzo né la densità: senza, le conversioni restano "non calcolabili".
 */
export function compositionFromProduct(product: Product): ResolvedComposition | undefined {
  const n = product.nutrients;
  if (!n) return undefined;
  const per100: NutrientAmounts = {};
  const copy = (key: keyof NutrientAmounts, value: number | undefined): void => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) per100[key] = value;
  };
  copy("energyKcal", n.energyKcal);
  copy("proteinG", n.proteins);
  copy("carbsG", n.carbohydrates);
  copy("sugarsG", n.sugars);
  copy("fatG", n.fat);
  copy("saturatedFatG", n.saturatedFat);
  copy("fiberG", n.fiber);
  copy("saltG", n.salt);
  if (Object.keys(per100).length === 0) return undefined;
  return {
    name: product.name ?? product.barcode,
    ref: product.barcode,
    origin: "label",
    selection: "product",
    basis: n.per === "100ml" ? "ml" : "g",
    per100,
  };
}

export interface ResolverSources {
  /** Tabella di composizione degli alimenti generici. */
  foods: readonly FoodComposition[];
  /** Cerca un prodotto per riferimento di dispensa (codice a barre). */
  productByRef?: (ref: string) => Product | undefined;
  match?: MatchOptions;
}

/**
 * Risolutore standard: un consumo di dispensa si cerca prima tra i prodotti (valori d'etichetta),
 * poi per nome nella tabella; una voce libera si cerca per nome nella tabella. Un nome ambiguo o
 * troppo diverso non dà alcuna composizione.
 */
export function createResolver(sources: ResolverSources): CompositionResolver {
  const matcher = createFoodMatcher(sources.foods, sources.match);
  const byName = (
    name: string,
    preferStates: readonly FoodState[] | undefined,
  ): ResolverResult => {
    const out = matcher.find(name, preferStates ? { preferStates } : {});
    if (out.status === "match") {
      return compositionFromFood(out.match.food, out.match.statePreference, "name");
    }
    if (out.status === "state_unavailable") {
      const names = out.candidates.map((c) => c.food.name).join(", ");
      return {
        failure: out.reason,
        message: `Di «${name}» nella tabella c'è solo la voce secca (${names}): manca la voce cotta.`,
      };
    }
    return undefined;
  };
  const byId = new Map(sources.foods.map((f) => [f.id, f]));
  return (subject) => {
    if (subject.kind === "mealItem") {
      // Una scelta esplicita non passa dal nome né dalla preferenza di stato, e se l'alimento non
      // c'è più non si ricade sul nome: la voce resta non risolta.
      if (subject.foodId !== undefined) {
        const food = byId.get(subject.foodId);
        if (food) return compositionFromFood(food, undefined, "explicit");
        return {
          failure: "unknown_food_id",
          message: `L'alimento scelto (${subject.foodId}) non esiste più nella tabella.`,
        };
      }
      return byName(subject.name, subject.preferStates);
    }
    const product = sources.productByRef?.(subject.productRef);
    const fromProduct = product ? compositionFromProduct(product) : undefined;
    return fromProduct ?? byName(subject.productRef, subject.preferStates);
  };
}
