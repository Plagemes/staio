// Dati di prova per i test del modulo. Tutti i valori sono FINTI, scelti per far tornare i conti
// a mente: non sono dati nutrizionali e non vanno usati altrove.

import type { Product } from "../catalog";
import type { FoodComposition, NutrientAmounts } from "./types";

const FAKE_SOURCE = { db: "FINTO (solo test)", id: "0", description: "valore inventato per i test" };

export function fakeFood(
  id: string,
  name: string,
  per100: NutrientAmounts,
  extra: Partial<FoodComposition> = {},
): FoodComposition {
  return { id, name, group: "prova", basis: "g", per100, source: FAKE_SOURCE, ...extra };
}

export const FAKE_FOODS: readonly FoodComposition[] = [
  fakeFood("pollo-petto-crudo", "Petto di pollo crudo", { energyKcal: 100, proteinG: 20, fatG: 2 }),
  fakeFood(
    "latte-intero",
    "Latte intero",
    { energyKcal: 60, proteinG: 3, fatG: 3.5, carbsG: 5 },
    { basis: "ml", densityGPerMl: 1.03 },
  ),
  fakeFood("latte-scremato", "Latte scremato", { energyKcal: 35, proteinG: 3.5 }, { basis: "ml" }),
  fakeFood("yogurt-greco-0", "Yogurt greco 0%", { energyKcal: 50, proteinG: 10, fatG: 0 }),
  fakeFood("yogurt-greco-5", "Yogurt greco 5%", { energyKcal: 120, proteinG: 8, fatG: 5 }),
  fakeFood(
    "uovo",
    "Uovo di gallina",
    { energyKcal: 140, proteinG: 12, fatG: 10 },
    { aliases: ["uova"], unitWeightG: 60 },
  ),
  fakeFood("mela", "Mela", { energyKcal: 50, carbsG: 12, fiberG: 2 }, { unitWeightG: 150 }),
  fakeFood("pesca", "Pesca", { energyKcal: 40, carbsG: 9 }),
  fakeFood("pasta-secca", "Pasta di semola secca", {
    energyKcal: 350,
    proteinG: 12,
    carbsG: 70,
    fatG: 1.5,
    waterG: 10,
  }),
  fakeFood("prosciutto-cotto", "Prosciutto cotto", { energyKcal: 140, proteinG: 19 }),
  fakeFood("prosciutto-crudo", "Prosciutto crudo", { energyKcal: 250, proteinG: 26 }),
  fakeFood("farina-00", "Farina 00", { energyKcal: 340, carbsG: 76 }),
  fakeFood("farina-0", "Farina 0", { energyKcal: 345, carbsG: 75 }),
  fakeFood("zucchine", "Zucchine", { energyKcal: 15 }),
  fakeFood("olio", "Olio di oliva", { energyKcal: 900, fatG: 100 }, { densityGPerMl: 0.9 }),
];

/**
 * Alimenti FINTI che differiscono per stato (secco/crudo/cotto), per provare la preferenza di stato.
 * Separati da `FAKE_FOODS` per non alterare gli altri test.
 */
export const FAKE_STATE_FOODS: readonly FoodComposition[] = [
  // Gemelli: stesso `variantOf` e alias generici su tutte le voci del gruppo.
  fakeFood("pasta-secca-s", "Pasta di semola, secca", { energyKcal: 350 }, { aliases: ["pasta", "spaghetti"], state: "dried", variantOf: "pasta-s" }),
  fakeFood("pasta-cotta-s", "Pasta di semola, lessata", { energyKcal: 150 }, { aliases: ["pasta", "spaghetti", "pasta cotta"], state: "cooked", variantOf: "pasta-s" }),
  fakeFood("riso-crudo-s", "Riso bianco, crudo", { energyKcal: 350 }, { aliases: ["riso"], state: "raw", variantOf: "riso-s" }),
  fakeFood("riso-cotto-s", "Riso bianco, lessato", { energyKcal: 130 }, { aliases: ["riso", "riso cotto"], state: "cooked", variantOf: "riso-s" }),
  fakeFood("pollo-crudo-s", "Petto di pollo, crudo", { energyKcal: 100 }, { state: "raw", variantOf: "pollo-s" }),
  fakeFood("pollo-cotto-s", "Petto di pollo, cotto", { energyKcal: 160 }, { state: "cooked", variantOf: "pollo-s" }),
  // Solo la voce secca: la polenta cotta non c'è.
  fakeFood("farina-mais-s", "Farina di mais, secca", { energyKcal: 360 }, { aliases: ["polenta"], state: "dried", variantOf: "mais-s" }),
  // Solo la voce cruda.
  fakeFood("bistecca-s", "Bistecca di manzo, cruda", { energyKcal: 120 }, { state: "raw", variantOf: "manzo-s" }),
  // Due alimenti DIVERSI con lo stesso alias, ciascuno con il suo gruppo.
  fakeFood("tonno-fresco-s", "Tonno rosso fresco", { energyKcal: 140 }, { aliases: ["tonno"], state: "raw", variantOf: "tonno-fresco-s" }),
  fakeFood("tonno-scatola-s", "Tonno in scatola", { energyKcal: 200 }, { aliases: ["tonno"], state: "as_sold", variantOf: "tonno-scatola-s" }),
  // Due alimenti con lo stesso alias e senza `variantOf`, con stati diversi.
  fakeFood("pomodoro-crudo-s", "Pomodoro maturo", { energyKcal: 20 }, { aliases: ["pomodori"], state: "raw" }),
  fakeFood("pomodoro-pelato-s", "Pomodori pelati", { energyKcal: 25 }, { aliases: ["pomodori"], state: "as_sold" }),
  // Senza `variantOf`: la preferenza di stato non lo tocca mai.
  fakeFood("pane-s", "Pane", { energyKcal: 270 }, { state: "as_sold" }),
  fakeFood("zucchine-s", "Zucchine", { energyKcal: 15 }),
];

export const FAKE_PRODUCT: Product = {
  barcode: "0000000000000",
  name: "Prodotto finto",
  nutrients: { per: "100g", certainty: "label", energyKcal: 400, proteins: 10 },
  fetchedAt: "2026-03-01T00:00:00.000Z",
  source: "openfoodfacts",
};
