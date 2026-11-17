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
  [/^(frozen|ice-cream|sorbet)/, "frozen_foods"],
  [/^(canned|tomato-puree|passata|tomato-pulp|peeled-tomatoes|chopped-tomatoes)/, "canned_closed"],
  [/^(meals|prepared-meals|ready-meals|pasta-dishes|rice-dishes|pizzas?|sandwiches|quiches|soups|dishes)$/, "ready_meals"],
  [/^(pestos?|fresh-sauces|chilled-sauces)$/, "sauces_preserves_opened"],
  [/^eggs$/, "eggs"],
  [/^uht-milk/, "milk_uht"],
  [/^(plant-based-milks?|milk-substitutes|plant-based-beverages)$/, "beverages"],
  [/^(fresh-milks?|milks|creams|whipping-creams)$/, "milk_fresh"],
  [/^(yogurts?|fermented-milk-products|kefirs?)$/, "yogurt"],
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
  [/^(biscuits|biscuits-and-cakes|cookies|crackers|chips|crisps|snacks|salty-snacks|sweet-snacks|chocolates|confectioneries|candies|nuts|dried-fruits)$/, "snacks_dry"],
];

/** Categoria proposta e se è stata riconosciuta oppure è il ripiego. */
export function expiryCategoryMatch(product: Pick<Product, "categories">): ExpiryCategoryMatch {
  const categories = product.categories ?? [];
  for (const [pattern, category] of RULES) {
    if (categories.some((c) => pattern.test(c))) return { category, matched: true };
  }
  return { category: FALLBACK_CATEGORY, matched: false };
}

/** Propone una categoria del motore delle scadenze a partire dalle categorie di Open Food Facts. */
export function expiryCategoryFor(product: Pick<Product, "categories">): FoodCategory {
  return expiryCategoryMatch(product).category;
}
