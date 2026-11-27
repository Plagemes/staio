// Nomi italiani dei gruppi e dei livelli di lavorazione, condivisi da schermate e viste dell'assistente.

import type { DietGroup, GroupRowId, IndicatorId, MeasureIndicatorId, ProcessingLevel, Unclassified } from "./types";

export const DIET_GROUP_LABEL: Readonly<Record<DietGroup | Unclassified, string>> = {
  vegetables: "verdura",
  fruit: "frutta",
  legumes: "legumi",
  wholeGrains: "cereali integrali",
  refinedGrains: "cereali non integrali",
  potatoes: "patate",
  fish: "pesce",
  whiteMeat: "carne bianca",
  redMeat: "carne rossa",
  processedMeat: "carni trasformate",
  milkYogurt: "latte e yogurt",
  cheese: "formaggi",
  eggs: "uova",
  nutsSeeds: "frutta secca e semi",
  oilsFats: "oli e grassi",
  sweets: "dolci",
  sugars: "zucchero, miele e marmellata",
  sugaryDrinks: "bevande zuccherate",
  saltySnacks: "snack salati",
  alcohol: "bevande alcoliche",
  otherDrinks: "altre bevande",
  condiments: "condimenti",
  mixedDish: "piatto misto",
  unknown: "non riconosciuto",
  outOfHome: "fuori casa",
};

export const PROCESSING_LABEL: Readonly<Record<ProcessingLevel, string>> = {
  1: "non lavorato o poco",
  2: "ingrediente da cucina",
  3: "lavorato",
  4: "molto lavorato",
};

/** Righe delle linee guida che non sono un gruppo dell'app: hanno un nome proprio (minuscolo, per stare in una frase). */
export const ROW_ONLY_LABEL: Readonly<Partial<Record<GroupRowId, string>>> = {
  bread: "pane",
  grains: "pasta, riso e altri cereali",
  breadSubstitutes: "sostituti del pane",
  sweetBakery: "prodotti da forno dolci",
  breakfastCereals: "cereali da colazione",
  fishPreserved: "pesce conservato",
  cakesIceCream: "torte, dolci al cucchiaio e gelati",
  snacksChocolate: "snack, patatine e cioccolato",
  sugar: "zucchero",
  honeyJam: "miele e marmellata",
};

/** Nome di una riga delle linee guida: quello proprio, altrimenti quello del gruppo omonimo. */
export function rowLabel(row: GroupRowId): string {
  return ROW_ONLY_LABEL[row] ?? (row in DIET_GROUP_LABEL ? DIET_GROUP_LABEL[row as DietGroup] : row);
}

/** Nomi degli indicatori che non sono una riga (minuscolo). */
export const MEASURE_LABEL: Readonly<Record<MeasureIndicatorId, string>> = {
  vegFruit: "verdura e frutta",
  wholeGrainShare: "cereali integrali",
  processedShare: "prodotti molto lavorati",
  salt: "sale",
  freeSugars: "zuccheri liberi",
  fiber: "fibre",
  plantVariety: "varietà di vegetali",
};

/** Nome dell'indicatore, minuscolo. */
export function indicatorLabel(id: IndicatorId): string {
  return id.startsWith("group:") ? rowLabel(id.slice(6) as GroupRowId) : MEASURE_LABEL[id as MeasureIndicatorId];
}
