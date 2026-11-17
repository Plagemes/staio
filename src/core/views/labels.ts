// Nomi italiani, periodi e gruppi di categorie usati dalle interrogazioni. Solo dati e formattazione.
import type { NutrientKey } from "../nutrition";

export interface NutrientInfo {
  label: string;
  unit: string;
  /** Cifre decimali mostrate. */
  digits: number;
}

export const NUTRIENT_INFO: Record<NutrientKey, NutrientInfo> = {
  energyKcal: { label: "Energia", unit: "kcal", digits: 0 },
  proteinG: { label: "Proteine", unit: "g", digits: 0 },
  carbsG: { label: "Carboidrati", unit: "g", digits: 0 },
  sugarsG: { label: "Zuccheri", unit: "g", digits: 0 },
  fatG: { label: "Grassi", unit: "g", digits: 0 },
  saturatedFatG: { label: "Grassi saturi", unit: "g", digits: 1 },
  monounsaturatedFatG: { label: "Grassi monoinsaturi", unit: "g", digits: 1 },
  polyunsaturatedFatG: { label: "Grassi polinsaturi", unit: "g", digits: 1 },
  omega3G: { label: "Omega 3", unit: "g", digits: 1 },
  fiberG: { label: "Fibre", unit: "g", digits: 0 },
  saltG: { label: "Sale", unit: "g", digits: 1 },
  waterG: { label: "Acqua negli alimenti", unit: "g", digits: 0 },
  cholesterolMg: { label: "Colesterolo", unit: "mg", digits: 0 },
  calciumMg: { label: "Calcio", unit: "mg", digits: 0 },
  ironMg: { label: "Ferro", unit: "mg", digits: 1 },
  magnesiumMg: { label: "Magnesio", unit: "mg", digits: 0 },
  phosphorusMg: { label: "Fosforo", unit: "mg", digits: 0 },
  potassiumMg: { label: "Potassio", unit: "mg", digits: 0 },
  zincMg: { label: "Zinco", unit: "mg", digits: 1 },
  seleniumUg: { label: "Selenio", unit: "µg", digits: 0 },
  iodineUg: { label: "Iodio", unit: "µg", digits: 0 },
  vitaminAUg: { label: "Vitamina A", unit: "µg", digits: 0 },
  vitaminCMg: { label: "Vitamina C", unit: "mg", digits: 0 },
  vitaminDUg: { label: "Vitamina D", unit: "µg", digits: 1 },
  vitaminEMg: { label: "Vitamina E", unit: "mg", digits: 1 },
  vitaminKUg: { label: "Vitamina K", unit: "µg", digits: 0 },
  thiaminMg: { label: "Tiamina (B1)", unit: "mg", digits: 2 },
  riboflavinMg: { label: "Riboflavina (B2)", unit: "mg", digits: 2 },
  niacinMg: { label: "Niacina (B3)", unit: "mg", digits: 1 },
  vitaminB6Mg: { label: "Vitamina B6", unit: "mg", digits: 2 },
  folateUg: { label: "Folato", unit: "µg", digits: 0 },
  vitaminB12Ug: { label: "Vitamina B12", unit: "µg", digits: 1 },
  alcoholG: { label: "Alcol", unit: "g", digits: 1 },
  caffeineMg: { label: "Caffeina", unit: "mg", digits: 0 },
};

/** Gruppi di categorie di alimenti: i valori ammessi per il parametro `group`. */
export const CATEGORY_GROUPS = {
  meat_fish: { label: "Carne, pesce e salumi", categories: ["red_meat_fresh", "ground_meat", "poultry", "fish_fresh", "cold_cuts_sliced", "cured_meat_whole"] },
  dairy: { label: "Latte e latticini", categories: ["milk_fresh", "milk_uht", "yogurt", "cheese_fresh", "cheese_aged", "butter"] },
  eggs: { label: "Uova", categories: ["eggs"] },
  vegetables: { label: "Verdura", categories: ["leafy_vegetables", "root_vegetables", "other_vegetables"] },
  fruit: { label: "Frutta", categories: ["fruit_fresh", "berries", "citrus"] },
  grains: { label: "Pane, pasta, cereali e legumi", categories: ["bread_fresh", "bread_packaged", "pasta_fresh", "pasta_dry", "rice_cereals", "legumes_dry"] },
  sweets_snacks: { label: "Dolci e snack", categories: ["pastries_fresh", "snacks_dry"] },
  canned_condiments: { label: "Conserve e condimenti", categories: ["canned_closed", "sauces_preserves_opened", "condiments_sauces"] },
  beverages: { label: "Bevande", categories: ["beverages", "juices_opened"] },
  ready_frozen: { label: "Piatti pronti e surgelati", categories: ["leftovers_cooked", "ready_meals", "frozen_foods"] },
} as const satisfies Record<string, { label: string; categories: readonly string[] }>;

export type CategoryGroupId = keyof typeof CATEGORY_GROUPS;
export const CATEGORY_GROUP_IDS = Object.keys(CATEGORY_GROUPS) as CategoryGroupId[];

const GROUP_OF_CATEGORY = new Map<string, CategoryGroupId>(
  CATEGORY_GROUP_IDS.flatMap((id) => CATEGORY_GROUPS[id].categories.map((c): [string, CategoryGroupId] => [c, id])),
);

/** Gruppo di una categoria del libro mastro (stringa libera); undefined se non è una categoria nota. */
export function groupOfCategory(category: string | undefined): CategoryGroupId | undefined {
  return category === undefined ? undefined : GROUP_OF_CATEGORY.get(category);
}

export const DISCARD_REASON_LABELS: Record<string, string> = {
  expired: "Scaduto",
  leftover: "Avanzato",
  disliked: "Non mi è piaciuto",
  other: "Altro motivo",
};

export const LOCATION_NAMES: Record<string, string> = {
  frigo: "frigo",
  freezer: "freezer",
  dispensa: "credenza",
};

export const UNIT_NAMES: Record<string, string> = { g: "Grammi", ml: "Millilitri", pz: "Pezzi" };

const formatters = new Map<number, Intl.NumberFormat>();

/** Numero all'italiana ("1.240,5"), con al massimo `digits` decimali. */
export function formatNumber(value: number, digits = 0): string {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f.format(Number.isFinite(value) ? value : 0);
}

const euros = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** "1.240 kcal", "3,50 €". */
export function formatWithUnit(value: number, unit: string, digits = 0): string {
  return unit === "€" ? euros.format(value) : `${formatNumber(value, digits)} ${unit}`;
}

export const formatCents = (cents: number): string => formatWithUnit(cents / 100, "€", 2);

/** Quantità in unità base (g, ml, pz). */
export const formatQty = (value: number, unit: string): string => `${formatNumber(value, value < 10 ? 1 : 0)} ${unit}`;

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${formatNumber(n)} ${many}`;
}

/** "12/11" da una data di calendario. */
export const shortDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
