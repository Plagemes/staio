// Dall'ingrediente agli alimenti di dispensa che potrebbe essere, con i nomi dei prodotti e gli allergeni in etichetta:
// è ciò che il controllo degli allergeni legge oltre al nome scritto nella ricetta. Logica pura.
import type { Product } from "@/core/catalog";
import type { Lot } from "@/core/ledger";
import { bestMatches, type IngredientLink, type FoodRef } from "@/core/recipes";

/** Un alimento in casa: il nome sul lotto e, se il codice a barre è noto, ciò che dice il prodotto. */
export interface PantryFood {
  name: string;
  productName?: string;
  /** Allergeni dichiarati in etichetta. */
  allergens: string[];
}

const FOOD_ID_RE = /^[a-z0-9-]+$/;

/** Gli alimenti dei lotti attivi con qualcosa dentro. Senza doppioni per nome e prodotto. */
export function pantryFoods(lots: readonly Lot[], products: ReadonlyMap<string, Product> | undefined): PantryFood[] {
  const seen = new Set<string>();
  const out: PantryFood[] = [];
  for (const lot of lots) {
    if (lot.status !== "active" || !(lot.remaining > 0)) continue;
    const product = lot.barcode ? products?.get(lot.barcode) : undefined;
    const key = `${lot.productRef}\u0000${product?.barcode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: lot.productRef,
      ...(product?.name ? { productName: product.name } : {}),
      allergens: product?.allergens ?? [],
    });
  }
  return out;
}

const unique = (xs: readonly string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter((x) => x !== ""))];

/**
 * Per un ingrediente, gli alimenti di dispensa che gli somigliano. Si include anche la somiglianza parziale («crema» con
 * «crema di arachidi»): per gli allergeni è meglio un controllo in più che uno in meno. Il confronto si fa sia con
 * l'identificativo sia solo con il nome, perché un lotto con nome minuscolo e semplice passa per identificativo.
 */
export function makeLinkOf(foods: readonly PantryFood[]) {
  return (ingredient: { name: string; foodId?: string }): IngredientLink | undefined => {
    if (foods.length === 0) return undefined;
    const byId: FoodRef = { name: ingredient.name, ...(ingredient.foodId ? { foodId: ingredient.foodId } : {}) };
    const refOf = (f: PantryFood): FoodRef => ({ name: f.name, ...(FOOD_ID_RE.test(f.name) ? { foodId: f.name } : {}) });
    const matched = new Set<PantryFood>([
      ...bestMatches(byId, foods, refOf),
      ...bestMatches({ name: ingredient.name }, foods, (f) => ({ name: f.name })),
    ]);
    if (matched.size === 0) return undefined;
    const list = [...matched];
    const names = unique(list.flatMap((f) => [f.name, ...(f.productName ? [f.productName] : [])]));
    const allergens = unique(list.flatMap((f) => f.allergens));
    return {
      ...(names.length > 0 ? { names } : {}),
      ...(allergens.length > 0 ? { allergens } : {}),
    };
  };
}

export type LinkOf = ReturnType<typeof makeLinkOf>;
