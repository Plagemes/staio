// Dalle schermate al nucleo degli abbinamenti: soggetti, testi, scadenze. Logica pura.
import {
  resolveTasteFood,
  type Pairing,
  type PairingDoubt,
  type TasteFood,
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
