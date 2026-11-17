// Dalle schermate al nucleo degli abbinamenti: soggetti, testi, scadenze. Logica pura.
import {
  MIN_DISHES_FOR_FOOD,
  MIN_RECIPES_FOR_FOOD,
  MIN_RECIPES_FOR_STAPLES,
  MIN_SHARED_RECIPES,
  cookedTogether,
  rankByTaste,
  resolveTasteFood,
  screenFood,
  tasteProfile as buildTasteProfileCore,
  type CookedDish,
  type CookedTogether,
  type TasteProfile,
  type VotedDish,
  type Pairing,
  type PairingDoubt,
  type TasteFood,
  type RecipeFood,
  type TasteIndex,
  type TasteSubject,
} from "@/core/taste";
import { allergenLabels } from "@/core/allergens";
import { exclusionReasons, type Cooking, type IngredientLink, type Recipe } from "@/core/recipes";
import type { PantryFood } from "../recipes/allergenLinks";

/** Dal nome scritto all'identificativo della tabella nutrizionale, solo se è la stessa cosa a parole uguali. */
export type FoodIdOf = (name: string) => string | undefined;

const FOOD_ID_RE = /^[a-z0-9-]+$/;

function subjectOf(name: string, foodIdOf: FoodIdOf, known?: string, aliases: readonly string[] = []): TasteSubject {
  const foodId = known ?? foodIdOf(name) ?? (FOOD_ID_RE.test(name) ? name : undefined);
  return { name, ...(foodId ? { foodId } : {}), ...(aliases.length > 0 ? { aliases } : {}) };
}

/** Gli alimenti in casa come soggetti: il nome sul lotto e, se c'è, quello del prodotto. */
export function homeSubjects(foods: readonly PantryFood[], foodIdOf: FoodIdOf): TasteSubject[] {
  return foods.map((f) => subjectOf(f.name, foodIdOf, undefined, f.productName ? [f.productName] : []));
}

/** Gli ingredienti di una ricetta come soggetti. */
export function recipeSubjects(recipe: Pick<Recipe, "ingredients">, foodIdOf: FoodIdOf): TasteSubject[] {
  return recipe.ingredients.map((i) => subjectOf(i.name, foodIdOf, i.foodId || undefined));
}

export interface ExpiringFood {
  name?: string | undefined;
  daysLeft: number;
}

export interface ExpiringPick {
  food: TasteFood;
  /** Come si chiama in dispensa (uno o più lotti). */
  names: string[];
  /** Il più urgente. */
  daysLeft: number;
}

/** Ciò che scade, separato in alimenti dell'elenco (raggruppati) e nomi che non ci sono. Dal più urgente. */
export function expiringPicks(
  index: TasteIndex,
  expiring: readonly ExpiringFood[],
  foodIdOf: FoodIdOf,
): { picks: ExpiringPick[]; notInList: string[] } {
  const byKey = new Map<string, ExpiringPick>();
  const notInList: string[] = [];
  const named = expiring.flatMap((e) => (e.name ? [{ name: e.name, daysLeft: e.daysLeft }] : []));
  for (const e of named.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, "it"))) {
    const food = resolveTasteFood(index, subjectOf(e.name, foodIdOf));
    if (!food) {
      if (!notInList.includes(e.name)) notInList.push(e.name);
      continue;
    }
    const prev = byKey.get(food.key);
    if (!prev) byKey.set(food.key, { food, names: [e.name], daysLeft: e.daysLeft });
    else if (!prev.names.includes(e.name)) prev.names.push(e.name);
  }
  return { picks: [...byKey.values()], notInList };
}

export function daysText(daysLeft: number): string {
  if (daysLeft < 0) return "scaduto";
  if (daysLeft === 0) return "scade oggi";
  if (daysLeft === 1) return "scade domani";
  return `scade tra ${daysLeft} giorni`;
}

const list = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

export function scoreText(score: number): string {
  return score.toFixed(2).replace(".", ",");
}

/** Quanto si somigliano, come numero da 0 a 1: senza etichette che sembrino un giudizio. */
export function similarityText(score: number): string {
  return `somiglianza ${scoreText(score)}`;
}

/** Il segno di incertezza: mai da leggere come compatibile. */
export function doubtText(doubt: PairingDoubt): string {
  const what = doubt.allergens.length > 0 ? list(doubt.allergens) : "l'allergene che hai indicato";
  return `Non so se contiene ${what}: controlla l'etichetta. (${doubt.reasons.join("; ")})`;
}

export function homeText(p: Pick<Pairing, "homeNames">): string {
  return `Ce l'hai in casa: ${p.homeNames.join(", ")}`;
}

/** Con più alimenti nell'insieme: con quali si abbina. */
export function supportText(p: Pick<Pairing, "supportedBy">, memberCount: number): string | undefined {
  return memberCount > 1 ? `Si abbina a: ${p.supportedBy.join(", ")}` : undefined;
}

export function hiddenText(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1
    ? "1 abbinamento non è mostrato perché contiene un allergene o un alimento che hai escluso."
    : `${count} abbinamenti non sono mostrati perché contengono un allergene o un alimento che hai escluso.`;
}

export function unknownText(unknown: readonly string[]): string | undefined {
  return unknown.length === 0 ? undefined : `Non sono nell'elenco degli abbinamenti: ${list(unknown)}.`;
}

/** Nome dell'alimento della tabella nutrizionale, dato l'identificativo. */
export type FoodNameOf = (foodId: string) => string | undefined;

const TASTE = "t:";
const TABLE = "f:";

/** Chiave con cui l'alimento dell'elenco degli abbinamenti si cerca nelle ricette. */
export const tasteFoodKey = (food: Pick<TasteFood, "key">): string => TASTE + food.key;

/**
 * Gli ingredienti di una ricetta ricondotti ad alimenti: prima l'alimento dell'elenco degli abbinamenti (così le varianti
 * di uno stesso alimento contano insieme), poi quello della tabella nutrizionale. Ciò che non si riconosce è lasciato fuori.
 */
export function recipeFoods(
  recipe: Pick<Recipe, "ingredients">,
  index: TasteIndex,
  foodIdOf: FoodIdOf,
  foodNameOf: FoodNameOf,
): RecipeFood[] {
  const out: RecipeFood[] = [];
  for (const subject of recipeSubjects(recipe, foodIdOf)) {
    const taste = resolveTasteFood(index, subject);
    if (taste) out.push({ key: tasteFoodKey(taste), name: taste.name });
    else if (subject.foodId) out.push({ key: TABLE + subject.foodId, name: foodNameOf(subject.foodId) ?? subject.name });
  }
  return out;
}

export interface CookedPairView {
  food: RecipeFood;
  together: number;
  doubt?: PairingDoubt;
}

export interface CookedView extends CookedTogether {
  pairs: CookedPairView[];
  /** Coppie non mostrate perché contengono un allergene o un alimento escluso. */
  hiddenCount: number;
}

const tasteFoodOf = (index: TasteIndex, food: RecipeFood): TasteFood =>
  (food.key.startsWith(TASTE) ? index.byKey.get(food.key.slice(TASTE.length)) : undefined) ?? {
    key: food.key,
    name: food.name,
    foodIds: food.key.startsWith(TABLE) ? [food.key.slice(TABLE.length)] : [],
  };

/** Le coppie dalle ricette, passate dagli stessi controlli allergeni degli abbinamenti di FlavorGraph. */
export function cookedView(
  recipes: readonly Pick<Recipe, "ingredients">[],
  focus: TasteFood,
  index: TasteIndex,
  foodIdOf: FoodIdOf,
  foodNameOf: FoodNameOf,
  options: { allergens: readonly string[]; excludedFoods: readonly string[] },
): CookedView {
  const result = cookedTogether(
    recipes.map((r) => recipeFoods(r, index, foodIdOf, foodNameOf)),
    tasteFoodKey(focus),
  );
  const pairs: CookedPairView[] = [];
  let hiddenCount = 0;
  for (const p of result.pairs) {
    const verdict = screenFood(tasteFoodOf(index, p.food), options);
    if (verdict.status === "excluded") hiddenCount++;
    else pairs.push({ ...p, ...(verdict.status === "uncertain" ? { doubt: verdict.doubt } : {}) });
  }
  return { ...result, pairs, hiddenCount };
}

/** «in 3 delle tue ricette» */
export function togetherText(n: number): string {
  return `in ${n} delle tue ricette`;
}

/** La riga unica quando non c'è niente da elencare: dice perché e invita a salvare ricette. */
export function cookedEmptyText(view: Pick<CookedTogether, "recipeCount" | "withFood" | "seenOnce">, foodName: string): string {
  if (view.recipeCount === 0) return "Non hai ancora ricette salvate: salvane qualcuna e qui vedrai cosa usi insieme.";
  if (view.withFood === 0) return `${foodName} non compare nelle tue ricette. Salva altre ricette per vedere cosa usi insieme.`;
  if (view.seenOnce > 0) {
    return `Con ${foodName} ho visto solo abbinamenti usati una volta. Servono ${MIN_SHARED_RECIPES} ricette: salvane altre.`;
  }
  return `Nelle tue ricette ${foodName} è da solo. Salva altre ricette per vedere cosa usi insieme.`;
}

/** Cosa si conta, dichiarato nella schermata. */
export function cookedBasisText(view: Pick<CookedTogether, "recipeCount" | "seenOnce" | "staples">): string {
  const parts = [
    `Conto le tue ${view.recipeCount} ricette: una coppia compare da ${MIN_SHARED_RECIPES} ricette in comune.`,
  ];
  if (view.seenOnce > 0) {
    parts.push(
      view.seenOnce === 1 ? "1 alimento visto una sola volta non è elencato." : `${view.seenOnce} alimenti visti una sola volta non sono elencati.`,
    );
  }
  if (view.staples.length > 0) {
    parts.push(
      `Non conto ${list(view.staples.map((s) => s.name.toLowerCase()))}: sono in più di metà delle tue ricette.`,
    );
  } else if (view.recipeCount >= MIN_RECIPES_FOR_STAPLES) {
    parts.push("Conto tutti gli alimenti, anche quelli di base.");
  } else {
    parts.push(`Con meno di ${MIN_RECIPES_FOR_STAPLES} ricette conto tutti gli alimenti, anche quelli di base come sale e olio.`);
  }
  return parts.join(" ");
}

// ---- I tuoi gusti: dai voti ai piatti ----

/** I piatti votati e le cotture, con gli ingredienti ricondotti ad alimenti. Le ricette non più trovate sono lasciate fuori. */
export function dishesFromCookings(
  cookings: readonly Pick<Cooking, "recipeId" | "rating">[],
  recipes: readonly Pick<Recipe, "recipeId" | "ingredients">[],
  index: TasteIndex,
  foodIdOf: FoodIdOf,
  foodNameOf: FoodNameOf,
): { voted: VotedDish[]; cooked: CookedDish[] } {
  const foodsOf = new Map<string, RecipeFood[]>();
  for (const r of recipes) foodsOf.set(r.recipeId, recipeFoods(r, index, foodIdOf, foodNameOf));
  const voted: VotedDish[] = [];
  const cooked: CookedDish[] = [];
  for (const c of cookings) {
    const foods = foodsOf.get(c.recipeId);
    if (!foods) continue;
    cooked.push({ recipeId: c.recipeId, foods });
    if (c.rating) voted.push({ recipeId: c.recipeId, good: c.rating !== "poor", foods });
  }
  return { voted, cooked };
}

/** Il profilo dai piatti votati e dalle cotture. */
export function buildTasteProfile(voted: readonly VotedDish[], cooked: readonly CookedDish[]): TasteProfile {
  return buildTasteProfileCore(voted, cooked);
}

export interface TasteItemView {
  /** «Carciofi» o «Carciofi + limone». */
  label: string;
  /** «bene in 4 piatti, male in 1». */
  counts: string;
  doubt?: PairingDoubt;
}

export type TasteProfileView =
  | { status: "few"; text: string }
  | {
      status: "ok";
      liked: TasteItemView[];
      disliked: TasteItemView[];
      mixed: TasteItemView[];
      likedPairs: TasteItemView[];
      dislikedPairs: TasteItemView[];
      often: string | undefined;
      /** Elementi non mostrati perché contengono un allergene o un alimento escluso. */
      hiddenCount: number;
      /** Quando nessun ingrediente ha ancora abbastanza piatti votati. */
      empty: string | undefined;
      basis: string;
    };

const SHOWN_FOODS = 6;
const SHOWN_PAIRS = 4;

export function fewDataText(voted: number, needed: number): string {
  const have = voted === 0 ? "Nessun piatto votato" : voted === 1 ? "1 piatto votato" : `${voted} piatti votati`;
  return `Pochi dati: ${have}, ne servono almeno ${needed} per dirti cosa ti piace. Dopo aver cucinato rispondi a «Com'era?»: basta un tocco.`;
}

function countsOf(t: { good: number; bad: number }): string {
  const plates = (n: number) => (n === 1 ? "1 piatto" : `${n} piatti`);
  if (t.bad === 0) return `bene in ${plates(t.good)}`;
  if (t.good === 0) return `male in ${plates(t.bad)}`;
  return `bene in ${plates(t.good)}, male in ${t.bad}`;
}

/** Cosa si conta, dichiarato nella schermata. */
export function tasteBasisText(p: { voted: number; good: number; bad: number; staples: readonly RecipeFood[] }): string {
  const parts = [
    `Conto i tuoi ${p.voted} piatti votati: ${p.good} bene («buono» e «ottimo»), ${p.bad} male («non buono»).`,
    `Un ingrediente o una coppia compare da ${MIN_DISHES_FOR_FOOD} piatti votati in almeno ${MIN_RECIPES_FOR_FOOD} ricette diverse.`,
    "«Di solito ti piace» da due piatti su tre votati bene, «di solito no» da due su tre votati male.",
  ];
  if (p.staples.length > 0) parts.push(`Non conto ${list(p.staples.map((s) => s.name.toLowerCase()))}: sono in più di metà dei piatti.`);
  parts.push("Sono conteggi sulle tue ricette, non una previsione: gli ingredienti che di solito non ti piacciono non vengono nascosti.");
  return parts.join(" ");
}

/** La nota sull'ordine degli abbinamenti, quando il profilo lo ha cambiato. */
export const TASTE_ORDER_NOTE = "In cima ciò che di solito ti piace; ciò che di solito non ti piace viene dopo, ma c'è.";

/** Il profilo come lo mostra la schermata, passato dagli stessi controlli allergeni degli abbinamenti. */
export function tasteProfileView(
  profile: TasteProfile,
  index: TasteIndex,
  options: {
    allergens: readonly string[];
    excludedFoods: readonly string[];
    /** Alimenti di dispensa e prodotti collegati all'ingrediente: lo stesso collegamento del ricettario. */
    linkOf?: (ingredient: { name: string; foodId?: string }) => IngredientLink | undefined;
  },
): TasteProfileView {
  if (profile.status === "few") return { status: "few", text: fewDataText(profile.voted, profile.needed) };
  let hiddenCount = 0;
  const screen = (foods: readonly RecipeFood[]): { doubt?: PairingDoubt } | undefined => {
    let doubt: PairingDoubt | undefined;
    for (const f of foods) {
      const v = screenFood(tasteFoodOf(index, f), options);
      if (v.status === "excluded") return undefined;
      if (v.status === "uncertain" && !doubt) doubt = v.doubt;
      // lo stesso controllo completo del ricettario: alimento collegato, nome ed etichetta del prodotto in dispensa
      const taste = tasteFoodOf(index, f);
      const ingredient = { name: taste.name, ...(taste.foodIds[0] ? { foodId: taste.foodIds[0] } : {}) };
      const reasons = exclusionReasons(
        { ingredients: [ingredient] },
        {
          allergens: options.allergens,
          excludedFoods: options.excludedFoods,
          ...(options.linkOf ? { linkOf: options.linkOf } : {}),
        },
      );
      if (reasons.some((r) => r.code === "allergen" || r.code === "excluded_food")) return undefined;
      const unsure = reasons.flatMap((r) => (r.code === "allergen_uncertain" ? [r.allergen] : []));
      if (unsure.length > 0 && !doubt) {
        doubt = { allergens: allergenLabels(unsure), reasons: ["ingrediente collegato a un prodotto o generico: controlla l'etichetta"] };
      }
    }
    return doubt ? { doubt } : {};
  };
  const foodItems = (lean: "liked" | "disliked" | "mixed"): TasteItemView[] => {
    const out: TasteItemView[] = [];
    for (const f of profile.foods) {
      if (f.lean !== lean) continue;
      const s = screen([f.food]);
      if (!s) hiddenCount++;
      else if (out.length < SHOWN_FOODS) out.push({ label: f.food.name, counts: countsOf(f), ...s });
    }
    return out;
  };
  const pairItems = (lean: "liked" | "disliked"): TasteItemView[] => {
    const out: TasteItemView[] = [];
    for (const p of profile.pairs) {
      if (p.lean !== lean) continue;
      const s = screen([p.a, p.b]);
      if (!s) hiddenCount++;
      else if (out.length < SHOWN_PAIRS) out.push({ label: `${p.a.name} + ${p.b.name}`, counts: countsOf(p), ...s });
    }
    return out;
  };
  const often = profile.often
    .slice(0, 5)
    .filter((o) => screen([o.food]) !== undefined)
    .map((o) => `${o.food.name} (${o.times} volte)`);
  return {
    status: "ok",
    liked: foodItems("liked"),
    disliked: foodItems("disliked"),
    mixed: foodItems("mixed"),
    likedPairs: pairItems("liked"),
    dislikedPairs: pairItems("disliked"),
    often: often.length > 0 ? `Cucini spesso: ${list(often)}.` : undefined,
    hiddenCount,
    empty:
      profile.foods.length === 0
        ? `Nessun ingrediente compare ancora in ${MIN_DISHES_FOR_FOOD} piatti votati di ricette diverse: continua a votare e qui comparirà cosa ti piace.`
        : undefined,
    basis: tasteBasisText(profile),
  };
}

/** Gli abbinamenti riordinati secondo i gusti; le chiavi sono quelle di `tasteFoodKey`. */
export function rankPairingsByTaste<T extends { food: Pick<TasteFood, "key"> }>(
  items: readonly T[],
  profile: TasteProfile,
  focus: readonly Pick<TasteFood, "key">[] = [],
): T[] {
  return rankByTaste(items, (p) => tasteFoodKey(p.food), profile, focus.map(tasteFoodKey));
}

/** Vero se i gusti cambiano l'ordine di almeno un abbinamento: solo allora si dichiara «in cima ciò che di solito ti piace». */
export function tasteChangesOrder<T extends { food: Pick<TasteFood, "key"> }>(
  items: readonly T[],
  profile: TasteProfile,
  focus: readonly Pick<TasteFood, "key">[] = [],
): boolean {
  const ranked = rankPairingsByTaste(items, profile, focus);
  return ranked.some((p, i) => p !== items[i]);
}
