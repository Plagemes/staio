import type { FoodCategory } from "@/core/expiry";
import type { ExpiryCategoryMatch, Product } from "./types";

/** Se nulla corrisponde si sceglie una categoria deperibile, con la durata stimata più breve tra quelle plausibili per un prodotto confezionato. */
export const FALLBACK_CATEGORY: FoodCategory = "ready_meals";

/**
 * Regole in ordine, sulle categorie di Open Food Facts (inglese, senza prefisso). La prima che
 * corrisponde a una qualunque categoria del prodotto vince: i casi particolari stanno prima dei generali,
 * perché le categorie dei prodotti includono anche gli antenati ("canned-fishes" porta con sé "fishes").
 * Nei casi dubbi si sceglie la durata più breve.
 */
const RULES: ReadonlyArray<readonly [RegExp, FoodCategory]> = [
  [/^(frozen|ice-cream|sorbet|gelato)/, "frozen_foods"],
  [/^(canned|tomato-puree|passata|tomato-pulp|peeled-tomatoes|chopped-tomatoes)/, "canned_closed"],
  [/^(meals|prepared-meals|ready-meals|pasta-dishes|rice-dishes|pizzas?|sandwiches|quiches|soups|dishes)$/, "ready_meals"],
  [/^(pancakes|crepes|waffles|galettes)$/, "pastries_fresh"],
  [/^(piadinas?|tortillas?|wraps?|flatbreads?)$/, "bread_packaged"],
  [/^(deli-meats|sliced-meats|lunch-meats|sliced-cold-cuts)$/, "cold_cuts_sliced"],
  [/^(pestos?|fresh-sauces|chilled-sauces)$/, "sauces_preserves_opened"],
  [/^eggs$/, "eggs"],
  [/^uht-milk/, "milk_uht"],
  [/^(plant-based-milks?|milk-substitutes|plant-based-beverages)$/, "beverages"],
  [/^(fresh-milks?|milks|creams|whipping-creams)$/, "milk_fresh"],
  [/(^|-)(yogurts?|yoghurts?|skyr|kefirs?)$|^(fermented-milk-products|dairy-desserts|chilled-desserts|puddings?|mousses?|custards?|creme-desserts|milk-desserts|dairy-substitutes)$/, "yogurt"],
  [/^butters?$/, "butter"],
  [/^(fresh-cheeses?|mozzarellas?|ricottas?|mascarpone|cottage-cheeses?|cream-cheeses?|burrata|stracchino|feta|cheeses)$/, "cheese_fresh"],
  [/^(hard-cheeses?|semi-hard-cheeses?|aged-cheeses?|parmesan|grana|pecorino|grated-cheeses?|processed-cheeses?)/, "cheese_aged"],
  [/^(minced|ground|sausages?|burgers?|hamburgers?)/, "ground_meat"],
  [/^(poultries?|chickens?|turkeys?|ducks?|rabbits?)$/, "poultry"],
  [/^(hams?|cooked-hams?|cured-hams?|cold-cuts|prepared-meats?|charcuteries?|salamis?|dry-sausages?|bresaola|mortadella|speck|prosciutto)/, "cold_cuts_sliced"],
  [/^(fresh-meats?|meats?|beefs?|pork|veal|lambs?|red-meats?)$/, "red_meat_fresh"],
  [/^(fresh-fish|fishes|smoked-fish|salmons?|seafood|fresh-seafood|shrimps?)/, "fish_fresh"],
  [/^(leaf-vegetables?|lettuces?|spinach|spinaches|salads)$/, "leafy_vegetables"],
  [/^(root-vegetables?|potatoes|carrots|onions)$/, "root_vegetables"],
  [/^fresh-vegetables$/, "other_vegetables"],
  [/^(berries|strawberries|blueberries|raspberries)$/, "berries"],
  [/^(citrus|oranges?|lemons?|mandarins?|clementines?)$/, "citrus"],
  [/^fresh-fruits?$/, "fruit_fresh"],
  [/^fresh-breads?$/, "bread_fresh"],
  [/^(breads?|sliced-breads?|sandwich-breads?|toasts?|bread-substitutes|rusks)$/, "bread_packaged"],
  [/^(pastries|viennoiseries|croissants|brioches|cakes|fresh-pastries)$/, "pastries_fresh"],
  [/^(fresh-pastas?|filled-pastas?|fresh-filled-pastas?)$/, "pasta_fresh"],
  [/^(pastas?|dried-pastas?|spaghetti|noodles|couscous)$/, "pasta_dry"],
  [/^(rices?|breakfast-cereals|cereal-grains|flours|oat-flakes|cereals-and-their-products|cereals)$/, "rice_cereals"],
  [/^(legumes|pulses|dried-legumes|lentils|chickpeas|beans)$/, "legumes_dry"],
  [/^(juices-and-nectars|fruit-juices|fruit-based-beverages|beverages|waters|sodas|carbonated-drinks|teas|coffees|alcoholic-beverages|energy-drinks|beers|wines)$/, "beverages"],
  [/^(condiments|sauces|vinegars|oils|olive-oils|spices|mayonnaises|ketchup|jams|honeys|spreads|salts|seasonings|dressings)$/, "condiments_sauces"],
  [/^(protein-bars|cereal-bars|snack-bars|bars)$/, "snacks_dry"],
  [/^(fresh-foods|chilled-foods|refrigerated-foods)$/, "ready_meals"],
  [/^(biscuits|biscuits-and-cakes|cookies|crackers|chips|crisps|snacks|salty-snacks|sweet-snacks|chocolates|confectioneries|candies|nuts|dried-fruits)$/, "snacks_dry"],
  // livello più generico della gerarchia, solo se niente di più preciso ha corrisposto
  [/^(dairies|desserts)$/, "yogurt"],
];

/**
 * Parole del nome (italiano e inglese), in ordine: la prima che corrisponde vince. Il nome si confronta senza
 * accenti e in minuscolo. Si usa solo quando le categorie di Open Food Facts non bastano.
 */
const NAME_RULES: ReadonlyArray<readonly [RegExp, FoodCategory]> = [
  [/\b(surgelat\w*|congelat\w*|frozen|gelato|ice cream)\b/, "frozen_foods"],
  [/\b(gnocchi|tortellini|tortelloni|ravioli|cappelletti|agnolotti|pasta fresca|fresh pasta)\b/, "pasta_fresh"],
  [/\b(skyr|kefir|yogurt|yoghurt|mousse|budino|budini|pudding|dessert|panna cotta|tiramisu|creme caramel)\b/, "yogurt"],
  [/\b(pancakes?|waffles?|crepes?|brioche|croissant|cornetto|muffin|plumcake)\b/, "pastries_fresh"],
  [/\b(piadina|piadine|tortilla|tortillas|wrap|pane|pan carre|toast|focaccia|bread)\b/, "bread_packaged"],
  [/\b(affettat\w*|prosciutto|salame|mortadella|bresaola|speck|pancetta|coppa|sliced ham|cold cuts)\b/, "cold_cuts_sliced"],
  [/\b(wurstel|hamburger|burger|salsiccia|macinato|minced)\b/, "ground_meat"],
  [/\b(pollo|tacchino|petto di|chicken|turkey)\b/, "poultry"],
  [/\b(salmone|merluzzo|orata|branzino|gamberi|salmon|shrimp)\b/, "fish_fresh"],
  [/\b(tonno|sgombro|passata|polpa di pomodoro|pelati|legumi in scatola|canned)\b/, "canned_closed"],
  [/\b(bevanda|latte di (soia|avena|mandorla|riso|cocco)|soy drink|oat drink|almond drink|succo|spremuta|acqua|bibita|cola|birra|vino|te freddo|tea)\b/, "beverages"],
  [/^latte\b.*\buht\b|\blatte uht\b/, "milk_uht"],
  [/^latte\b|^milk\b|\blatte (fresco|intero|scremato|parzialmente)\b/, "milk_fresh"],
  [/\b(mozzarella|ricotta|mascarpone|stracchino|burrata|formaggio fresco|philadelphia|crescenza|feta|fiocchi di latte)\b/, "cheese_fresh"],
  [/\b(parmigiano|grana|pecorino|provolone|asiago|fontina|formaggio stagionato|cheddar)\b/, "cheese_aged"],
  [/\b(burro|butter)\b/, "butter"],
  [/\b(uova|eggs?)\b/, "eggs"],
  [/\b(insalata|rucola|spinaci|valeriana|lattuga|salad)\b/, "leafy_vegetables"],
  [/\b(pizza|lasagne|piatto pronto|ready meal|zuppa|minestrone|hummus)\b/, "ready_meals"],
  [/\b(biscotti|cracker|crackers|grissini|patatine|barretta|barrette|protein bar|cioccolat\w*|taralli|fette biscottate)\b/, "snacks_dry"],
  [/\b(spaghetti|penne|fusilli|rigatoni|farfalle|pasta|tagliatelle)\b/, "pasta_dry"],
  [/\b(riso|cereali|muesli|fiocchi d avena|farina|avena|cereal)\b/, "rice_cereals"],
  [/\b(lenticchie|ceci|fagioli|legumi)\b/, "legumes_dry"],
  [/\b(sugo|salsa|pesto|maionese|ketchup|olio|aceto|marmellata|confettura|miele)\b/, "condiments_sauces"],
];

export type ExpiryCategorySource = "off" | "name" | "none";

export interface ExpiryCategoryProposal extends ExpiryCategoryMatch {
  /** Da dove viene la proposta: categorie di Open Food Facts, parole del nome, o nessuna (ripiego). */
  source: ExpiryCategorySource;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ");
}

/** Categoria dal solo nome del prodotto, se una parola nota compare. */
export function expiryCategoryFromName(name: string | undefined): FoodCategory | undefined {
  if (!name) return undefined;
  const text = normalizeName(name);
  for (const [pattern, category] of NAME_RULES) if (pattern.test(text)) return category;
  return undefined;
}

/** Categoria proposta, se è stata riconosciuta e da dove viene: prima Open Food Facts, poi il nome. */
export function expiryCategoryProposal(product: Pick<Product, "categories" | "name">): ExpiryCategoryProposal {
  const categories = product.categories ?? [];
  for (const [pattern, category] of RULES) {
    if (categories.some((c) => pattern.test(c))) return { category, matched: true, source: "off" };
  }
  const byName = expiryCategoryFromName(product.name);
  if (byName) return { category: byName, matched: true, source: "name" };
  return { category: FALLBACK_CATEGORY, matched: false, source: "none" };
}

/** Categoria proposta e se è stata riconosciuta oppure è il ripiego. */
export function expiryCategoryMatch(product: Pick<Product, "categories" | "name">): ExpiryCategoryMatch {
  const { category, matched } = expiryCategoryProposal(product);
  return { category, matched };
}

/** Propone una categoria del motore delle scadenze a partire dalle categorie di Open Food Facts. */
export function expiryCategoryFor(product: Pick<Product, "categories" | "name">): FoodCategory {
  return expiryCategoryMatch(product).category;
}
