import { parsePackageQuantity } from "./quantity";
import type { BaseUnit, NovaGroup, Nutrients, NutriScore, PackageQuantity, Product } from "./types";

/** Campi richiesti all'API: solo quelli che la scheda usa. */
export const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_it",
  "generic_name",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "packaging_tags",
  "categories_tags",
  "nutriments",
  "nova_group",
  "nutriscore_grade",
  "allergens_tags",
  "additives_tags",
  "additives_n",
  "image_front_small_url",
  "image_front_url",
] as const;

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** Numero finito e non negativo; accetta anche le stringhe numeriche che l'API a volte restituisce. */
function amount(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** "en:milk" diventa "milk". */
const stripLang = (tag: string) => tag.replace(/^[a-z]{2,3}:/i, "");

function tags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    const t = text(item);
    if (t) out.add(stripLang(t).toLowerCase());
  }
  return [...out];
}

/**
 * Elenco degli additivi. Un elenco vuoto vale "nessun additivo" solo se Open Food Facts ha analizzato gli
 * ingredienti: `additives_n` presente (anche 0), oppure `additives_tags` come elenco insieme a un testo degli
 * ingredienti non vuoto (quest'ultimo non si richiede all'API: un test della cattura vieta i campi degli ingredienti). Altrimenti il dato manca e `additives` resta assente.
 */
function additivesFrom(p: Json): string[] | undefined {
  const list = tags(p.additives_tags).map((a) => a.toUpperCase());
  if (list.length > 0) return list;
  const n = amount(p.additives_n);
  if (n === 0) return [];
  if (n !== undefined) return undefined;
  return Array.isArray(p.additives_tags) && text(p.ingredients_text) !== undefined ? [] : undefined;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function quantityFrom(p: Json): PackageQuantity | undefined {
  const label = text(p.quantity);
  const parsed = label ? parsePackageQuantity(label) : undefined;
  if (parsed?.value !== undefined) return parsed;

  const numeric = amount(p.product_quantity);
  const unitText = text(p.product_quantity_unit)?.toLowerCase();
  const unit: BaseUnit | undefined = unitText === "g" || unitText === "ml" ? unitText : undefined;
  // Senza l'unità dichiarata non si sa se sono grammi o millilitri: non si indovina.
  if (numeric !== undefined && numeric > 0 && unit) return { ...(parsed ?? {}), value: numeric, unit };
  return parsed;
}

function nutrientsFrom(p: Json, unit: BaseUnit | undefined): Nutrients | undefined {
  if (!isRecord(p.nutriments)) return undefined;
  const n = p.nutriments;

  let energyKcal = amount(n["energy-kcal_100g"]);
  if (energyKcal === undefined) {
    const kj = amount(n["energy-kj_100g"] ?? n["energy_100g"]);
    if (kj !== undefined) energyKcal = Math.round(kj / 4.184);
  }
  const out: Nutrients = { per: unit === "ml" ? "100ml" : "100g", certainty: "label" };
  const values = {
    energyKcal,
    proteins: amount(n["proteins_100g"]),
    carbohydrates: amount(n["carbohydrates_100g"]),
    sugars: amount(n["sugars_100g"]),
    fat: amount(n["fat_100g"]),
    saturatedFat: amount(n["saturated-fat_100g"]),
    fiber: amount(n["fiber_100g"]),
    salt: amount(n["salt_100g"]),
  };
  let any = false;
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    const value = values[key];
    if (value === undefined) continue;
    out[key] = key === "energyKcal" ? value : round(value, 2);
    any = true;
  }
  return any ? out : undefined;
}

function novaFrom(v: unknown): NovaGroup | undefined {
  const n = amount(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : undefined;
}

function nutriScoreFrom(v: unknown): NutriScore | undefined {
  const t = text(v)?.toLowerCase();
  return t === "a" || t === "b" || t === "c" || t === "d" || t === "e" ? t : undefined;
}

function imageFrom(p: Json): string | undefined {
  for (const key of ["image_front_small_url", "image_front_url"]) {
    const url = text(p[key]);
    if (url?.startsWith("https://")) return url;
  }
  return undefined;
}

function firstBrand(v: unknown): string | undefined {
  const t = text(v);
  return t ? text(t.split(",")[0]) : undefined;
}

export interface FromOffOptions {
  /** Istante della lettura, ISO 8601 UTC. Di norma l'ora attuale. */
  fetchedAt?: string;
  /** Codice richiesto, usato se la risposta non lo riporta. */
  barcode?: string;
}

/**
 * Trasforma la risposta di `/api/v2/product/<codice>.json` in un `Product`.
 * Restituisce `null` se il prodotto non c'è. I campi mancanti o non validi restano assenti.
 */
export function productFromOpenFoodFacts(json: unknown, options: FromOffOptions = {}): Product | null {
  if (!isRecord(json)) return null;
  if (json.status !== undefined && json.status !== 1 && json.status !== "1") return null;
  if (!isRecord(json.product)) return null;
  const p = json.product;

  const code = text(json.code) ?? text(p.code) ?? options.barcode;
  if (!code || !/^\d+$/.test(code)) return null;

  const quantity = quantityFrom(p);
  const categories = tags(p.categories_tags);
  const packaging = tags(p.packaging_tags);
  const allergens = tags(p.allergens_tags);
  const additives = additivesFrom(p);
  const nutrients = nutrientsFrom(p, quantity?.unit);

  const product: Product = {
    barcode: code,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    source: "openfoodfacts",
  };
  const name = text(p.product_name_it) ?? text(p.product_name) ?? text(p.generic_name);
  if (name) product.name = name;
  const brand = firstBrand(p.brands);
  if (brand) product.brand = brand;
  if (quantity) product.quantity = quantity;
  if (packaging.length > 0) product.packaging = packaging;
  if (categories.length > 0) product.categories = categories;
  if (nutrients) product.nutrients = nutrients;
  const nova = novaFrom(p.nova_group);
  if (nova) product.nova = nova;
  const nutriScore = nutriScoreFrom(p.nutriscore_grade);
  if (nutriScore) product.nutriScore = nutriScore;
  if (allergens.length > 0) product.allergens = allergens;
  if (additives) product.additives = additives;
  const imageUrl = imageFrom(p);
  if (imageUrl) product.imageUrl = imageUrl;
  return product;
}

/** Riconosce un `Product` letto dall'archivio locale: controlla solo la forma essenziale. */
export function isStoredProduct(data: unknown): data is Product {
  return (
    isRecord(data) &&
    typeof data.barcode === "string" &&
    /^\d+$/.test(data.barcode) &&
    typeof data.fetchedAt === "string" &&
    data.source === "openfoodfacts"
  );
}
