// Piccole funzioni condivise dai moduli dell'indice di qualità.

import type { Nutrients } from "../catalog";
import type { NutrientDimensionId } from "./types";

/** Numero con la virgola decimale e al massimo `digits` decimali, senza zeri inutili. */
export function fmt(n: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f).replace(".", ",");
}

export const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export const NUTRIENT_DIMENSION_LABEL: Readonly<Record<NutrientDimensionId, string>> = {
  fat: "Grassi",
  saturatedFat: "Grassi saturi",
  sugars: "Zuccheri",
  salt: "Sale",
};

/** Campo del prodotto che porta il valore di ogni dimensione nutrizionale. */
export const NUTRIENT_FIELD: Readonly<Record<NutrientDimensionId, keyof Nutrients>> = {
  fat: "fat",
  saturatedFat: "saturatedFat",
  sugars: "sugars",
  salt: "salt",
};

/** Nome in minuscolo per le frasi ("di sale"). */
export const NUTRIENT_PHRASE: Readonly<Record<NutrientDimensionId, string>> = {
  fat: "grassi",
  saturatedFat: "grassi saturi",
  sugars: "zuccheri",
  salt: "sale",
};

export function productLabel(p: { name?: string; brand?: string; barcode: string }): string {
  const base = p.name ?? p.barcode;
  return p.brand ? `${base} (${p.brand})` : base;
}
