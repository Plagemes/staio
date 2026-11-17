// File generato da scripts/nutrition/build-foods.mjs a partire da USDA FoodData Central.
// Non modificare a mano: rigenerare con lo script (vedi FONTE.md).
import type { FoodComposition, NutrientKey } from "../../types";
import { FRUIT } from "./fruit";
import { VEGETABLES } from "./vegetables";
import { LEGUMES } from "./legumes";
import { CEREALS } from "./cereals";
import { DAIRY } from "./dairy";
import { EGGS } from "./eggs";
import { MEAT } from "./meat";
import { CURED_MEATS } from "./cured-meats";
import { FISH } from "./fish";
import { NUTS_SEEDS } from "./nuts-seeds";
import { OILS_FATS } from "./oils-fats";
import { SWEETS } from "./sweets";
import { BEVERAGES } from "./beverages";
import { CONDIMENTS } from "./condiments";

export const FOODS: readonly FoodComposition[] = [
  ...FRUIT,
  ...VEGETABLES,
  ...LEGUMES,
  ...CEREALS,
  ...DAIRY,
  ...EGGS,
  ...MEAT,
  ...CURED_MEATS,
  ...FISH,
  ...NUTS_SEEDS,
  ...OILS_FATS,
  ...SWEETS,
  ...BEVERAGES,
  ...CONDIMENTS,
];

/** Versioni dei file di dati da cui la tabella e' stata generata. */
export const FOODS_SOURCE_VERSION = {
  foundationFoods: "2026-10-29",
  srLegacy: "2018-04",
} as const;

/** Nutrienti non riportati dalla fonte ma ricavati da altri valori della fonte. */
export const DERIVED_NUTRIENTS: Partial<Record<NutrientKey, string>> = {
  saltG: "sale = sodio (FDC 1093) x 2,5; ricavato, non misurato",
  omega3G: "somma di ALA (1404), EPA (1278), DPA (1280), DHA (1272) quando riportati; presente solo se c'e' l'ALA oppure sia EPA sia DHA",
};
