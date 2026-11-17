import { ALLERGEN_KEYS, ALLERGEN_TABLES, allergensInText, assessRecipe, type ItemSubject } from "../allergens";
import { nameTokens } from "../nutrition";
import { bestMatches, type FoodRef } from "./match";
import type { RecipeIngredient, RecipeStep, RecipeTimes } from "./types";

export interface Filterable {
  title?: string;
  ingredients: readonly RecipeIngredient[];
  steps?: readonly RecipeStep[];
  times?: RecipeTimes;
  equipment?: readonly string[];
}

/** Tempo totale in minuti: `totalMinutes`, altrimenti preparazione più cottura, altrimenti la somma dei passi con durata. */
export function totalMinutes(recipe: Pick<Filterable, "times" | "steps">): number | undefined {
  const t = recipe.times;
  if (t?.totalMinutes !== undefined) return t.totalMinutes;
  if (t?.prepMinutes !== undefined || t?.cookMinutes !== undefined) {
    return (t.prepMinutes ?? 0) + (t.cookMinutes ?? 0);
  }
  const steps = (recipe.steps ?? []).filter((s) => s.durationMinutes !== undefined);
  if (steps.length === 0) return undefined;
  return steps.reduce((s, x) => s + (x.durationMinutes as number), 0);
}

/**
 * I 14 allergeni dell'allegato II del Reg. (UE) 1169/2011, ciascuno con le voci delle tabelle del motore unico
 * (`../allergens`). Le chiavi sono quelle che le schermate mostrano e salvano. Chi ha un'allergia grave legge sempre
 * le etichette: il controllo non vede le tracce.
 */
export const ALLERGEN_STEMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  ALLERGEN_TABLES.map((t) => [t.key, t.terms]),
);

/** Allergeni (come chiavi di `ALLERGEN_STEMS`) che un ingrediente contiene di sicuro, da nome, nota e alimento collegato. */
export function allergensOfIngredient(
  ingredient: Pick<RecipeIngredient, "name"> & Partial<Pick<RecipeIngredient, "note" | "foodId">>,
): string[] {
  const found = new Set<string>();
  for (const text of [ingredient.name, ingredient.note, ingredient.foodId]) {
    if (text) for (const key of allergensInText(text)) found.add(key);
  }
  return ALLERGEN_KEYS.filter((k) => found.has(k));
}

export type ExclusionReason =
  | { code: "too_long"; minutes: number; maxMinutes: number }
  | { code: "time_unknown" }
  | { code: "missing_equipment"; equipment: string[] }
  | { code: "excluded_food"; ingredients: string[]; steps?: string[]; inTitle?: true }
  | { code: "allergen"; allergen: string; ingredients: string[]; steps?: string[]; inTitle?: true }
  /** Ingrediente generico o composto («crema», «dado»): non si sa se contiene l'allergene. Mai compatibile. */
  | { code: "allergen_uncertain"; allergen: string; ingredients: string[] };

/** Ciò che si sa di un ingrediente oltre al nome: alimenti di dispensa collegati, prodotto, allergeni in etichetta. */
export interface IngredientLink {
  names?: readonly string[];
  productName?: string;
  allergens?: readonly string[];
}

export interface FilterCriteria {
  /** Tempo disponibile in minuti. */
  maxMinutes?: number;
  /** Con `maxMinutes`: cosa fare delle ricette senza tempo noto. Predefinito `include`. */
  unknownTime?: "include" | "exclude";
  /** Attrezzatura posseduta: ogni attrezzo richiesto dalla ricetta deve esserci. */
  ownedEquipment?: readonly string[];
  /** Alimenti da escludere, per nome o `foodId`. */
  excludedFoods?: readonly (string | FoodRef)[];
  /** Allergeni da evitare ("glutine", "lattosio", "uova"…). */
  allergens?: readonly string[];
  /** Allergeni noti per ingrediente (per esempio da una tabella per `foodId`), in aggiunta al nome. */
  allergensOf?: (ingredient: RecipeIngredient) => readonly string[] | undefined;
  /** Alimento di dispensa o prodotto collegato all'ingrediente: il controllo guarda anche i loro nomi ed etichette. */
  linkOf?: (ingredient: RecipeIngredient) => IngredientLink | undefined;
}

export interface FilterResult<T> {
  kept: T[];
  excluded: { recipe: T; reasons: ExclusionReason[] }[];
}

function equipmentSatisfied(required: string, owned: readonly string[]): boolean {
  const rt = new Set(nameTokens(required));
  if (rt.size === 0) return true;
  return owned.some((o) => {
    const ot = new Set(nameTokens(o));
    if (ot.size === 0) return false;
    const [small, large] = ot.size <= rt.size ? [ot, rt] : [rt, ot];
    for (const t of small) if (!large.has(t)) return false;
    return true;
  });
}

function subjectOf(ing: RecipeIngredient, criteria: FilterCriteria): ItemSubject {
  const link = criteria.linkOf?.(ing);
  const labels = [...(criteria.allergensOf?.(ing) ?? []), ...(link?.allergens ?? [])];
  return {
    name: ing.name,
    ...(ing.note ? { note: ing.note } : {}),
    ...(ing.foodId ? { foodId: ing.foodId } : {}),
    ...(link?.names && link.names.length > 0 ? { linkedNames: link.names } : {}),
    ...(link?.productName ? { productName: link.productName } : {}),
    ...(labels.length > 0 ? { labelAllergens: labels } : {}),
  };
}

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Motivi per cui una ricetta non passa i criteri (lista vuota se passa). */
export function exclusionReasons(recipe: Filterable, criteria: FilterCriteria): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];

  if (criteria.maxMinutes !== undefined) {
    const minutes = totalMinutes(recipe);
    if (minutes === undefined) {
      if (criteria.unknownTime === "exclude") reasons.push({ code: "time_unknown" });
    } else if (minutes > criteria.maxMinutes) {
      reasons.push({ code: "too_long", minutes, maxMinutes: criteria.maxMinutes });
    }
  }

  if (criteria.ownedEquipment !== undefined) {
    const missing = (recipe.equipment ?? []).filter(
      (e) => !equipmentSatisfied(e, criteria.ownedEquipment as readonly string[]),
    );
    if (missing.length > 0) reasons.push({ code: "missing_equipment", equipment: missing });
  }

  const excludedFoods = criteria.excludedFoods ?? [];
  const allergens = (criteria.allergens ?? []).filter((a) => a.trim() !== "");
  if (excludedFoods.length === 0 && allergens.length === 0) return reasons;

  const assessment = assessRecipe(
    {
      ...(recipe.title !== undefined ? { title: recipe.title } : {}),
      ingredients: recipe.ingredients.map((ing) => subjectOf(ing, criteria)),
      steps: (recipe.steps ?? []).map((s) => s.text),
    },
    {
      allergens,
      excludedFoods: excludedFoods.flatMap((f) => (typeof f === "string" ? [f] : f.name ? [f.name] : [])),
    },
  );

  if (excludedFoods.length > 0) {
    const hit = new Set<string>();
    // per identificativo e per somiglianza di nome, come prima del motore unico
    for (const f of excludedFoods) {
      const ref: FoodRef = typeof f === "string" ? { name: f } : f;
      for (const ing of recipe.ingredients) {
        const m = bestMatches(ref, [ing], (x) => ({
          name: x.name,
          ...(x.foodId ? { foodId: x.foodId } : {}),
        }));
        if (m.length > 0) hit.add(ing.name);
      }
    }
    for (const e of assessment.exclusions) for (const i of e.ingredients) hit.add(i.name);
    const steps = unique(assessment.exclusions.flatMap((e) => e.steps.map((s) => s.text)));
    const inTitle = assessment.exclusions.some((e) => e.title !== undefined);
    if (hit.size > 0 || steps.length > 0 || inTitle) {
      const ingredients = recipe.ingredients.map((i) => i.name).filter((n) => hit.has(n));
      reasons.push({
        code: "excluded_food",
        ingredients: unique(ingredients),
        ...(steps.length > 0 ? { steps } : {}),
        ...(inTitle ? { inTitle: true as const } : {}),
      });
    }
  }

  for (const a of assessment.allergens) {
    const ingredients = unique(a.ingredients.map((i) => i.name));
    if (a.verdict === "uncertain") {
      reasons.push({ code: "allergen_uncertain", allergen: a.allergen, ingredients });
      continue;
    }
    const steps = unique(a.steps.map((s) => s.text));
    reasons.push({
      code: "allergen",
      allergen: a.allergen,
      ingredients,
      ...(steps.length > 0 ? { steps } : {}),
      ...(a.title ? { inTitle: true as const } : {}),
    });
  }
  return reasons;
}

/**
 * Separa le ricette che passano i criteri da quelle escluse, con i motivi. L'ordine è conservato. Una ricetta con un
 * ingrediente di cui non si sa se contiene un allergene dichiarato è esclusa con il motivo `allergen_uncertain`: non è
 * mai mostrata come compatibile.
 */
export function filterRecipes<T extends Filterable>(
  recipes: readonly T[],
  criteria: FilterCriteria,
): FilterResult<T> {
  const kept: T[] = [];
  const excluded: { recipe: T; reasons: ExclusionReason[] }[] = [];
  for (const recipe of recipes) {
    const reasons = exclusionReasons(recipe, criteria);
    if (reasons.length === 0) kept.push(recipe);
    else excluded.push({ recipe, reasons });
  }
  return { kept, excluded };
}
