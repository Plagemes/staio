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
 * I 14 allergeni da dichiarare nell'Unione europea, con radici di parole italiane e inglesi.
 * È una prima difesa sul nome dell'ingrediente: non sa nulla di ciò che non è scritto
 * (ingredienti composti, tracce). Chi ha un'allergia grave deve sempre leggere le etichette.
 */
export const ALLERGEN_STEMS: Readonly<Record<string, readonly string[]>> = {
  glutine: [
    "farin", "grano", "frument", "pasta", "pane", "pangrattat", "semol", "orzo", "farro", "segale",
    "avena", "kamut", "couscous", "seitan", "biscott", "cracker", "grissin", "fette biscottate",
    "gnocch", "lasagn", "spaghett", "penne", "tagliatell", "maccheron", "fusill", "rigaton",
    "wheat", "flour", "bread", "barley", "rye", "pasta", "breadcrumb", "malto",
  ],
  latte: [
    "latte", "burro", "formaggi", "panna", "yogurt", "parmigian", "grana", "mozzarell", "ricott",
    "mascarpon", "pecorin", "gorgonzol", "besciamell", "provol", "fontina", "stracchin", "caciott",
    "philadelphia", "latticin", "milk", "butter", "cheese", "cream", "whey", "siero di latte",
    "caseina", "kefir",
  ],
  uova: ["uov", "albume", "tuorl", "maionese", "egg$", "eggs$", "meringh", "zabaione"],
  pesce: [
    "pesce", "salmone", "tonno", "merluzz", "baccalà", "baccala", "stoccafisso", "acciug",
    "alici", "sardin", "sgombro", "trota", "branzino", "orata", "spigola", "dentice", "sogliola",
    "halibut", "fish", "anchov", "tuna", "cod$", "colatura",
  ],
  crostacei: ["gambero", "gamberi", "gamberett", "scamp", "aragost", "granchi", "astice", "mazzancoll", "shrimp", "prawn", "crab", "lobster", "crostace"],
  molluschi: ["cozz", "vongol", "calamar", "polpo", "seppi", "totan", "ostric", "capesant", "lumach", "mollusch", "squid", "octopus", "oyster", "clam", "mussel"],
  arachidi: ["arachid", "noccioline", "peanut"],
  "frutta a guscio": [
    "noci", "noce$", "mandorl", "nocciol", "pistacch", "anacard", "pinoli", "pecan",
    "macadamia", "castagn", "frutta secca", "gianduia", "nutella", "marzapane", "almond", "hazelnut",
    "walnut", "cashew", "pistachio",
  ],
  soia: ["soia", "soy", "tofu", "tempeh", "edamame", "miso"],
  sedano: ["sedano", "celery"],
  senape: ["senape", "mustard"],
  sesamo: ["sesamo", "sesame", "tahin", "tahini"],
  lupini: ["lupin"],
  solfiti: ["solfit", "vino", "aceto", "uvetta", "uva passa", "sulphite", "sulfite", "wine"],
};

const ALLERGEN_ALIASES: Readonly<Record<string, string>> = {
  glutine: "glutine",
  gluten: "glutine",
  celiachia: "glutine",
  latte: "latte",
  lattosio: "latte",
  latticini: "latte",
  milk: "latte",
  dairy: "latte",
  uova: "uova",
  uovo: "uova",
  eggs: "uova",
  egg: "uova",
  pesce: "pesce",
  fish: "pesce",
  crostacei: "crostacei",
  shellfish: "crostacei",
  molluschi: "molluschi",
  arachidi: "arachidi",
  peanuts: "arachidi",
  "frutta a guscio": "frutta a guscio",
  "frutta secca": "frutta a guscio",
  noci: "frutta a guscio",
  nuts: "frutta a guscio",
  "tree nuts": "frutta a guscio",
  soia: "soia",
  soy: "soia",
  sedano: "sedano",
  celery: "sedano",
  senape: "senape",
  mustard: "senape",
  sesamo: "sesamo",
  sesame: "sesamo",
  lupini: "lupini",
  solfiti: "solfiti",
  sulphites: "solfiti",
  sulfites: "solfiti",
};

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const words = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter((w) => w !== "");

/** Il nome dell'ingrediente contiene una radice dell'allergene (con `$` finale: la parola intera). */
function nameHasStem(name: string, stems: readonly string[]): boolean {
  const ws = words(name);
  const joined = ` ${ws.join(" ")} `;
  return stems.some((st) => {
    const stem = fold(st);
    if (stem.endsWith("$")) return ws.includes(stem.slice(0, -1));
    if (stem.includes(" ")) return joined.includes(` ${stem}`);
    return ws.some((w) => w.startsWith(stem));
  });
}

function canonicalAllergen(a: string): string | undefined {
  return ALLERGEN_ALIASES[fold(a).trim()];
}

/** Allergeni (come chiavi di `ALLERGEN_STEMS`) che un ingrediente sembra contenere, dal suo nome. */
export function allergensOfIngredient(ingredient: Pick<RecipeIngredient, "name">): string[] {
  const out: string[] = [];
  for (const [key, stems] of Object.entries(ALLERGEN_STEMS)) {
    // "noce moscata" è una spezia, non frutta a guscio.
    const name = key === "frutta a guscio" ? ingredient.name.replace(/noce\s+moscata/gi, " ") : ingredient.name;
    if (nameHasStem(name, stems)) out.push(key);
  }
  return out;
}

export type ExclusionReason =
  | { code: "too_long"; minutes: number; maxMinutes: number }
  | { code: "time_unknown" }
  | { code: "missing_equipment"; equipment: string[] }
  | { code: "excluded_food"; ingredients: string[] }
  | { code: "allergen"; allergen: string; ingredients: string[] };

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

  if (criteria.excludedFoods && criteria.excludedFoods.length > 0) {
    const hit = new Set<string>();
    for (const f of criteria.excludedFoods) {
      const ref: FoodRef = typeof f === "string" ? { name: f } : f;
      for (const ing of recipe.ingredients) {
        const m = bestMatches(ref, [ing], (x) => ({
          name: x.name,
          ...(x.foodId ? { foodId: x.foodId } : {}),
        }));
        if (m.length > 0) hit.add(ing.name);
      }
    }
    if (hit.size > 0) reasons.push({ code: "excluded_food", ingredients: [...hit] });
  }

  if (criteria.allergens && criteria.allergens.length > 0) {
    const byAllergen = new Map<string, Set<string>>();
    for (const requested of criteria.allergens) {
      const key = canonicalAllergen(requested);
      for (const ing of recipe.ingredients) {
        const declared = (criteria.allergensOf?.(ing) ?? []).map((a) => canonicalAllergen(a) ?? fold(a).trim());
        const own = key ? allergensOfIngredient(ing) : [];
        const label = key ?? fold(requested).trim();
        // Allergene sconosciuto: si cerca la parola così com'è.
        const literal = !key && label !== "" && nameHasStem(ing.name, [label]);
        if ((key && (own.includes(key) || declared.includes(key))) || declared.includes(label) || literal) {
          const set = byAllergen.get(label) ?? new Set<string>();
          set.add(ing.name);
          byAllergen.set(label, set);
        }
      }
    }
    for (const [allergen, ings] of byAllergen) {
      reasons.push({ code: "allergen", allergen, ingredients: [...ings] });
    }
  }
  return reasons;
}

/** Separa le ricette che passano i criteri da quelle escluse, con i motivi. L'ordine è conservato. */
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
