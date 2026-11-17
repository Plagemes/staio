// Etichette italiane e raggruppamenti per le schermate. Nessun accesso a React né ai dati.
import type { FoodCategory } from "@/core/expiry";
import type { DiscardReason, ExpiryKind, Location, Unit } from "@/core/ledger";

/** Nel libro mastro il terzo luogo si chiama `dispensa`; in casa si dice credenza. */
export const LOCATION_LABELS: Record<Location, string> = {
  frigo: "Frigo",
  freezer: "Freezer",
  dispensa: "Credenza",
};

export const LOCATION_ORDER: readonly Location[] = ["frigo", "freezer", "dispensa"];

export const UNIT_NAMES: Record<Unit, string> = {
  g: "grammi",
  ml: "millilitri",
  pz: "pezzi",
};

/** Tipi di data che l'utente può scegliere (`estimated` lo scrive solo l'app). */
export type ChosenExpiryKind = Extract<ExpiryKind, "use_by" | "best_before">;

export const EXPIRY_KIND_LABELS: Record<ChosenExpiryKind | "none", string> = {
  use_by: "Da consumare entro",
  best_before: "Preferibilmente entro",
  none: "Nessuna data",
};

export const DISCARD_REASON_LABELS: Record<DiscardReason, string> = {
  expired: "Scaduto",
  leftover: "Avanzato",
  disliked: "Non mi è piaciuto",
  other: "Altro motivo",
};

export const DISCARD_REASON_ORDER: readonly DiscardReason[] = ["expired", "leftover", "disliked", "other"];

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  red_meat_fresh: "Carne rossa fresca",
  ground_meat: "Carne macinata",
  poultry: "Pollame",
  fish_fresh: "Pesce fresco",
  cold_cuts_sliced: "Affettati",
  cured_meat_whole: "Salumi interi",
  milk_fresh: "Latte fresco",
  milk_uht: "Latte a lunga conservazione",
  yogurt: "Yogurt",
  cheese_fresh: "Formaggi freschi",
  cheese_aged: "Formaggi stagionati",
  butter: "Burro",
  eggs: "Uova",
  leafy_vegetables: "Verdure a foglia",
  root_vegetables: "Radici e tuberi",
  other_vegetables: "Altre verdure",
  fruit_fresh: "Frutta fresca",
  berries: "Frutti di bosco",
  citrus: "Agrumi",
  bread_fresh: "Pane fresco",
  bread_packaged: "Pane confezionato",
  pasta_fresh: "Pasta fresca",
  pasta_dry: "Pasta secca",
  rice_cereals: "Riso e cereali",
  legumes_dry: "Legumi secchi",
  canned_closed: "Conserve in scatola",
  sauces_preserves_opened: "Sughi e conserve aperti",
  leftovers_cooked: "Avanzi cucinati",
  ready_meals: "Piatti pronti",
  frozen_foods: "Surgelati",
  beverages: "Bevande",
  juices_opened: "Succhi aperti",
  condiments_sauces: "Condimenti e salse",
  pastries_fresh: "Dolci freschi",
  snacks_dry: "Snack e biscotti",
};

export interface CategoryGroup {
  label: string;
  categories: FoodCategory[];
}

/** Per l'elenco a gruppi del modulo: ogni categoria compare in un solo gruppo. */
export const FOOD_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    label: "Carne e pesce",
    categories: ["red_meat_fresh", "ground_meat", "poultry", "fish_fresh", "cold_cuts_sliced", "cured_meat_whole"],
  },
  {
    label: "Latte, formaggi e uova",
    categories: ["milk_fresh", "milk_uht", "yogurt", "cheese_fresh", "cheese_aged", "butter", "eggs"],
  },
  {
    label: "Frutta e verdura",
    categories: ["leafy_vegetables", "root_vegetables", "other_vegetables", "fruit_fresh", "berries", "citrus"],
  },
  {
    label: "Pane, pasta e cereali",
    categories: [
      "bread_fresh",
      "bread_packaged",
      "pasta_fresh",
      "pasta_dry",
      "rice_cereals",
      "legumes_dry",
      "pastries_fresh",
      "snacks_dry",
    ],
  },
  {
    label: "Conserve, condimenti e bevande",
    categories: ["canned_closed", "sauces_preserves_opened", "condiments_sauces", "beverages", "juices_opened"],
  },
  {
    label: "Piatti pronti e surgelati",
    categories: ["leftovers_cooked", "ready_meals", "frozen_foods"],
  },
];

/** Categoria del catalogo dei modelli 3D (`models3d/recipe`) più vicina a ogni categoria del motore. */
export const MODEL_CATEGORY_OF: Record<FoodCategory, string> = {
  red_meat_fresh: "carne",
  ground_meat: "carne",
  poultry: "carne",
  fish_fresh: "pesce",
  cold_cuts_sliced: "carne",
  cured_meat_whole: "carne",
  milk_fresh: "latticini",
  milk_uht: "latticini",
  yogurt: "latticini",
  cheese_fresh: "formaggi",
  cheese_aged: "formaggi",
  butter: "latticini",
  eggs: "uova",
  leafy_vegetables: "verdura",
  root_vegetables: "verdura",
  other_vegetables: "verdura",
  fruit_fresh: "frutta",
  berries: "frutta",
  citrus: "frutta",
  bread_fresh: "pane",
  bread_packaged: "pane",
  pasta_fresh: "pasta-riso",
  pasta_dry: "pasta-riso",
  rice_cereals: "pasta-riso",
  legumes_dry: "dispensa",
  canned_closed: "conserve",
  sauces_preserves_opened: "conserve",
  leftovers_cooked: "altro",
  ready_meals: "altro",
  frozen_foods: "surgelati",
  beverages: "bevande",
  juices_opened: "bevande",
  condiments_sauces: "condimenti",
  pastries_fresh: "dolci",
  snacks_dry: "dolci",
};

/** Categoria del motore di riserva per ogni categoria del catalogo dei modelli (solo dove è senza ambiguità). */
export const FOOD_CATEGORY_OF_MODEL: Partial<Record<string, FoodCategory>> = {
  frutta: "fruit_fresh",
  verdura: "other_vegetables",
  erbe: "leafy_vegetables",
  formaggi: "cheese_aged",
  uova: "eggs",
  carne: "red_meat_fresh",
  pesce: "fish_fresh",
  pane: "bread_fresh",
  "pasta-riso": "pasta_dry",
  conserve: "canned_closed",
  bevande: "beverages",
  surgelati: "frozen_foods",
  dolci: "pastries_fresh",
  condimenti: "condiments_sauces",
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Regole in ordine: la prima che corrisponde vince, quindi i casi particolari
 * (pasta fresca, conserve, salumi) stanno prima di quelli generali. Il testo è senza accenti.
 */
const RULES: ReadonlyArray<readonly [RegExp, FoodCategory]> = [
  [/\b(surgelat|gelato|gelati)/, "frozen_foods"],
  [/\b(pelati|passata|scatola|scatoletta|lattina|sott'?olio|sottaceto|tonno)/, "canned_closed"],
  [/\b(insalata di riso|piatto pronto|piatti pronti|pizza|lasagne pronte)/, "ready_meals"],
  [/\b(avanz|ragu|minestra|zuppa)/, "leftovers_cooked"],
  [/\buov/, "eggs"],
  [/\blatte\b.*\b(uht|lunga conservazione|a lunga)/, "milk_uht"],
  [/\b(latte|panna)\b/, "milk_fresh"],
  [/\b(yogurt|yoghurt|kefir)/, "yogurt"],
  [/\bburro\b/, "butter"],
  [/\b(mozzarell|ricotta|stracchino|burrata|mascarpone|crescenza|robiola|feta|quark|primosale|fiocchi di latte)/, "cheese_fresh"],
  [/\b(parmigian|grana|pecorino|provolone|fontina|asiago|gorgonzola|emmental|scamorza|taleggio|formaggio|formaggi)/, "cheese_aged"],
  [/\b(macinato|hamburger|salsiccia|svizzera)/, "ground_meat"],
  [/\b(pollo|tacchino|coniglio|anatra|petto di)/, "poultry"],
  [/\b(manzo|vitello|maiale|bistecca|arrosto|costata|fettina|filetto|costine|agnello|braciola)/, "red_meat_fresh"],
  [/\b(salmone|merluzzo|orata|branzino|spigola|pesce|gamberi|gamberetti|calamari|cozze|vongole|trota|sogliola|polpo|seppie)/, "fish_fresh"],
  [/\b(prosciutto|mortadella|bresaola|speck|affettat|pancetta)/, "cold_cuts_sliced"],
  [/\b(salame|salami|coppa|guanciale|nduja)/, "cured_meat_whole"],
  [/\b(insalata|spinaci|lattuga|rucola|bietol|cavolo cappuccio|radicchio|valeriana|basilico|prezzemolo|erbette)/, "leafy_vegetables"],
  [/\b(carot|patat|cipoll|barbabiet|rapa|rape|aglio|scalogn)/, "root_vegetables"],
  [/\b(zucchin|pomodor|peperon|melanzan|broccol|cavolfior|finocch|cetriol|funghi|zucca|asparag|carciof|fagiolini|verdur|sedano|piselli freschi)/, "other_vegetables"],
  [/\b(fragol|mirtill|lampon|ribes|frutti di bosco)/, "berries"],
  [/\b(limon|aranc|mandarin|pompelm|clementin|cedro|lime\b)/, "citrus"],
  [/\b(mela|mele|pera|pere|banan|pesca|pesche|uva|kiwi|albicocc|prugn|ciliegi|fichi|fico|melone|meloni|anguria|cocomer|ananas|mango|frutta|cachi)/, "fruit_fresh"],
  [/\b(pancarre|pan carre|pane in cassetta|piadin|wrap|tramezzin)/, "bread_packaged"],
  [/\b(pane|panino|panini|ciabatta|baguette|focaccia|rosetta|michetta)/, "bread_fresh"],
  [/\b(pasta fresca|tortellini|tortelloni|ravioli|gnocchi|lasagne fresche|cappelletti|agnolotti)/, "pasta_fresh"],
  [/\b(pasta|spaghetti|penne|fusilli|rigatoni|tagliatelle|farfalle|maccheroni|orecchiette|linguine|bucatini|paccheri|cannelloni)/, "pasta_dry"],
  [/\b(riso|farro|orzo|couscous|cereali|avena|farina|polenta|quinoa|semola|muesli)/, "rice_cereals"],
  [/\b(lenticchie|ceci|fagioli|piselli secchi|fave secche|legumi)/, "legumes_dry"],
  [/\b(sugo|pesto|ragu pronto)/, "sauces_preserves_opened"],
  [/\b(succo|succhi|spremuta)/, "beverages"],
  [/\b(acqua|vino|birra|aranciata|cola|bibita|te\b|tisana|caffe|spumante|prosecco|limonata|gazzosa|energy)/, "beverages"],
  [/\b(olio|aceto|sale\b|maionese|ketchup|senape|salsa|spezie|zucchero|miele|marmellata|confettura|nutella|crema spalmabile|dado|brodo)/, "condiments_sauces"],
  [/\b(cornetto|cornetti|brioche|torta|crostata|pasticcini|cannol|tiramisu|bomboloni|muffin|plumcake)/, "pastries_fresh"],
  [/\b(biscott|cracker|patatine|snack|cioccolat|merendin|taralli|grissini|fette biscottate|barretta|noci|mandorle|nocciole|arachidi|pistacchi)/, "snacks_dry"],
];

/**
 * Categoria plausibile per un nome. `modelCategory` è la categoria del primo modello del catalogo
 * che corrisponde al nome: serve solo quando nessuna regola riconosce le parole.
 */
export function suggestCategory(name: string, modelCategory?: string): FoodCategory | undefined {
  const text = fold(name);
  if (text === "") return undefined;
  for (const [pattern, category] of RULES) {
    if (pattern.test(text)) return category;
  }
  return modelCategory === undefined ? undefined : FOOD_CATEGORY_OF_MODEL[modelCategory];
}
