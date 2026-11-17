/**
 * Colori degli alimenti per lo stile a colori. Funzioni pure, senza three né DOM.
 *
 * Un colore si ricava così, dal più specifico al più generico:
 *   1. il campo `color` della ricetta;
 *   2. la tabella dei colori specifici per id (`catalog/foodColors.ts`);
 *   3. il predefinito di categoria e di archetipo (un frutto prende il colore della frutta, una scatola il cartone).
 * Le parti che mancano (gambo, foglie, tappo, etichetta, buccia) si derivano dal colore principale e dalla categoria.
 */
import { FOOD_COLORS } from "./catalog/foodColors";
import { CATEGORIES, HEX_COLOR_RE, type Category, type Recipe, type RecipeColor } from "./recipe";

/** Tutte le parti colorabili di un modello: gli spazi di `RecipeColor` più pinne e occhi. */
export interface ResolvedColors {
  main: string;
  rind: string;
  stem: string;
  leaf: string;
  cap: string;
  label: string;
  seed: string;
  /** Pinne del pesce. */
  fin: string;
  /** Occhi del pesce. */
  eye: string;
}

/** `specific`: colore scritto nella ricetta o nella tabella degli alimenti. `default`: predefinito di categoria. */
export type ColorSource = "recipe" | "specific" | "default";

export interface ResolvedRecipeColors {
  colors: ResolvedColors;
  source: ColorSource;
}

/** Ultimo ripiego, mai usato per un alimento fresco. */
export const NEUTRAL_GRAY = "#aeb4ba";

export interface CategoryColor {
  /** Colore dell'alimento di quella categoria quando non se ne sa di più. */
  main: string;
  /** Colore dell'etichetta sulle confezioni della categoria. */
  label: string;
  stem: string;
  leaf: string;
}

const WOOD = "#7a5a3c";
const GREEN_LEAF = "#4fa74a";

export const CATEGORY_COLORS: Readonly<Record<Category, CategoryColor>> = {
  frutta: { main: "#f0553c", label: "#ff6b4a", stem: WOOD, leaf: GREEN_LEAF },
  verdura: { main: "#58b04a", label: "#3fae49", stem: "#6f9a46", leaf: GREEN_LEAF },
  erbe: { main: "#3e9b4f", label: "#2e9e6b", stem: "#7cbf6a", leaf: "#3e9b4f" },
  latticini: { main: "#f4f1e8", label: "#3f8fe8", stem: WOOD, leaf: GREEN_LEAF },
  formaggi: { main: "#f2c94c", label: "#f5b82e", stem: "#b8944a", leaf: GREEN_LEAF },
  uova: { main: "#f1e2c6", label: "#f2a03d", stem: WOOD, leaf: GREEN_LEAF },
  carne: { main: "#d4565a", label: "#e5484d", stem: "#d8c8a0", leaf: GREEN_LEAF },
  pesce: { main: "#7fb2d6", label: "#2f9ad6", stem: WOOD, leaf: "#5f95b8" },
  pane: { main: "#d69a55", label: "#c77d3a", stem: WOOD, leaf: GREEN_LEAF },
  "pasta-riso": { main: "#ecc86a", label: "#f0b429", stem: WOOD, leaf: GREEN_LEAF },
  dispensa: { main: "#c99a62", label: "#d9822b", stem: WOOD, leaf: GREEN_LEAF },
  conserve: { main: "#cf4a3c", label: "#d6453d", stem: WOOD, leaf: GREEN_LEAF },
  bevande: { main: "#4aa3df", label: "#2bb3c0", stem: WOOD, leaf: GREEN_LEAF },
  surgelati: { main: "#8fd3f0", label: "#5ac8fa", stem: WOOD, leaf: GREEN_LEAF },
  dolci: { main: "#b5703f", label: "#c45a8a", stem: WOOD, leaf: GREEN_LEAF },
  condimenti: { main: "#d9a520", label: "#b8a32a", stem: WOOD, leaf: GREEN_LEAF },
  altro: { main: NEUTRAL_GRAY, label: "#8e8e93", stem: WOOD, leaf: GREEN_LEAF },
};

/** Materiali delle confezioni, per le forme generiche. */
export const MATERIAL_COLORS = {
  cardboard: "#c9a777",
  glass: "#cfe6e3",
  tin: "#c7ced4",
  film: "#e9e5dc",
  tray: "#f1f3f2",
  plastic: "#d6ecf6",
  brick: "#f5f2e9",
  metalLid: "#c3cad1",
  cork: "#c8a06b",
  seed: "#2d2520",
  eye: "#15171a",
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mescola `a` verso `b` di una frazione `t` (0 = a, 1 = b), canale per canale. */
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const pa = parseHex(a);
  const pb = parseHex(b);
  return toHex([pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k]);
}

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_COLOR_RE.test(v);

/** Una ricetta è una confezione se è una scatola, un sacchetto o un solido di rotazione con tappo o etichetta. */
export function isPackaging(recipe: Pick<Recipe, "archetype" | "details">): boolean {
  if (recipe.archetype === "box" || recipe.archetype === "bag") return true;
  return recipe.archetype === "lathe" && !!(recipe.details?.cap || recipe.details?.label);
}

function defaultMain(recipe: Recipe): string {
  const cat = CATEGORY_COLORS[recipe.category];
  if (!isPackaging(recipe)) return cat.main;
  if (recipe.archetype === "box") return MATERIAL_COLORS.cardboard;
  if (recipe.archetype === "bag") return MATERIAL_COLORS.film;
  return MATERIAL_COLORS.glass;
}

/** Tappo: sughero se di sughero, metallo se è un coperchio, altrimenti dello stesso colore dell'etichetta. */
function defaultCap(recipe: Recipe, label: string): string {
  const kind = recipe.details?.cap?.kind ?? "screw";
  if (kind === "cork") return MATERIAL_COLORS.cork;
  if (kind === "lid") return MATERIAL_COLORS.metalLid;
  return label;
}

/** Predefiniti di categoria e archetipo, senza guardare la ricetta più di tanto: serve a un prodotto sconosciuto. */
export function defaultColorsFor(recipe: Recipe): ResolvedColors {
  return fill(recipe, undefined);
}

function fill(recipe: Recipe, given: RecipeColor | undefined): ResolvedColors {
  const cat = CATEGORY_COLORS[recipe.category];
  const main = given?.main ?? defaultMain(recipe);
  const isLeaves = recipe.archetype === "leaf";
  const label = given?.label ?? cat.label;
  return {
    main,
    rind: given?.rind ?? mixHex(main, "#000000", 0.28),
    stem: given?.stem ?? (isLeaves ? mixHex(main, "#ffffff", 0.35) : cat.stem),
    leaf: given?.leaf ?? (isLeaves ? main : cat.leaf),
    cap: given?.cap ?? defaultCap(recipe, label),
    label,
    seed: given?.seed ?? MATERIAL_COLORS.seed,
    fin: given?.leaf ?? mixHex(main, "#000000", 0.2),
    eye: MATERIAL_COLORS.eye,
  };
}

/** Colori di una ricetta, tutti validi (#rrggbb), con l'indicazione di dove vengono. Non lancia mai. */
export function resolveRecipeColors(recipe: Recipe): ResolvedRecipeColors {
  const specific = FOOD_COLORS[recipe.id];
  const own = recipe.color;
  const given: RecipeColor | undefined = own || specific ? ({ ...specific, ...own } as RecipeColor) : undefined;
  const safe = given && isHexColor(given.main) ? sanitize(given) : undefined;
  return { colors: fill(recipe, safe), source: safe ? (own ? "recipe" : "specific") : "default" };
}

function sanitize(given: RecipeColor): RecipeColor {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(given)) if (isHexColor(v)) out[k] = v;
  return out as unknown as RecipeColor;
}

/** Colore della categoria di un prodotto sconosciuto, per il generatore automatico. */
export function categoryColor(category: Category): CategoryColor {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.altro;
}

/**
 * Ricetta con i colori della categoria del prodotto, per chi non ha una ricetta propria (`fallback.ts`).
 * Una confezione tiene il materiale e prende l'etichetta della categoria; una forma di alimento prende il colore della categoria.
 */
export function withCategoryColor(recipe: Recipe, category: Category): Recipe {
  const cat = categoryColor(category);
  if (!isPackaging(recipe)) {
    if (recipe.archetype === "composite") return recipe;
    return { ...recipe, color: { main: cat.main, stem: cat.stem, leaf: cat.leaf } };
  }
  const given = { ...FOOD_COLORS[recipe.id], ...recipe.color };
  const main = isHexColor(given.main) ? given.main : defaultMain(recipe);
  return { ...recipe, color: { ...sanitize({ ...given, main }), label: cat.label } };
}

/** Categorie degli alimenti freschi: non devono mai ripiegare sul grigio. */
export const FRESH_CATEGORIES: readonly Category[] = ["frutta", "verdura", "erbe", "pesce", "carne", "uova", "latticini", "formaggi"];

export { CATEGORIES };

/**
 * A quale colore di `ResolvedColors` va una parte generata. Il nome distingue i dettagli che hanno il ruolo del corpo
 * (semi, occhi) o delle foglie (pinne).
 */
export function colorOfPart(colors: ResolvedColors, part: { role: string; name: string }): string {
  const name = part.name.slice(part.name.lastIndexOf(":") + 1);
  switch (part.role) {
    case "stem":
      return colors.stem;
    case "leaf":
      return name === "fins" ? colors.fin : colors.leaf;
    case "cap":
      return colors.cap;
    case "label":
      return colors.label;
    case "rind":
      return colors.rind;
    default:
      return name === "seeds" ? colors.seed : name === "eyes" ? colors.eye : colors.main;
  }
}
