import type { FoodCategory } from "@/core/expiry";

export type BaseUnit = "g" | "ml" | "pz";

/** Contenuto della confezione: il testo com'è scritto e, solo se interpretabile, il valore in unità base. */
export interface PackageQuantity {
  /** Testo originale dell'etichetta, per esempio "6 x 125 g". */
  text?: string;
  /** Contenuto totale nell'unità base. */
  value?: number;
  unit?: BaseUnit;
  /** Numero di unità nella confezione, per "6 x 125 g" vale 6. */
  count?: number;
}

/** Valori per 100 g (o 100 ml per le bevande). Ciò che l'etichetta non riporta resta assente. */
export interface Nutrients {
  per: "100g" | "100ml";
  /** Dati d'etichetta inseriti da chi contribuisce a Open Food Facts: possono contenere errori. */
  certainty: "label";
  energyKcal?: number;
  proteins?: number;
  carbohydrates?: number;
  sugars?: number;
  fat?: number;
  saturatedFat?: number;
  fiber?: number;
  salt?: number;
}

export type NovaGroup = 1 | 2 | 3 | 4;
export type NutriScore = "a" | "b" | "c" | "d" | "e";

/** Porzione dichiarata da Open Food Facts, nell'unità base. */
export interface ServingSize {
  value: number;
  unit: BaseUnit;
}

/** Pezzi dentro la confezione ricavati da Open Food Facts: una proposta, mai un dato certo. */
export interface PiecesHint {
  count: number;
  /** Quantità di un pezzo, nell'unità della confezione. */
  each: number;
  /** label = scritta «2 x 100 g»; packagings = imballaggi dichiarati; serving = la porzione divide la confezione. */
  source: "label" | "packagings" | "serving";
}

export interface Product {
  /** Codice a barre così come è stato letto o digitato (solo cifre). */
  barcode: string;
  name?: string;
  brand?: string;
  quantity?: PackageQuantity;
  /** Materiali e forme della confezione (per esempio "plastic", "bottle"). */
  packaging?: string[];
  /** Categorie di Open Food Facts, senza prefisso di lingua. */
  categories?: string[];
  nutrients?: Nutrients;
  nova?: NovaGroup;
  nutriScore?: NutriScore;
  /** Identificatori degli allergeni dichiarati (per esempio "milk", "gluten"). */
  allergens?: string[];
  /** Additivi nella forma "E330". */
  additives?: string[];
  /** Porzione dichiarata. */
  serving?: ServingSize;
  /** Pezzi dentro la confezione, se si ricavano da quanto Open Food Facts dichiara. */
  piecesHint?: PiecesHint;
  /** Testo delle condizioni di conservazione, com'è scritto. */
  storageText?: string;
  imageUrl?: string;
  /** Istante ISO 8601 UTC della lettura. */
  fetchedAt: string;
  source: "openfoodfacts";
}

export interface ExpiryCategoryMatch {
  category: FoodCategory;
  /** Falso quando nessuna categoria di Open Food Facts è stata riconosciuta e si usa il ripiego prudente. */
  matched: boolean;
}
