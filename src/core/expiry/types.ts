export type LabelDateType = "use_by" | "best_before" | "estimated" | "none";
export type StorageLocation = "frigo" | "freezer" | "dispensa";

export type FoodCategory =
  | "red_meat_fresh"
  | "ground_meat"
  | "poultry"
  | "fish_fresh"
  | "cold_cuts_sliced"
  | "cured_meat_whole"
  | "milk_fresh"
  | "milk_uht"
  | "yogurt"
  | "cheese_fresh"
  | "cheese_aged"
  | "butter"
  | "eggs"
  | "leafy_vegetables"
  | "root_vegetables"
  | "other_vegetables"
  | "fruit_fresh"
  | "berries"
  | "citrus"
  | "bread_fresh"
  | "bread_packaged"
  | "pasta_fresh"
  | "pasta_dry"
  | "rice_cereals"
  | "legumes_dry"
  | "canned_closed"
  | "sauces_preserves_opened"
  | "leftovers_cooked"
  | "ready_meals"
  | "frozen_foods"
  | "beverages"
  | "juices_opened"
  | "condiments_sauces"
  | "pastries_fresh"
  | "snacks_dry";

/** Voce di dispensa, come serve al motore delle scadenze. */
export interface ExpiryItem {
  id: string;
  labelDateType: LabelDateType;
  /** Data in etichetta 'YYYY-MM-DD', se presente. */
  labelDate?: string | null;
  purchaseDate: string;
  /** Presente solo se la confezione è stata aperta. */
  openedDate?: string | null;
  /**
   * Giorni di consumo dopo l'apertura dai dati del prodotto (Open Food Facts, scritti da volontari). Può solo
   * accorciare la durata della categoria: conta il minimo tra i due.
   */
  daysAfterOpening?: number | null;
  location: StorageLocation;
  frozenDate?: string | null;
  thawedDate?: string | null;
  category: FoodCategory;
}

export type ExpiryBasis = "label" | "opened" | "estimated" | "frozen" | "thawed";
/** safety = rischio per la salute; quality = solo qualità. */
export type ExpiryNature = "safety" | "quality";
export type ExpiryCertainty = "label" | "estimated";

export interface EffectiveExpiry {
  /** 'YYYY-MM-DD' */
  date: string;
  basis: ExpiryBasis;
  nature: ExpiryNature;
  certainty: ExpiryCertainty;
  /** Solo se aperta: data di qualità (etichetta 'preferibilmente entro') diversa da `date`, a titolo informativo. */
  qualityDate?: string;
  /** Solo se aperta: la durata viene dai dati del prodotto (Open Food Facts), usata perché più breve della stima per categoria. */
  openedFrom?: "product";
}

export type UrgencyLevel = "expired" | "past_quality" | "today" | "tomorrow" | "soon" | "ok";

export interface Urgency {
  level: UrgencyLevel;
  /** Negativo se già scaduto. */
  daysLeft: number;
}
