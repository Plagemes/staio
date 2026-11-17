// Abbinamenti dalle ricette salvate: quali alimenti compaiono insieme, contati. Nessun punteggio, solo conteggi.

/** Un alimento di una ricetta, già ricondotto a un alimento noto. `key` lo identifica, `name` si mostra. */
export interface RecipeFood {
  key: string;
  name: string;
}

/** Da quante ricette in comune una coppia conta. Con una sola è «vista una volta», non un'abitudine. */
export const MIN_SHARED_RECIPES = 2;
/** Gli ingredienti di base si tolgono solo se le ricette sono almeno tante. */
export const MIN_RECIPES_FOR_STAPLES = 6;

export interface CookedPair {
  food: RecipeFood;
  /** Ricette in cui compare insieme all'alimento scelto. */
  together: number;
}

export interface CookedTogether {
  /** Ricette considerate (con almeno un alimento riconosciuto). */
  recipeCount: number;
  /** Ricette in cui compare l'alimento scelto. */
  withFood: number;
  /** Coppie da `MIN_SHARED_RECIPES` ricette in su: per ricette in comune, poi per nome. */
  pairs: CookedPair[];
  /** Quanti alimenti compaiono con lui una sola volta: non sono elencati. */
  seenOnce: number;
  /** Alimenti di base tolti dall'elenco (presenti in più di metà delle ricette), per nome. */
  staples: RecipeFood[];
}

const byName = (a: RecipeFood, b: RecipeFood): number =>
  a.name.localeCompare(b.name, "it") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Ogni ricetta come insieme: un alimento ripetuto conta una volta, le ricette senza alimenti riconosciuti non contano. */
function asSets(recipes: readonly (readonly RecipeFood[])[]): Map<string, RecipeFood>[] {
  const sets: Map<string, RecipeFood>[] = [];
  for (const recipe of recipes) {
    const set = new Map<string, RecipeFood>();
    for (const f of recipe) if (f.key && !set.has(f.key)) set.set(f.key, f);
    if (set.size > 0) sets.push(set);
  }
  return sets;
}

/**
 * Gli alimenti di base: solo con almeno `MIN_RECIPES_FOR_STAPLES` ricette, quelli presenti in più della metà. Con
 * poche ricette non si può dire cosa sia «di base»: non si toglie nulla.
 */
function staplesOf(sets: readonly Map<string, RecipeFood>[]): Map<string, RecipeFood> {
  const staples = new Map<string, RecipeFood>();
  if (sets.length < MIN_RECIPES_FOR_STAPLES) return staples;
  const counts = new Map<string, { food: RecipeFood; n: number }>();
  for (const set of sets) {
    for (const [key, food] of set) {
      const c = counts.get(key);
      if (c) c.n++;
      else counts.set(key, { food, n: 1 });
    }
  }
  for (const [key, { food, n }] of counts) if (n * 2 > sets.length) staples.set(key, food);
  return staples;
}

/**
 * Con quali alimenti compare `focusKey` nelle ricette. Il risultato non dipende dall'ordine delle ricette né degli
 * ingredienti. L'alimento scelto non è mai tolto, anche se è di base.
 */
export function cookedTogether(recipes: readonly (readonly RecipeFood[])[], focusKey: string): CookedTogether {
  const sets = asSets(recipes);
  const staples = staplesOf(sets);
  const shared = new Map<string, CookedPair>();
  let withFood = 0;
  for (const set of sets) {
    if (!set.has(focusKey)) continue;
    withFood++;
    for (const [key, food] of set) {
      if (key === focusKey || staples.has(key)) continue;
      const p = shared.get(key);
      if (p) p.together++;
      else shared.set(key, { food, together: 1 });
    }
  }
  const all = [...shared.values()];
  const pairs = all
    .filter((p) => p.together >= MIN_SHARED_RECIPES)
    .sort((a, b) => b.together - a.together || byName(a.food, b.food));
  return {
    recipeCount: sets.length,
    withFood,
    pairs,
    seenOnce: all.length - pairs.length,
    staples: [...staples.values()].filter((f) => f.key !== focusKey).sort(byName),
  };
}
