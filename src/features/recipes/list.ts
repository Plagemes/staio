// Elenco del ricettario: confronto con la dispensa, ricerca, filtri e ordinamenti. Logica pura.
import type { Lot } from "@/core/ledger";
import {
  ALLERGEN_STEMS,
  compareWithPantry,
  filterRecipes,
  rankByExpiring,
  stockFromLots,
  totalMinutes,
  type Availability,
  type ExpiringFood,
  type IngredientAvailability,
  type PantryComparison,
  type PantryStock,
  type Quantity,
  type Recipe,
  type RecipeIngredient,
} from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { evaluateLots, isExpiring } from "../lots";
import { fold } from "./common";

/** Dispensa vista dal ricettario: giacenze e alimenti che stanno scadendo. */
export interface PantryView {
  stock: PantryStock[];
  expiring: ExpiringFood[];
}

/** Dai lotti attivi: giacenze per prodotto e alimenti scaduti o in scadenza entro tre giorni. */
export function pantryView(activeLots: readonly Lot[], now: string): PantryView {
  const entries = evaluateLots(activeLots, now);
  const expiring: ExpiringFood[] = entries
    .filter((e) => isExpiring(e) && e.urgency !== undefined)
    .map((e) => ({ name: e.lot.productRef, daysLeft: (e.urgency as { daysLeft: number }).daysLeft }));
  return { stock: stockFromLots(activeLots), expiring };
}

export interface RecipeRow {
  recipe: Recipe;
  total: number;
  available: number;
  partial: number;
  missing: number;
  /** In dispensa c'è qualcosa di simile: l'utente deve confermare che è lo stesso alimento. Non conta tra i disponibili. */
  toConfirm: number;
  /** C'è, ma in un'unità che non si confronta: la quantità non è nota. Non conta tra i disponibili. */
  unquantified: number;
  /** Nomi degli ingredienti che non ci sono (del tutto o in parte). */
  missingNames: string[];
  /** Alimenti in scadenza che la ricetta usa, dal più urgente. */
  expiringUses: { name: string; daysLeft: number }[];
  expiringScore: number;
  /** Quota di ingredienti disponibili, da 0 a 1. */
  coverage: number;
  minutes?: number;
}

/** Una riga per ricetta, con il confronto con la dispensa e l'uso di ciò che scade. */
export function buildRows(recipes: readonly Recipe[], pantry: PantryView): RecipeRow[] {
  const ranks = new Map<string, { score: number; uses: { name: string; daysLeft: number }[] }>();
  for (const r of rankByExpiring(recipes, pantry.expiring)) {
    ranks.set(r.recipe.recipeId, {
      score: r.score,
      uses: r.uses
        .map((u) => ({ name: u.food.name ?? "", daysLeft: u.food.daysLeft }))
        .filter((u) => u.name !== "")
        .sort((a, b) => a.daysLeft - b.daysLeft),
    });
  }
  return recipes.map((recipe) => {
    const cmp = compareWithPantry(recipe, pantry.stock);
    const rank = ranks.get(recipe.recipeId);
    const minutes = totalMinutes(recipe);
    if (!cmp.ok) {
      return {
        recipe,
        total: recipe.ingredients.length,
        available: 0,
        partial: 0,
        missing: recipe.ingredients.length,
        toConfirm: 0,
        unquantified: 0,
        missingNames: recipe.ingredients.map((i) => i.name),
        expiringUses: rank?.uses ?? [],
        expiringScore: rank?.score ?? 0,
        coverage: 0,
        ...(minutes !== undefined ? { minutes } : {}),
      };
    }
    const c = cmp.value;
    return {
      recipe,
      total: c.items.length,
      available: c.counts.available,
      partial: c.counts.partial,
      missing: c.counts.missing,
      toConfirm: c.counts.to_confirm,
      unquantified: c.counts.unquantified,
      missingNames: c.items.filter((i) => i.status === "partial" || i.status === "missing").map((i) => i.ingredient.name),
      expiringUses: rank?.uses ?? [],
      expiringScore: rank?.score ?? 0,
      coverage: c.coverage,
      ...(minutes !== undefined ? { minutes } : {}),
    };
  });
}

export type SortKey = "title" | "pantry" | "expiring";

export const SORT_LABELS: Record<SortKey, string> = {
  title: "Nome",
  pantry: "Con ciò che hai",
  expiring: "Per usare ciò che scade",
};

const byTitle = (a: RecipeRow, b: RecipeRow): number =>
  a.recipe.title.localeCompare(b.recipe.title, "it") || a.recipe.recipeId.localeCompare(b.recipe.recipeId);

export function sortRows(rows: readonly RecipeRow[], key: SortKey): RecipeRow[] {
  const out = [...rows];
  if (key === "title") return out.sort(byTitle);
  if (key === "pantry") {
    return out.sort((a, b) => b.coverage - a.coverage || a.missing + a.partial - (b.missing + b.partial) || byTitle(a, b));
  }
  return out.sort((a, b) => b.expiringScore - a.expiringScore || b.coverage - a.coverage || byTitle(a, b));
}

export interface ListFilters {
  query: string;
  /** La ricetta deve avere tutte queste etichette. */
  tags: readonly string[];
  maxMinutes?: number;
  /** Se definita, restano solo le ricette che si fanno con questa attrezzatura. */
  ownedEquipment?: readonly string[];
  /** Allergeni da evitare (chiavi di `ALLERGEN_STEMS`). */
  allergens: readonly string[];
  /** Alimenti da escludere, scritti a mano. */
  excludedFoods: readonly string[];
}

export const NO_FILTERS: ListFilters = { query: "", tags: [], allergens: [], excludedFoods: [] };

export const ALLERGEN_NAMES: readonly string[] = Object.keys(ALLERGEN_STEMS);

export function filtersActive(f: ListFilters): boolean {
  return (
    f.query.trim() !== "" ||
    f.tags.length > 0 ||
    f.maxMinutes !== undefined ||
    f.ownedEquipment !== undefined ||
    f.allergens.length > 0 ||
    f.excludedFoods.length > 0
  );
}

function matchesQuery(recipe: Recipe, query: string): boolean {
  const q = fold(query);
  if (q === "") return true;
  const haystack = fold(
    [recipe.title, ...recipe.ingredients.map((i) => i.name), ...recipe.tags, ...recipe.equipment].join(" "),
  );
  return q.split(" ").every((word) => haystack.includes(word));
}

/** Applica ricerca ed esclusioni. `hidden` conta le ricette tolte dai filtri (non dalla ricerca). */
export function applyFilters(rows: readonly RecipeRow[], f: ListFilters): { rows: RecipeRow[]; hidden: number } {
  const searched = rows.filter((r) => matchesQuery(r.recipe, f.query));
  const tagged =
    f.tags.length === 0
      ? searched
      : searched.filter((r) => f.tags.every((t) => r.recipe.tags.some((x) => fold(x) === fold(t))));
  const { kept } = filterRecipes(
    tagged.map((r) => r.recipe),
    {
    ...(f.maxMinutes !== undefined ? { maxMinutes: f.maxMinutes, unknownTime: "include" as const } : {}),
    ...(f.ownedEquipment !== undefined ? { ownedEquipment: f.ownedEquipment } : {}),
    ...(f.excludedFoods.length > 0 ? { excludedFoods: f.excludedFoods } : {}),
    ...(f.allergens.length > 0 ? { allergens: f.allergens } : {}),
    },
  );
  const keptSet = new Set(kept.map((r) => r.recipeId));
  const out = tagged.filter((r) => keptSet.has(r.recipe.recipeId));
  return { rows: out, hidden: tagged.length - out.length };
}

function uniqueSorted(values: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) if (!seen.has(fold(v))) seen.set(fold(v), v);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "it"));
}

export const allTags = (recipes: readonly Recipe[]): string[] => uniqueSorted(recipes.flatMap((r) => r.tags));
export const allEquipment = (recipes: readonly Recipe[]): string[] => uniqueSorted(recipes.flatMap((r) => r.equipment));

/** "7 ingredienti, 5 in casa". */
export function countsText(row: RecipeRow): string {
  const n = row.total;
  const noun = n === 1 ? "1 ingrediente" : `${n} ingredienti`;
  if (n === 0) return "Nessun ingrediente";
  if (row.available === n) return `${noun}: li hai tutti`;
  const check = row.toConfirm + row.unquantified;
  const base = `${noun}, ${row.available === 0 ? "nessuno in casa" : `${row.available} in casa`}`;
  return check > 0 ? `${base}, ${check} da controllare` : base;
}

/** "Mancano: pomodori, basilico e altri 2". */
export function missingText(row: RecipeRow, shown = 3): string | undefined {
  if (row.missingNames.length === 0) return undefined;
  const names = row.missingNames.slice(0, shown).map((n) => n.toLowerCase());
  const rest = row.missingNames.length - names.length;
  if (rest > 0) return `Mancano: ${names.join(", ")} e altri ${rest}`;
  if (names.length === 1) return `Manca: ${names[0]}`;
  return `Mancano: ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** "Usa zucchine (scade domani)". */
export function expiringText(row: RecipeRow, shown = 2): string | undefined {
  if (row.expiringUses.length === 0) return undefined;
  const parts = row.expiringUses.slice(0, shown).map((u) => {
    const when = u.daysLeft < 0 ? "è scaduto" : u.daysLeft === 0 ? "scade oggi" : u.daysLeft === 1 ? "scade domani" : `scade tra ${u.daysLeft} giorni`;
    return `${u.name.toLowerCase()} (${when})`;
  });
  const rest = row.expiringUses.length - parts.length;
  return `Usa ${parts.join(", ")}${rest > 0 ? ` e altri ${rest}` : ""}`;
}

export interface AvailabilityLabel {
  text: string;
  tone: "ok" | "partial" | "missing" | "neutral";
}

/** Risposta dell'utente a «È questo?» per un ingrediente da confermare, per indice. */
export type Answers = Readonly<Record<number, "yes" | "no">>;

/** Disponibilità di un ingrediente in dispensa, a parole: «hai 500 g», «hai 100 g, mancano 50 g», «manca». */
export function availabilityLabel(item: IngredientAvailability, answer?: "yes" | "no"): AvailabilityLabel {
  const q = (x: Quantity) => formatQuantity(x);
  switch (item.status) {
    case "available":
      if (item.check === "presence") return { text: "in casa", tone: "ok" };
      return { text: item.available ? `hai ${q(item.available)}` : "in casa", tone: "ok" };
    case "partial":
      return {
        text: `hai ${item.available ? q(item.available) : "un po'"}, ${item.shortfall ? `mancano ${q(item.shortfall)}` : "non basta"}`,
        tone: "partial",
      };
    case "missing":
      return { text: "manca", tone: "missing" };
    case "unquantified":
      return { text: "c'è, quantità non confrontabile", tone: "neutral" };
    case "to_confirm":
      if (answer === "yes") return { text: "in casa (confermato)", tone: "ok" };
      if (answer === "no") return { text: "manca", tone: "missing" };
      return { text: "da confermare", tone: "neutral" };
  }
}

/** Stato effettivo di un ingrediente dopo le risposte: «sì» lo rende disponibile, «no» mancante. */
export function effectiveStatus(item: IngredientAvailability, answer?: "yes" | "no"): Availability {
  if (item.status !== "to_confirm") return item.status;
  return answer === "yes" ? "available" : answer === "no" ? "missing" : "to_confirm";
}

/** Ingredienti da comprare: quelli parziali o mancanti, più i «da confermare» a cui l'utente ha risposto «no». */
export function shortfallsWith(comparison: PantryComparison, answers: Answers): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  for (const item of comparison.items) {
    const status = effectiveStatus(item, answers[item.index]);
    if (item.status === "to_confirm" && status === "missing") {
      const { name, foodId, note } = item.ingredient;
      out.push({ name, ...(item.needed ? { quantity: item.needed } : {}), ...(foodId ? { foodId } : {}), ...(note ? { note } : {}) });
    } else if (status === "partial" || status === "missing") {
      const { name, foodId, note } = item.ingredient;
      const quantity = item.shortfall ?? item.needed;
      out.push({ name, ...(quantity ? { quantity } : {}), ...(foodId ? { foodId } : {}), ...(note ? { note } : {}) });
    }
  }
  return out;
}

/** Ingredienti ancora da confermare, per mostrare «È questo?». */
export function pendingConfirmations(comparison: PantryComparison, answers: Answers): IngredientAvailability[] {
  return comparison.items.filter((i) => i.status === "to_confirm" && answers[i.index] === undefined);
}
