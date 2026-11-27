// Gruppo dalla categoria del lotto (core/expiry) e dalle categorie di Open Food Facts.

import type { FoodCategory } from "../../expiry";
import type { DietGroup, PortionKey } from "../types";

/** Categoria del lotto → gruppo. `unknown` dove la categoria mescola gruppi diversi. Sempre una stima. */
export const LOT_CATEGORY_GROUP: Readonly<Record<FoodCategory, DietGroup | "unknown">> = {
  red_meat_fresh: "redMeat",
  ground_meat: "redMeat",
  poultry: "whiteMeat",
  fish_fresh: "fish",
  cold_cuts_sliced: "processedMeat",
  cured_meat_whole: "processedMeat",
  milk_fresh: "milkYogurt",
  milk_uht: "milkYogurt",
  yogurt: "milkYogurt",
  cheese_fresh: "cheese",
  cheese_aged: "cheese",
  butter: "oilsFats",
  eggs: "eggs",
  leafy_vegetables: "vegetables",
  root_vegetables: "vegetables",
  other_vegetables: "vegetables",
  fruit_fresh: "fruit",
  berries: "fruit",
  citrus: "fruit",
  bread_fresh: "refinedGrains",
  bread_packaged: "refinedGrains",
  pasta_fresh: "refinedGrains",
  pasta_dry: "refinedGrains",
  rice_cereals: "refinedGrains",
  legumes_dry: "legumes",
  canned_closed: "unknown",
  sauces_preserves_opened: "condiments",
  leftovers_cooked: "mixedDish",
  ready_meals: "mixedDish",
  frozen_foods: "unknown",
  beverages: "unknown",
  juices_opened: "sugaryDrinks",
  condiments_sauces: "condiments",
  pastries_fresh: "sweets",
  snacks_dry: "unknown",
};

/** Porzione della categoria del lotto, per i gruppi che si contano a porzioni. */
export const LOT_CATEGORY_PORTION: Readonly<Partial<Record<FoodCategory, PortionKey>>> = {
  red_meat_fresh: "redMeat",
  ground_meat: "redMeat",
  poultry: "whiteMeat",
  fish_fresh: "fish",
  cold_cuts_sliced: "processedMeat",
  cured_meat_whole: "processedMeat",
  milk_fresh: "milk",
  milk_uht: "milk",
  yogurt: "yogurt",
  cheese_fresh: "cheeseFresh",
  cheese_aged: "cheeseAged",
  butter: "butter",
  eggs: "eggs",
  leafy_vegetables: "leafySalad",
  root_vegetables: "vegetables",
  other_vegetables: "vegetables",
  fruit_fresh: "fruit",
  berries: "fruit",
  citrus: "fruit",
  bread_fresh: "bread",
  bread_packaged: "bread",
  pasta_fresh: "freshEggPasta",
  pasta_dry: "grains",
  rice_cereals: "grains",
  legumes_dry: "legumesDry",
  juices_opened: "sugaryDrinks",
  pastries_fresh: "sweetBakery",
};

export type CategoryRule = readonly [RegExp, DietGroup, PortionKey?];

/**
 * Regole in ordine sulle categorie di Open Food Facts (inglese, senza prefisso di lingua). La prima che
 * corrisponde a una qualunque categoria del prodotto vince: i casi particolari stanno prima dei generali,
 * perché un prodotto porta anche le categorie antenate («canned-fishes» porta con sé «fishes»).
 */
export const OFF_CATEGORY_RULES: readonly CategoryRule[] = [
  [/^(meals|prepared-meals|ready-meals|frozen-ready-meals|pasta-dishes|rice-dishes|pizzas?|sandwiches|quiches|soups|dishes|lasagnas?|prepared-salads|meal-salads)$/, "mixedDish"],
  // bevande
  [/^(plant-based-milks?|milk-substitutes|plant-based-beverages|soy-milks?|oat-milks?|almond-milks?|rice-milks?|soy-beverages|oat-based-drinks|almond-based-drinks)$/, "otherDrinks"],
  [/^(alcoholic-beverages|wines|red-wines|white-wines|sparkling-wines|beers|spirits|liqueurs|ciders)$/, "alcohol"],
  [/^(fruit-juices|juices-and-nectars|fruit-nectars|orange-juices|apple-juices|smoothies|fruit-based-beverages|sodas|carbonated-drinks|colas|iced-teas|energy-drinks|sweetened-beverages|soft-drinks|syrups|chocolate-milks|flavoured-milks)$/, "sugaryDrinks", "sugaryDrinks"],
  [/^(waters|mineral-waters|spring-waters|natural-mineral-waters|coffees|ground-coffees|coffee-capsules|teas|green-teas|herbal-teas|infusions)$/, "otherDrinks"],
  // dolci prima dei latticini: budini e gelati portano anche le categorie dei latticini
  [/^(sweet-spreads|hazelnut-spreads|cocoa-and-hazelnuts-spreads|chocolate-spreads)$/, "sweets", "spreads"],
  [/^(ice-creams?|ice-cream-tubs|frozen-desserts|sorbets?|cakes|sponge-cakes|tarts|pies|dairy-desserts|puddings?|custards?|tiramisu|panna-cotta|creme-caramel|chilled-desserts|mousses?|desserts)$/, "sweets", "cakes"],
  [/^(biscuits|cookies|biscuits-and-cakes|shortbread-cookies|dry-biscuits|pastries|viennoiseries|croissants|brioches|snack-cakes|sweet-snacks|madeleines|muffins|wafers)$/, "sweets", "sweetBakery"],
  [/^(chocolates?|dark-chocolates|milk-chocolates|chocolate-bars|candies|confectioneries|cereal-bars|snack-bars|bars|protein-bars|chocolate-biscuits)$/, "sweets", "snacks"],
  [/^(jams|marmalades|fruit-preserves|honeys?|maple-syrups)$/, "sugars", "honeyJam"],
  [/^(sugars?|white-sugars|cane-sugars|brown-sugars)$/, "sugars", "sugar"],
  // carni e pesce
  [/^(canned-fishes|canned-tunas?|tunas-in-olive-oil|tunas-in-brine|smoked-fishes|smoked-salmons?|salted-fishes|anchovies-in-oil|canned-sardines|canned-mackerels?|salt-cods?|stockfish)$/, "fish", "fishPreserved"],
  [/^(fishes|fish-and-seafood|seafood|fresh-fish|frozen-fishes|salmons?|cods?|hakes?|sea-breams?|sea-basses?|trouts?|shrimps?|prawns|mussels|clams|squids?|octopus)$/, "fish", "fish"],
  [/^(hams?|cooked-hams?|cured-hams?|prosciuttos?|salamis?|dry-sausages|sausages|frankfurters|hot-dog-sausages|mortadella|bresaola|speck|bacons?|pancetta|charcuteries?|prepared-meats?|cold-cuts|deli-meats|sliced-meats|lunch-meats|sliced-cold-cuts|meat-preserves|canned-meats|pates?|liver-pates?)$/, "processedMeat", "processedMeat"],
  [/^(ducks?|duck-meats?)$/, "redMeat", "redMeat"],
  [/^(poultries?|poultry-meats?|chickens?|chicken-breasts?|chicken-meats?|turkeys?|turkey-breasts?|turkey-meats?|rabbits?|rabbit-meats?)$/, "whiteMeat", "whiteMeat"],
  [/^(beefs?|veals?|porks?|lambs?|red-meats?|minced-meats?|ground-meats?|ground-beefs?|burgers?|hamburgers?|meats?|fresh-meats?|horse-meats?)$/, "redMeat", "redMeat"],
  [/^eggs$/, "eggs", "eggs"],
  // latticini
  [/^(fresh-cheeses?|mozzarellas?|ricottas?|cottage-cheeses?|burrata|stracchino|feta|fetas|robiola)$/, "cheese", "cheeseFresh"],
  [/^(hard-cheeses?|semi-hard-cheeses?|aged-cheeses?|parmesan|parmigiano-reggiano|grana-padano|pecorino|grated-cheeses?|blue-cheeses?|processed-cheeses?|cream-cheeses?|mascarpone|cheeses)$/, "cheese", "cheeseAged"],
  [/(^|-)(yogurts?|yoghurts?|skyr|kefirs?)$|^fermented-milk-products$/, "milkYogurt", "yogurt"],
  [/^(milks|fresh-milks?|uht-milks?|whole-milks?|semi-skimmed-milks?|skimmed-milks?|pasteurised-milks?)$/, "milkYogurt", "milk"],
  [/^(peanut-butters|nut-butters|nuts|tree-nuts|almonds|walnuts|hazelnuts|pistachios|cashew-nuts|cashews|peanuts|seeds|sunflower-seeds|pumpkin-seeds|chia-seeds|flax-seeds|sesame-seeds|nuts-and-their-products)$/, "nutsSeeds", "nutsSeeds"],
  [/^(butters?|creams|whipping-creams|cooking-creams|margarines|lards?)$/, "oilsFats", "butter"],
  [/(^|-)oils?$|^(olive-oils?|extra-virgin-olive-oils?|vegetable-oils?|sunflower-oils?)$/, "oilsFats", "oil"],
  // legumi
  [/^(tofu|tofus|tempeh|tempehs)$/, "legumes", "soy"],
  [/^(canned-legumes|canned-chickpeas|canned-beans|canned-lentils|canned-peas|hummus)$/, "legumes", "legumes"],
  [/^(dried-legumes|dried-lentils|dried-chickpeas|dried-beans|dried-peas)$/, "legumes", "legumesDry"],
  [/^(legumes|pulses|lentils|chickpeas|beans|peas|legumes-and-their-products|frozen-peas)$/, "legumes", "legumes"],
  // patate e snack salati
  [/^(chips|crisps|potato-crisps|salty-snacks|appetizers|popcorn|pretzels|tortilla-chips)$/, "saltySnacks", "snacks"],
  [/^(potatoes|fresh-potatoes|french-fries|frozen-fries|fries|gnocchi|potato-gnocchi)$/, "potatoes", "potatoes"],
  // cereali
  [/^(breakfast-cereals|cereal-flakes|corn-flakes|mueslis?|granolas?|puffed-cereals|extruded-cereals|porridges?)$/, "refinedGrains", "breakfastCereals"],
  [/^(crackers|rusks|breadsticks|grissini|bread-substitutes|rice-cakes|puffed-rice-cakes|crispbreads|taralli|toasts?)$/, "refinedGrains", "breadSubstitutes"],
  [/^(breads?|sliced-breads?|sandwich-breads?|white-breads?|wholemeal-breads?|fresh-breads?|focaccias?|piadinas?|flatbreads?|tortillas?|wraps?)$/, "refinedGrains", "bread"],
  [/^(fresh-pastas?|egg-pastas?|filled-pastas?|fresh-filled-pastas?|stuffed-pastas?)$/, "refinedGrains", "freshEggPasta"],
  [/^(pastas?|dried-pastas?|durum-wheat-pastas?|durum-wheat-semolina-pastas?|whole-wheat-pastas?|spaghetti|noodles|couscous|rices?|cereal-grains|cereals-and-their-products|cereals|flours|wheat-flours|oat-flakes|rolled-oats|barley|spelt|quinoa|polenta|semolinas?)$/, "refinedGrains", "grains"],
  // condimenti prima delle verdure («tomato-sauces» non è verdura)
  [/^(condiments|sauces|tomato-sauces|pestos?|mayonnaises|ketchup|mustards|vinegars|salts|spices|seasonings|dressings|stocks|broths|bouillon-cubes|olives|capers|pickles)$/, "condiments"],
  // verdura e frutta
  [/^(leaf-vegetables?|lettuces?|salads|rocket|spinach|spinaches|lamb-s-lettuce)$/, "vegetables", "leafySalad"],
  [/^(vegetables|fresh-vegetables|frozen-vegetables|canned-vegetables|tomatoes|peeled-tomatoes|chopped-tomatoes|tomato-purees?|passatas?|carrots|onions|peppers|zucchinis?|courgettes|eggplants|aubergines|mushrooms|broccolis?|cauliflowers|cabbages|green-beans|artichokes|asparagus|cucumbers|root-vegetables?)$/, "vegetables", "vegetables"],
  [/^(dried-fruits|dried-apricots|prunes|raisins|dates|dried-figs)$/, "fruit", "driedFruit"],
  [/^(fruits|fresh-fruits?|apples|pears|bananas|oranges|citrus|lemons|mandarins|berries|strawberries|blueberries|raspberries|grapes|kiwis|peaches|apricots|plums|melons|watermelons|frozen-fruits)$/, "fruit", "fruit"],
];

/** Categorie che dicono «integrale» senza il testo degli ingredienti: bastano solo per una stima. */
export const OFF_WHOLE_GRAIN_CATEGORY = /(^|-)(whole-wheat|wholemeal|whole-grain|wholegrain|integral)/;

/**
 * Criterio CREA (p. 53): il prodotto è integrale se il primo ingrediente è una farina o un cereale integrale
 * («con crusca» non basta: è un'aggiunta). Il testo si confronta senza accenti e in minuscolo.
 */
export function firstIngredientIsWholeGrain(ingredientsText: string): boolean {
  const folded = ingredientsText
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*ingredienti\s*:?\s*/, "");
  const first = folded.split(/[,;(:]/)[0] ?? "";
  return /\bintegral[ei]\b/.test(first) && !/\bcrusca\b/.test(first);
}
