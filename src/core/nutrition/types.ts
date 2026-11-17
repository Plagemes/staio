/**
 * Tipi condivisi della nutrizione. Questo file è il contratto tra il motore di calcolo,
 * la tabella di composizione degli alimenti e i valori di riferimento: non cambiarlo
 * senza aggiornare tutte e tre le parti.
 */

/** Nutrienti gestiti. Il suffisso dice l'unità: G grammi, Mg milligrammi, Ug microgrammi. */
export const NUTRIENT_KEYS = [
  "energyKcal",
  "proteinG",
  "carbsG",
  "sugarsG",
  "fatG",
  "saturatedFatG",
  "monounsaturatedFatG",
  "polyunsaturatedFatG",
  "omega3G",
  "fiberG",
  "saltG",
  "waterG",
  "cholesterolMg",
  "calciumMg",
  "ironMg",
  "magnesiumMg",
  "phosphorusMg",
  "potassiumMg",
  "zincMg",
  "seleniumUg",
  "iodineUg",
  "vitaminAUg",
  "vitaminCMg",
  "vitaminDUg",
  "vitaminEMg",
  "vitaminKUg",
  "thiaminMg",
  "riboflavinMg",
  "niacinMg",
  "vitaminB6Mg",
  "folateUg",
  "vitaminB12Ug",
  "alcoholG",
  "caffeineMg",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Quantità di nutrienti. Un nutriente assente significa "dato non disponibile", non zero. */
export type NutrientAmounts = Partial<Record<NutrientKey, number>>;

/** Da dove viene un dato di composizione. */
export interface CompositionSource {
  /** Nome della banca dati, per esempio "USDA FoodData Central". */
  db: string;
  /** Identificativo dell'alimento in quella banca dati. */
  id: string;
  /** Descrizione originale dell'alimento nella banca dati. */
  description: string;
}

/** Composizione di un alimento generico, per 100 g o per 100 ml. */
export interface FoodComposition {
  /** Identificativo stabile, minuscolo con trattini, per esempio "pollo-petto-crudo". */
  id: string;
  /** Nome italiano mostrato all'utente. */
  name: string;
  /** Altri nomi con cui l'alimento può essere cercato. */
  aliases?: readonly string[];
  /** Gruppo alimentare, per esempio "carne", "verdura", "latticini". */
  group: string;
  /** Se i valori sono per 100 g oppure per 100 ml. */
  basis: "g" | "ml";
  /** Valori per 100 g o 100 ml. */
  per100: NutrientAmounts;
  /** Peso indicativo di un pezzo in grammi, se l'alimento si conta a pezzi (un uovo, una mela). */
  unitWeightG?: number;
  /** Densità in g/ml, se serve passare da volume a massa. */
  densityGPerMl?: number;
  /** Stato dell'alimento a cui si riferiscono i valori. */
  state?: "raw" | "cooked" | "dried" | "as_sold";
  /**
   * Identificativo comune alle voci che sono LO STESSO alimento in stati diversi
   * (per esempio pasta secca e pasta cotta hanno lo stesso `variantOf`).
   * La scelta dello stato secondo il contesto avviene solo tra voci con lo stesso `variantOf`:
   * mai tra alimenti diversi.
   */
  variantOf?: string;
  source: CompositionSource;
}

export type Sex = "female" | "male";

/** Tipo di valore di riferimento. */
export type ReferenceKind =
  /** Assunzione raccomandata per la popolazione. */
  | "PRI"
  /** Assunzione adeguata, quando una raccomandazione non è definibile. */
  | "AI"
  /** Livello massimo tollerabile. */
  | "UL"
  /** Intervallo di riferimento, come quota dell'energia. */
  | "RI";

/** Un valore di riferimento per un nutriente e un gruppo di popolazione. */
export interface ReferenceValue {
  nutrient: NutrientKey;
  kind: ReferenceKind;
  /** A chi si applica. `sex` assente = entrambi. Età in anni, estremi inclusi. */
  sex?: Sex;
  ageMin: number;
  ageMax?: number;
  /** Valore nell'unità del nutriente, al giorno. Per `RI` vedi `percentEnergy`. */
  amount?: number;
  /** Per gli intervalli espressi come quota dell'energia: minimo e massimo in percento. */
  percentEnergy?: { min?: number; max?: number };
  /** Fonte del valore: ente, documento e indirizzo. */
  source: { body: string; document: string; url: string };
  note?: string;
}
