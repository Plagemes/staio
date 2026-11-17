// Profilo di gusto personale: quali ingredienti e quali coppie compaiono nei piatti votati bene e in quelli votati male.
// Solo conteggi con soglie dichiarate, nessun modello: ogni cifra si può rifare a mano.
import { MIN_RECIPES_FOR_STAPLES, type RecipeFood } from "./cooked-together";

/** Piatti votati necessari prima di dire qualcosa. Sotto, il profilo dice «pochi dati». */
export const MIN_VOTED_DISHES = 5;
/** Piatti votati in cui deve comparire un ingrediente (o una coppia) per contare. */
export const MIN_DISHES_FOR_FOOD = 3;
/** Ricette diverse tra quei piatti: lo stesso piatto rifatto tre volte non basta a dire «ti piace l'ingrediente». */
export const MIN_RECIPES_FOR_FOOD = 2;
/** Quota di piatti votati bene da cui «di solito ti piace»; sotto 1 meno questa quota, «di solito no». */
export const LIKED_SHARE = 2 / 3;
/** Cotture in cui compare un ingrediente per dirlo «cucinato spesso». */
export const MIN_COOKINGS_OFTEN = 3;

/** Un piatto cucinato e votato: `good` è «buono» o «ottimo», altrimenti «non buono». */
export interface VotedDish {
  recipeId: string;
  good: boolean;
  foods: readonly RecipeFood[];
}

/** Una cottura qualunque (votata o no), per sapere cosa si cucina più spesso. */
export interface CookedDish {
  recipeId: string;
  foods: readonly RecipeFood[];
}

export type Lean = "liked" | "disliked" | "mixed";

export interface FoodTaste {
  food: RecipeFood;
  /** Piatti votati con questo ingrediente: bene, male, totale, e in quante ricette diverse. */
  good: number;
  bad: number;
  total: number;
  recipes: number;
  lean: Lean;
}

export interface PairTaste {
  a: RecipeFood;
  b: RecipeFood;
  good: number;
  bad: number;
  total: number;
  recipes: number;
  lean: Lean;
}

export type TasteProfile =
  | { status: "few"; voted: number; needed: number }
  | {
      status: "ok";
      voted: number;
      good: number;
      bad: number;
      foods: FoodTaste[];
      pairs: PairTaste[];
      /** Ingredienti di base tolti (in più di metà dei piatti votati, solo con abbastanza piatti). */
      staples: RecipeFood[];
      /** Ingredienti cucinati più spesso, anche senza voto. */
      often: { food: RecipeFood; times: number }[];
    };

const SEP = "\u0000";
const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: RecipeFood, b: RecipeFood): number => a.name.localeCompare(b.name, "it") || cmpText(a.key, b.key);

function leanOf(good: number, total: number): Lean {
  const share = good / total;
  if (share >= LIKED_SHARE) return "liked";
  if (share <= 1 - LIKED_SHARE) return "disliked";
  return "mixed";
}

const LEAN_ORDER: Record<Lean, number> = { liked: 0, mixed: 1, disliked: 2 };

interface Tally {
  good: number;
  bad: number;
  recipes: Set<string>;
}

function bump(map: Map<string, Tally>, key: string, dish: VotedDish): void {
  const t = map.get(key) ?? { good: 0, bad: 0, recipes: new Set<string>() };
  if (dish.good) t.good++;
  else t.bad++;
  t.recipes.add(dish.recipeId);
  map.set(key, t);
}

const qualifies = (t: Tally): boolean => t.good + t.bad >= MIN_DISHES_FOR_FOOD && t.recipes.size >= MIN_RECIPES_FOR_FOOD;

/** Il profilo dai piatti votati. Non dipende dall'ordine dei piatti né degli ingredienti. */
export function tasteProfile(voted: readonly VotedDish[], cooked: readonly CookedDish[] = []): TasteProfile {
  const dishes = voted.map((d) => {
    const set = new Map<string, RecipeFood>();
    for (const f of d.foods) if (f.key && !set.has(f.key)) set.set(f.key, f);
    return { dish: d, set };
  });
  const nonEmpty = dishes.filter((d) => d.set.size > 0);
  if (nonEmpty.length < MIN_VOTED_DISHES) return { status: "few", voted: nonEmpty.length, needed: MIN_VOTED_DISHES };

  const presence = new Map<string, { food: RecipeFood; n: number }>();
  for (const { set } of nonEmpty) {
    for (const [key, food] of set) {
      const p = presence.get(key);
      if (p) p.n++;
      else presence.set(key, { food, n: 1 });
    }
  }
  const staples = new Map<string, RecipeFood>();
  if (nonEmpty.length >= MIN_RECIPES_FOR_STAPLES) {
    for (const [key, { food, n }] of presence) if (n * 2 > nonEmpty.length) staples.set(key, food);
  }

  const foodTally = new Map<string, Tally>();
  const pairTally = new Map<string, Tally>();
  const known = new Map<string, RecipeFood>();
  for (const { dish, set } of nonEmpty) {
    const keys = [...set.keys()].filter((k) => !staples.has(k)).sort(cmpText);
    for (const k of keys) {
      bump(foodTally, k, dish);
      known.set(k, set.get(k) as RecipeFood);
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) bump(pairTally, `${keys[i]}${SEP}${keys[j]}`, dish);
    }
  }

  const order = (a: { lean: Lean; good: number; total: number }, b: { lean: Lean; good: number; total: number }) =>
    LEAN_ORDER[a.lean] - LEAN_ORDER[b.lean] || b.good / b.total - a.good / a.total || b.total - a.total;

  const foods: FoodTaste[] = [];
  for (const [key, t] of foodTally) {
    if (!qualifies(t)) continue;
    const total = t.good + t.bad;
    foods.push({ food: known.get(key) as RecipeFood, good: t.good, bad: t.bad, total, recipes: t.recipes.size, lean: leanOf(t.good, total) });
  }
  foods.sort((a, b) => order(a, b) || byName(a.food, b.food));

  const pairs: PairTaste[] = [];
  for (const [k, t] of pairTally) {
    if (!qualifies(t)) continue;
    const [ka, kb] = k.split(SEP) as [string, string];
    const total = t.good + t.bad;
    pairs.push({
      a: known.get(ka) as RecipeFood,
      b: known.get(kb) as RecipeFood,
      good: t.good,
      bad: t.bad,
      total,
      recipes: t.recipes.size,
      lean: leanOf(t.good, total),
    });
  }
  pairs.sort((x, y) => order(x, y) || byName(x.a, y.a) || byName(x.b, y.b));

  const often = new Map<string, { food: RecipeFood; times: number }>();
  for (const c of cooked) {
    const seen = new Set<string>();
    for (const f of c.foods) {
      if (!f.key || seen.has(f.key) || staples.has(f.key)) continue;
      seen.add(f.key);
      const o = often.get(f.key);
      if (o) o.times++;
      else often.set(f.key, { food: f, times: 1 });
    }
  }
  const oftenList = [...often.values()]
    .filter((o) => o.times >= MIN_COOKINGS_OFTEN)
    .sort((a, b) => b.times - a.times || byName(a.food, b.food));

  const good = nonEmpty.filter((d) => d.dish.good).length;
  return {
    status: "ok",
    voted: nonEmpty.length,
    good,
    bad: nonEmpty.length - good,
    foods,
    pairs,
    staples: [...staples.values()].sort(byName),
    often: oftenList,
  };
}

/** Gli ingredienti che di solito ti piacciono o no, per chiave. Vuoto senza abbastanza dati; «mixed» non c'è. */
export function foodLeanings(profile: TasteProfile): Map<string, "liked" | "disliked"> {
  const out = new Map<string, "liked" | "disliked">();
  if (profile.status !== "ok") return out;
  for (const f of profile.foods) if (f.lean !== "mixed") out.set(f.food.key, f.lean);
  return out;
}

/**
 * Riordina senza togliere nulla: prima ciò che di solito ti piace, poi il resto, in coda ciò che di solito no. Dentro
 * ogni gruppo resta l'ordine di partenza. Con `focusKeys` (gli ingredienti da cui si parte) conta anche la coppia
 * con l'alimento, se ha dati abbastanza, prima dell'alimento da solo.
 */
export function rankByTaste<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  profile: TasteProfile,
  focusKeys: readonly string[] = [],
): T[] {
  if (profile.status !== "ok") return [...items];
  const foods = foodLeanings(profile);
  const pairs = new Map<string, Lean>();
  for (const p of profile.pairs) pairs.set(`${p.a.key}${SEP}${p.b.key}`, p.lean);
  const pairLean = (a: string, b: string): Lean | undefined => pairs.get(a < b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`);
  const group = (item: T): number => {
    const key = keyOf(item);
    const leans = focusKeys.map((f) => pairLean(f, key)).filter((l): l is Lean => l !== undefined && l !== "mixed");
    if (leans.length > 0) {
      const liked = leans.includes("liked");
      const disliked = leans.includes("disliked");
      if (liked !== disliked) return liked ? 0 : 2;
    }
    const f = foods.get(key);
    return f === "liked" ? 0 : f === "disliked" ? 2 : 1;
  };
  return items
    .map((item, i) => ({ item, i, g: group(item) }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((x) => x.item);
}
