/**
 * Registro delle ricette. Per aggiungere ricette: creare un file `catalog/<nome>.ts` che esporta
 * un elenco di `Recipe` e aggiungerlo all'elenco `SOURCES` qui sotto.
 */
import { CATEGORIES, parseRecipe, type Category, type Recipe } from "../recipe";
import { SEED_RECIPES } from "./seed";
import { fruttaRecipes } from "./frutta";
import { fruttaSeccaRecipes } from "./fruttaSecca";
import { verduraRecipes } from "./verdura";
import { erbeRecipes } from "./erbe";
import { latticiniRecipes } from "./latticini";
import { carnePesceRecipes } from "./carnePesce";
import { dispensaRecipes } from "./dispensa";
import { bevandeRecipes } from "./bevande";
import { fornoRecipes } from "./forno";
import { contenitoriRecipes } from "./contenitori";

const SOURCES: readonly (readonly Recipe[])[] = [
  SEED_RECIPES,
  fruttaRecipes,
  fruttaSeccaRecipes,
  verduraRecipes,
  erbeRecipes,
  latticiniRecipes,
  carnePesceRecipes,
  dispensaRecipes,
  bevandeRecipes,
  fornoRecipes,
  contenitoriRecipes,
];

const registry = new Map<string, Recipe>();

/** Registra ricette (validate). Lancia se una ricetta è malformata o l'id è già presente. */
export function registerRecipes(recipes: readonly Recipe[]): void {
  for (const input of recipes) {
    const recipe = parseRecipe(input);
    if (registry.has(recipe.id)) throw new Error(`Ricetta «${recipe.id}» già registrata`);
    registry.set(recipe.id, recipe);
  }
}

for (const source of SOURCES) registerRecipes(source);

export function getRecipe(id: string): Recipe | undefined {
  return registry.get(id);
}

export function listRecipes(): Recipe[] {
  return [...registry.values()];
}

export function listCategories(): Category[] {
  const used = new Set(listRecipes().map((r) => r.category));
  return CATEGORIES.filter((c) => used.has(c));
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * Cerca per nome (senza accenti né maiuscole) e, se indicata, per categoria.
 * Prima i nomi che iniziano con la ricerca, poi quelli che la contengono, poi per ordine alfabetico.
 */
export function searchRecipes(query = "", category?: Category): Recipe[] {
  const q = fold(query);
  const scored: { recipe: Recipe; rank: number; name: string }[] = [];
  for (const recipe of registry.values()) {
    if (category && recipe.category !== category) continue;
    const name = fold(recipe.name);
    let rank: number;
    if (q === "") rank = 2;
    else if (name.startsWith(q)) rank = 0;
    else if (name.split(/[\s']+/).some((w) => w.startsWith(q))) rank = 1;
    else if (name.includes(q) || recipe.id.includes(q.replace(/\s+/g, "-"))) rank = 2;
    else continue;
    scored.push({ recipe, rank, name });
  }
  return scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "it")).map((s) => s.recipe);
}
