// Dai 14 gruppi della tabella di composizione ai gruppi delle linee guida, con le eccezioni per id.
// Tutto è una mappa dell'app (vedi FONTI.md): le parti che ne vengono sono stime, salvo l'alimento scelto.

import type { FoodComposition } from "../../nutrition";
import { isWholeGrainKey } from "../../nutrition/variety";
import type { DietGroup, PortionKey } from "../types";

export interface GroupMapping {
  group: DietGroup;
  portionKey?: PortionKey;
}

/** Gruppo predefinito per `FoodComposition.group`. */
export const TABLE_GROUP_DEFAULT: Readonly<Record<string, DietGroup>> = {
  verdura: "vegetables",
  frutta: "fruit",
  legumi: "legumes",
  cereali: "refinedGrains",
  carne: "redMeat",
  pesce: "fish",
  latticini: "milkYogurt",
  uova: "eggs",
  "frutta-secca": "nutsSeeds",
  salumi: "processedMeat",
  "oli-e-grassi": "oilsFats",
  dolci: "sweets",
  bevande: "otherDrinks",
  condimenti: "condiments",
};

/** Porzione predefinita di ogni gruppo: quella con cui si conta quando nessuna regola dice altro. */
export const GROUP_DEFAULT_PORTION: Readonly<Partial<Record<DietGroup, PortionKey>>> = {
  vegetables: "vegetables",
  fruit: "fruit",
  legumes: "legumes",
  wholeGrains: "grains",
  refinedGrains: "grains",
  potatoes: "potatoes",
  fish: "fish",
  whiteMeat: "whiteMeat",
  redMeat: "redMeat",
  processedMeat: "processedMeat",
  milkYogurt: "milk",
  cheese: "cheeseAged",
  eggs: "eggs",
  nutsSeeds: "nutsSeeds",
  oilsFats: "oil",
  sweets: "cakes",
  sugars: "sugar",
  sugaryDrinks: "sugaryDrinks",
  saltySnacks: "snacks",
};

const m = (group: DietGroup, portionKey?: PortionKey): GroupMapping =>
  portionKey !== undefined ? { group, portionKey } : { group };

/**
 * Eccezioni per id della tabella. I formaggi seguono la riga «fino al 25% di grassi» (< 300 kcal/100 g)
 * della Tab. 9.1 CREA: sotto è `cheeseFresh`, sopra `cheeseAged`.
 */
export const FOOD_ID_GROUP: Readonly<Record<string, GroupMapping>> = {
  // verdura
  "lattuga-cappuccia-cruda": m("vegetables", "leafySalad"),
  "lattuga-a-foglia-verde-cruda": m("vegetables", "leafySalad"),
  "lattuga-romana-cruda": m("vegetables", "leafySalad"),
  "indivia-cruda": m("vegetables", "leafySalad"),
  "radicchio-crudo": m("vegetables", "leafySalad"),
  "rucola-cruda": m("vegetables", "leafySalad"),
  "patata-cruda": m("potatoes", "potatoes"),
  "patata-lessa": m("potatoes", "potatoes"),
  "patata-dolce-cruda": m("potatoes", "potatoes"),
  "piselli-freschi-crudi": m("legumes", "legumes"),
  "cetrioli-sottaceto": m("condiments"),
  capperi: m("condiments"),
  "olive-nere": m("condiments"),
  // legumi
  "tofu-crudo": m("legumes", "soy"),
  tempeh: m("legumes", "soy"),
  hummus: m("legumes", "legumes"),
  "minestrone-in-scatola": m("mixedDish"),
  // cereali
  "pane-bianco-a-fette": m("refinedGrains", "bread"),
  "pane-francese": m("refinedGrains", "bread"),
  "pane-integrale": m("wholeGrains", "bread"),
  "pane-grattugiato": m("refinedGrains", "bread"),
  "pane-pita": m("refinedGrains", "bread"),
  focaccia: m("refinedGrains", "bread"),
  "cracker-salati": m("refinedGrains", "breadSubstitutes"),
  "gallette-di-riso": m("refinedGrains", "breadSubstitutes"),
  "fette-biscottate": m("refinedGrains", "breadSubstitutes"),
  popcorn: m("saltySnacks", "snacks"),
  "corn-flakes": m("refinedGrains", "breakfastCereals"),
  granola: m("refinedGrains", "breakfastCereals"),
  "fiocchi-di-avena": m("wholeGrains", "breakfastCereals"),
  "fiocchi-di-avena-cotti": m("wholeGrains", "breakfastCereals"),
  "pasta-fresca": m("refinedGrains", "freshEggPasta"),
  "pasta-fresca-cotta": m("refinedGrains", "freshEggPasta"),
  "pasta-all-uovo-secca": m("refinedGrains", "freshEggPasta"),
  "pasta-all-uovo-cotta": m("refinedGrains", "freshEggPasta"),
  "lasagne-surgelate": m("mixedDish"),
  "spaghetti-al-sugo-di-carne": m("mixedDish"),
  "patatine-in-sacchetto": m("saltySnacks", "snacks"),
  "patatine-fritte-surgelate": m("potatoes", "potatoes"),
  "patatine-fritte-al-forno": m("potatoes", "potatoes"),
  // latticini
  "yogurt-intero-naturale": m("milkYogurt", "yogurt"),
  "yogurt-magro-naturale": m("milkYogurt", "yogurt"),
  "yogurt-greco-intero": m("milkYogurt", "yogurt"),
  kefir: m("milkYogurt", "yogurt"),
  "latte-condensato-zuccherato": m("sweets", "spreads"),
  "panna-fresca": m("oilsFats", "butter"),
  "panna-acida": m("oilsFats", "butter"),
  burro: m("oilsFats", "butter"),
  "parmigiano-reggiano": m("cheese", "cheeseAged"),
  "pecorino-romano": m("cheese", "cheeseAged"),
  "mozzarella-fiordilatte": m("cheese", "cheeseFresh"),
  "mozzarella-per-pizza": m("cheese", "cheeseAged"),
  "ricotta-intera": m("cheese", "cheeseFresh"),
  gorgonzola: m("cheese", "cheeseAged"),
  fontina: m("cheese", "cheeseAged"),
  provolone: m("cheese", "cheeseAged"),
  emmental: m("cheese", "cheeseAged"),
  "formaggio-di-capra-fresco": m("cheese", "cheeseFresh"),
  "formaggio-spalmabile": m("cheese", "cheeseAged"),
  "fiocchi-di-latte": m("cheese", "cheeseFresh"),
  cheddar: m("cheese", "cheeseAged"),
  feta: m("cheese", "cheeseFresh"),
  brie: m("cheese", "cheeseAged"),
  gouda: m("cheese", "cheeseAged"),
  // carne: anatra resta rossa (interpretazione dichiarata)
  "coniglio-crudo": m("whiteMeat", "whiteMeat"),
  "coniglio-arrosto": m("whiteMeat", "whiteMeat"),
  "pollo-petto-crudo": m("whiteMeat", "whiteMeat"),
  "pollo-petto-cotto": m("whiteMeat", "whiteMeat"),
  "pollo-coscia-con-pelle-cruda": m("whiteMeat", "whiteMeat"),
  "pollo-coscia-con-pelle-arrosto": m("whiteMeat", "whiteMeat"),
  "pollo-ala-con-pelle-cruda": m("whiteMeat", "whiteMeat"),
  "pollo-intero-crudo": m("whiteMeat", "whiteMeat"),
  "pollo-intero-arrosto": m("whiteMeat", "whiteMeat"),
  "tacchino-petto-crudo": m("whiteMeat", "whiteMeat"),
  "tacchino-petto-arrosto": m("whiteMeat", "whiteMeat"),
  "anatra-senza-pelle-cruda": m("redMeat", "redMeat"),
  // pesce conservato
  "salmone-affumicato": m("fish", "fishPreserved"),
  "tonno-al-naturale": m("fish", "fishPreserved"),
  "tonno-sott-olio": m("fish", "fishPreserved"),
  "baccala-secco": m("fish", "fishPreserved"),
  "acciughe-sott-olio": m("fish", "fishPreserved"),
  "sardine-sott-olio": m("fish", "fishPreserved"),
  "salmone-in-scatola": m("fish", "fishPreserved"),
  // oli e grassi
  strutto: m("oilsFats", "butter"),
  margarina: m("oilsFats", "butter"),
  // dolci e zuccheri
  "zucchero-semolato": m("sugars", "sugar"),
  "zucchero-di-canna": m("sugars", "sugar"),
  miele: m("sugars", "honeyJam"),
  marmellata: m("sugars", "honeyJam"),
  "crema-di-nocciole-e-cacao": m("sweets", "spreads"),
  "cioccolato-fondente-45": m("sweets", "snacks"),
  "cioccolato-fondente-70": m("sweets", "snacks"),
  "cioccolato-al-latte": m("sweets", "snacks"),
  "cacao-amaro": m("condiments"),
  "biscotti-frollini-al-burro": m("sweets", "sweetBakery"),
  "biscotti-avena": m("sweets", "sweetBakery"),
  savoiardi: m("sweets", "sweetBakery"),
  "cornetto-al-burro": m("sweets", "sweetBakery"),
  plumcake: m("sweets", "sweetBakery"),
  // bevande: i succhi, anche la spremuta, sono bevande zuccherate (Tab. 9.3; la spremuta è una scelta dichiarata)
  "succo-d-arancia-spremuta": m("sugaryDrinks", "sugaryDrinks"),
  "succo-d-arancia-confezionato": m("sugaryDrinks", "sugaryDrinks"),
  "succo-di-mela": m("sugaryDrinks", "sugaryDrinks"),
  "succo-d-uva": m("sugaryDrinks", "sugaryDrinks"),
  "succo-di-limone": m("condiments"),
  cola: m("sugaryDrinks", "sugaryDrinks"),
  "latte-al-cioccolato": m("sugaryDrinks", "sugaryDrinks"),
  "vino-rosso": m("alcohol"),
  "vino-bianco": m("alcohol"),
  birra: m("alcohol"),
  superalcolico: m("alcohol"),
};

/**
 * Gruppo e porzione di un alimento della tabella. Lo stato decide la porzione dei legumi (secchi 50 g, gli
 * altri 150 g) e della frutta (essiccata 30 g). `state` permette di chiedere la porzione per lo stato
 * dell'equivalente crudo invece che per lo stato della voce.
 */
export function foodGroupOf(food: FoodComposition, state: FoodComposition["state"] = food.state): GroupMapping {
  const explicit = FOOD_ID_GROUP[food.id];
  if (explicit) return explicit;
  const group = TABLE_GROUP_DEFAULT[food.group];
  if (group === undefined) return { group: "mixedDish" };
  if (group === "refinedGrains" && isWholeGrainKey(food.variantOf ?? food.id)) return m("wholeGrains", "grains");
  if (group === "legumes") return m("legumes", state === "dried" ? "legumesDry" : "legumes");
  if (group === "fruit") return m("fruit", state === "dried" ? "driedFruit" : "fruit");
  return m(group, GROUP_DEFAULT_PORTION[group]);
}
