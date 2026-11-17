import type { FoodCategory } from "./types";

/**
 * Durate indicative e prudenti per categoria. Sono stime da rivedere, non pareri medici.
 * Un valore 0 in `fridgeDays` o `pantryDays` significa "non adatto a quel luogo": la scadenza
 * stimata cade il giorno stesso dell'acquisto.
 */
export interface ShelfLife {
  /** Deperibile: la scadenza stimata è sempre di sicurezza, in qualunque luogo. */
  perishable: boolean;
  /** Giorni dall'acquisto, in frigo, senza data in etichetta. */
  fridgeDays: number;
  /** Giorni dall'acquisto, in dispensa (temperatura ambiente), senza data in etichetta. */
  pantryDays: number;
  /** Giorni dopo l'apertura (confezione aperta o prodotto iniziato), conservato correttamente. */
  afterOpeningDays: number;
  /** Mesi di conservazione in freezer dal congelamento. */
  freezerMonths: number;
  /** Giorni dopo lo scongelamento (in frigo), da consumare entro. */
  afterThawDays: number;
}

export const SHELF_LIFE: Record<FoodCategory, ShelfLife> = {
  red_meat_fresh: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 2, freezerMonths: 6, afterThawDays: 2 },
  ground_meat: { perishable: true, fridgeDays: 1, pantryDays: 0, afterOpeningDays: 1, freezerMonths: 3, afterThawDays: 1 },
  poultry: { perishable: true, fridgeDays: 2, pantryDays: 0, afterOpeningDays: 1, freezerMonths: 9, afterThawDays: 1 },
  fish_fresh: { perishable: true, fridgeDays: 1, pantryDays: 0, afterOpeningDays: 1, freezerMonths: 3, afterThawDays: 1 },
  cold_cuts_sliced: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 3, freezerMonths: 2, afterThawDays: 2 },
  cured_meat_whole: { perishable: false, fridgeDays: 30, pantryDays: 14, afterOpeningDays: 21, freezerMonths: 6, afterThawDays: 3 },
  milk_fresh: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 3, freezerMonths: 3, afterThawDays: 2 },
  milk_uht: { perishable: false, fridgeDays: 90, pantryDays: 90, afterOpeningDays: 3, freezerMonths: 3, afterThawDays: 2 },
  yogurt: { perishable: true, fridgeDays: 14, pantryDays: 0, afterOpeningDays: 4, freezerMonths: 2, afterThawDays: 2 },
  cheese_fresh: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 3, freezerMonths: 2, afterThawDays: 2 },
  cheese_aged: { perishable: false, fridgeDays: 28, pantryDays: 2, afterOpeningDays: 21, freezerMonths: 6, afterThawDays: 5 },
  butter: { perishable: false, fridgeDays: 30, pantryDays: 2, afterOpeningDays: 30, freezerMonths: 9, afterThawDays: 14 },
  eggs: { perishable: true, fridgeDays: 14, pantryDays: 7, afterOpeningDays: 2, freezerMonths: 12, afterThawDays: 2 },
  leafy_vegetables: { perishable: false, fridgeDays: 4, pantryDays: 1, afterOpeningDays: 2, freezerMonths: 8, afterThawDays: 1 },
  root_vegetables: { perishable: false, fridgeDays: 21, pantryDays: 10, afterOpeningDays: 5, freezerMonths: 10, afterThawDays: 2 },
  other_vegetables: { perishable: false, fridgeDays: 7, pantryDays: 3, afterOpeningDays: 3, freezerMonths: 10, afterThawDays: 2 },
  fruit_fresh: { perishable: false, fridgeDays: 7, pantryDays: 4, afterOpeningDays: 3, freezerMonths: 10, afterThawDays: 2 },
  berries: { perishable: false, fridgeDays: 3, pantryDays: 1, afterOpeningDays: 2, freezerMonths: 10, afterThawDays: 1 },
  citrus: { perishable: false, fridgeDays: 21, pantryDays: 7, afterOpeningDays: 5, freezerMonths: 4, afterThawDays: 2 },
  bread_fresh: { perishable: false, fridgeDays: 5, pantryDays: 3, afterOpeningDays: 3, freezerMonths: 3, afterThawDays: 2 },
  bread_packaged: { perishable: false, fridgeDays: 10, pantryDays: 7, afterOpeningDays: 5, freezerMonths: 3, afterThawDays: 3 },
  pasta_fresh: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 2, freezerMonths: 2, afterThawDays: 1 },
  pasta_dry: { perishable: false, fridgeDays: 730, pantryDays: 730, afterOpeningDays: 365, freezerMonths: 12, afterThawDays: 3 },
  rice_cereals: { perishable: false, fridgeDays: 365, pantryDays: 365, afterOpeningDays: 180, freezerMonths: 12, afterThawDays: 3 },
  legumes_dry: { perishable: false, fridgeDays: 730, pantryDays: 730, afterOpeningDays: 365, freezerMonths: 12, afterThawDays: 3 },
  canned_closed: { perishable: false, fridgeDays: 730, pantryDays: 730, afterOpeningDays: 3, freezerMonths: 3, afterThawDays: 2 },
  // Include pesto e sughi pronti aperti: 5 giorni in frigo dopo l'apertura.
  sauces_preserves_opened: { perishable: true, fridgeDays: 5, pantryDays: 0, afterOpeningDays: 5, freezerMonths: 3, afterThawDays: 3 },
  leftovers_cooked: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 3, freezerMonths: 3, afterThawDays: 1 },
  ready_meals: { perishable: true, fridgeDays: 3, pantryDays: 0, afterOpeningDays: 2, freezerMonths: 2, afterThawDays: 1 },
  frozen_foods: { perishable: true, fridgeDays: 2, pantryDays: 0, afterOpeningDays: 2, freezerMonths: 6, afterThawDays: 1 },
  beverages: { perishable: false, fridgeDays: 365, pantryDays: 365, afterOpeningDays: 7, freezerMonths: 1, afterThawDays: 1 },
  juices_opened: { perishable: true, fridgeDays: 5, pantryDays: 0, afterOpeningDays: 5, freezerMonths: 8, afterThawDays: 2 },
  condiments_sauces: { perishable: false, fridgeDays: 365, pantryDays: 365, afterOpeningDays: 30, freezerMonths: 3, afterThawDays: 7 },
  pastries_fresh: { perishable: true, fridgeDays: 2, pantryDays: 0, afterOpeningDays: 2, freezerMonths: 3, afterThawDays: 1 },
  snacks_dry: { perishable: false, fridgeDays: 180, pantryDays: 180, afterOpeningDays: 14, freezerMonths: 3, afterThawDays: 7 },
};

export function getShelfLife(category: FoodCategory): ShelfLife {
  return SHELF_LIFE[category];
}

/**
 * Categorie che non si propongono per il freezer: uova in guscio, verdure a foglia, surgelati (già congelati: fuori dal
 * freezer sarebbe un ricongelamento), bevande, scatolame chiuso e alimenti secchi, per cui la tabella non prevede un uso
 * del freezer.
 */
const NOT_FREEZABLE: ReadonlySet<FoodCategory> = new Set<FoodCategory>([
  "eggs",
  "leafy_vegetables",
  "frozen_foods",
  "beverages",
  "canned_closed",
  "pasta_dry",
  "rice_cereals",
  "legumes_dry",
  "snacks_dry",
]);

/** La categoria si può proporre per il freezer: non è nell'elenco di quelle escluse e la tabella dà almeno due mesi. */
export function canFreeze(category: FoodCategory): boolean {
  return !NOT_FREEZABLE.has(category) && SHELF_LIFE[category].freezerMonths >= 2;
}
