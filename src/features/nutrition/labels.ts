// Nomi italiani, unità e frasi fisse della nutrizione. Nessuna dipendenza da React né dai dati degli alimenti.
import type { Certainty } from "@/core/ledger";
import type { FoodState, NutrientKey, ReferenceKind } from "@/core/nutrition";
import type { FigureNutrient } from "@/design";

export interface NutrientInfo {
  label: string;
  unit: string;
  /** Cifre decimali mostrate. */
  digits: number;
}

/** Colore del nutriente nel tema Vivo; zuccheri e grassi saturi prendono quello della loro famiglia. */
export const NUTRIENT_COLOR: Partial<Record<NutrientKey, FigureNutrient>> = {
  proteinG: "protein",
  carbsG: "carbs",
  sugarsG: "carbs",
  fatG: "fat",
  saturatedFatG: "fat",
  fiberG: "fiber",
};

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

export const nutrientLabel = (key: NutrientKey): string => NUTRIENT_INFO[key].label;

const formatters = new Map<number, Intl.NumberFormat>();
function numberFormat(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/** "1840 kcal", "6,2 mg". Con `digits` si cambia la precisione di default del nutriente. */
export function formatNutrient(key: NutrientKey, value: number, digits?: number): string {
  const info = NUTRIENT_INFO[key];
  return `${numberFormat(digits ?? info.digits).format(value)} ${info.unit}`;
}

/** Stato dell'alimento a cui si riferiscono i valori della tabella. */
export const STATE_LABELS: Record<FoodState, string> = {
  raw: "crudo",
  cooked: "cotto",
  dried: "secco",
  as_sold: "come venduto",
};

export const stateLabel = (state: FoodState | undefined): string | undefined => (state ? STATE_LABELS[state] : undefined);

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  measured: "misurato",
  label: "da etichetta",
  estimated: "stima",
};

/** Che cosa sta dietro a un valore, in poche parole: la certezza e perché. */
export function certaintyExplanation(certainty: Certainty): string {
  switch (certainty) {
    case "measured":
      return "Valore misurato.";
    case "label":
      return "Da etichetta: i valori sono quelli scritti sul prodotto.";
    case "estimated":
      return "Stima: valori di una tabella generica e quantità a occhio possono differire dal prodotto reale.";
  }
}

/** Il segno di una riga che è la stima di un pasto fuori casa, dove si legge da quali voci viene un nutriente. */
export const OUT_OF_HOME_EXPLANATION = "Stima fuori casa: solo l'energia. Per gli altri nutrienti il dato manca.";

export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  PRI: "assunzione raccomandata",
  AI: "assunzione adeguata",
  UL: "livello massimo di riferimento",
  RI: "intervallo di riferimento",
};

/** Etichette delle varianti: le chiavi sono quelle dei dati, in inglese. Una chiave nuova si mostra com'è. */
const VARIANT_LABELS: Record<string, string> = {
  premenopausal: "Prima della menopausa",
  postmenopausal: "Dopo la menopausa",
  "LPI 300": "Dieta con pochi fitati (300 mg al giorno)",
  "LPI 600": "Fitati moderati (600 mg al giorno)",
  "LPI 900": "Fitati medio-alti (900 mg al giorno)",
  "LPI 1200": "Dieta ricca di fitati (1200 mg al giorno)",
  nicotinamide: "Nicotinamide",
  "nicotinic acid": "Acido nicotinico",
};

export const variantLabel = (variant: string): string => VARIANT_LABELS[variant] ?? variant;

/** Spiegazione breve del perché esistono le varianti, per ciascun nutriente. */
export const VARIANT_HELP: Partial<Record<NutrientKey, string>> = {
  ironMg: "Per le donne il riferimento cambia se si è in premenopausa o dopo la menopausa.",
  zincMg: "Il riferimento dipende da quanti fitati (presenti in cereali integrali e legumi) ci sono nella dieta.",
  niacinMg: "Il limite massimo dipende dalla forma di niacina.",
};

/** Nota fissa in fondo alle schermate di nutrizione. */
export const NUTRITION_DISCLAIMER =
  "Fonti: i valori degli alimenti vengono da USDA FoodData Central, una banca dati statunitense, e possono differire dai prodotti italiani; per pane, pasta e cereali alcuni nutrienti non sono riportati perché nella fonte sono alterati dall'arricchimento. I valori di riferimento sono quelli EFSA per gli adulti. Sono stime, non misure. Staio non dà pareri medici: confronta ciò che mangi con valori di riferimento, non fa diagnosi né consigli di cura.";

/** Versione breve, per le schermate dove la nutrizione è solo una parte. */
export const NUTRITION_DISCLAIMER_SHORT =
  "Stime da una banca dati statunitense e da etichette: possono differire dai prodotti italiani, per pane, pasta e cereali alcuni nutrienti mancano. Staio non dà pareri medici.";

export const FOOD_SOURCE_NAME = "USDA FoodData Central";
