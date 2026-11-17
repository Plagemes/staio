// Dalle schermate al nucleo degli abbinamenti: soggetti, testi, scadenze. Logica pura.
import {
  MIN_RECIPES_FOR_STAPLES,
  MIN_SHARED_RECIPES,
  cookedTogether,
  resolveTasteFood,
  screenFood,
  type CookedTogether,
  type Pairing,
  type PairingDoubt,
  type TasteFood,
  type RecipeFood,
  type TasteIndex,
  type TasteSubject,
} from "@/core/taste";
import type { Recipe } from "@/core/recipes";
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
