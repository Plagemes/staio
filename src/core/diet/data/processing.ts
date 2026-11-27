// Livello di lavorazione (NOVA) degli alimenti generici. È una mappa dichiarata dall'app, non un dato della
// fonte: ogni livello che ne viene è una stima (`estimated`, con la tilde a schermo). Vedi FONTI.md.

import type { FoodCategory } from "../../expiry";
import type { FoodComposition } from "../../nutrition";
import type { ProcessingLevel } from "../types";

/** Ripiego per gruppo della tabella, quando l'id non ha un livello proprio. */
export const TABLE_GROUP_PROCESSING: Readonly<Record<string, ProcessingLevel>> = {
  verdura: 1,
  frutta: 1,
  legumi: 1,
  cereali: 1,
  carne: 1,
  pesce: 1,
  latticini: 1,
  uova: 1,
  "frutta-secca": 1,
  salumi: 3,
  "oli-e-grassi": 2,
  dolci: 4,
  bevande: 1,
  condimenti: 1,
};

/** Livello per id, dove il ripiego del gruppo non basta. */
export const DECLARED_PROCESSING: Readonly<Record<string, ProcessingLevel>> = {
  // verdura conservata
  "cetrioli-sottaceto": 3,
  capperi: 3,
  "olive-nere": 3,
  "pomodori-pelati": 3,
  "pomodori-a-pezzi": 3,
  "passata-di-pomodoro": 3,
  "concentrato-di-pomodoro": 3,
  "pomodori-secchi": 3,
  // legumi
  "ceci-in-scatola": 3,
  "fagioli-cannellini-in-scatola": 3,
  "fagioli-borlotti-in-scatola": 3,
  "tofu-crudo": 3,
  tempeh: 3,
  hummus: 3,
  "minestrone-in-scatola": 4,
  // cereali
  "amido-di-mais": 2,
  "pane-bianco-a-fette": 3,
  "pane-francese": 3,
  "pane-integrale": 3,
  "pane-grattugiato": 3,
  "pane-pita": 3,
  focaccia: 3,
  "cracker-salati": 4,
  "gallette-di-riso": 3,
  popcorn: 3,
  "corn-flakes": 4,
  granola: 4,
  "fette-biscottate": 4,
  "lasagne-surgelate": 4,
  "spaghetti-al-sugo-di-carne": 4,
  "patatine-in-sacchetto": 4,
  "patatine-fritte-surgelate": 3,
  "patatine-fritte-al-forno": 3,
  // latticini
  "latte-condensato-zuccherato": 3,
  burro: 2,
  "parmigiano-reggiano": 3,
  "pecorino-romano": 3,
  "mozzarella-fiordilatte": 3,
  "mozzarella-per-pizza": 3,
  "ricotta-intera": 3,
  gorgonzola: 3,
  fontina: 3,
  provolone: 3,
  emmental: 3,
  "formaggio-di-capra-fresco": 3,
  "formaggio-spalmabile": 4,
  "fiocchi-di-latte": 3,
  cheddar: 3,
  feta: 3,
  brie: 3,
  gouda: 3,
  // salumi
  mortadella: 4,
  "prosciutto-cotto": 4,
  "prosciutto-cotto-magro": 4,
  "prosciutto-di-tacchino": 4,
  "wurstel-di-maiale": 4,
  "pate-di-fegato": 4,
  // pesce conservato
  "salmone-affumicato": 3,
  "tonno-al-naturale": 3,
  "tonno-sott-olio": 3,
  "baccala-secco": 3,
  "acciughe-sott-olio": 3,
  "sardine-sott-olio": 3,
  "salmone-in-scatola": 3,
  // frutta secca
  "burro-di-arachidi": 3,
  // oli e grassi
  margarina: 4,
  // dolci e zuccheri
  "zucchero-semolato": 2,
  "zucchero-di-canna": 2,
  miele: 2,
  marmellata: 3,
  "cacao-amaro": 1,
  // bevande
  cola: 4,
  "latte-al-cioccolato": 4,
  "latte-di-soia": 4,
  "latte-di-riso": 4,
  "latte-di-mandorla": 4,
  "latte-di-avena": 4,
  "vino-rosso": 3,
  "vino-bianco": 3,
  birra: 3,
  superalcolico: 4,
  // condimenti
  "sale-da-cucina": 2,
  "aceto-di-vino-rosso": 2,
  "aceto-balsamico": 2,
  "salsa-di-soia": 3,
  ketchup: 4,
  senape: 3,
  maionese: 4,
  "salsa-di-pomodoro-pronta": 3,
  pesto: 3,
  "brodo-vegetale-pronto": 4,
  "dado-di-carne": 4,
  "lievito-di-birra-fresco": 2,
  "lievito-di-birra-secco": 2,
  "lievito-in-polvere": 2,
  bicarbonato: 2,
};

/** Livello per categoria del lotto: solo i casi ovvi. Piatti pronti e avanzi non ne hanno. */
export const CATEGORY_PROCESSING: Readonly<Partial<Record<FoodCategory, ProcessingLevel>>> = {
  red_meat_fresh: 1,
  poultry: 1,
  fish_fresh: 1,
  eggs: 1,
  milk_fresh: 1,
  milk_uht: 1,
  leafy_vegetables: 1,
  root_vegetables: 1,
  other_vegetables: 1,
  fruit_fresh: 1,
  berries: 1,
  citrus: 1,
  legumes_dry: 1,
  pasta_dry: 1,
  butter: 2,
  cheese_fresh: 3,
  cheese_aged: 3,
  bread_fresh: 3,
  cold_cuts_sliced: 3,
  cured_meat_whole: 3,
};

/** Livello dichiarato di un alimento della tabella, se ce n'è uno. */
export function declaredProcessingOf(food: FoodComposition): ProcessingLevel | undefined {
  return DECLARED_PROCESSING[food.id] ?? TABLE_GROUP_PROCESSING[food.group];
}
