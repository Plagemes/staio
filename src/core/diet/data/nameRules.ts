// Gruppo dalle parole italiane del nome. Si usa per le voci non risolte, le bevande, gli ingredienti delle
// ricette e le voci del piano scritte a mano: il risultato è sempre una stima.

import type { DietGroup, PortionKey } from "../types";

export type NameRule = readonly [RegExp, DietGroup, PortionKey?];

/** Minuscolo, senza accenti né punteggiatura, spazi singoli: la forma su cui lavorano le regole. */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/yoghurt|yoghourt|yogourt/g, "yogurt")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * In ordine: la prima che corrisponde vince. I piatti composti e le forme particolari stanno prima delle parole
 * semplici («pasta e fagioli» è un piatto misto, «fagiolini» sono verdura, «burro di arachidi» è frutta secca).
 */
export const NAME_RULES: readonly NameRule[] = [
  // piatti composti
  [/\b(lasagn\w*|pizz[ae]|pizzett\w*|tramezzin\w*|risott\w*|minestron\w*|minestr[ae]|zupp[ae]|vellutat\w*|parmigiana|polpett\w*|polpettone|sushi|kebab|piatto pronto|torta salata|torte salate|quiche|ragu|sugo di carne|cannelloni|paella|calzon\w*|arancin\w*|suppli|crocchett\w*|cotolett\w*|panzerott\w*)\b/, "mixedDish"],
  [/\b(pasta|riso|orzo|farro|spaghetti|penne) (e|con|al|alla|alle|allo|agli|ai)\b/, "mixedDish"],
  [/\b(panin[oi]|piadin[ae]|toast|insalat[ae]|frittat[ae]) (con|di|al|alla|alle) (riso|pasta|farro|orzo|mare|pollo|tonno|polpo|prosciutt\w*|salam\w*|formagg\w*|mozzarell\w*|cotto|crudo)\b/, "mixedDish"],
  // bevande
  [/\b(cacao amaro|cacao in polvere|bicarbonato( di soda)?)\b/, "condiments"],
  [/\bsciroppo d acero\b/, "sugars", "sugar"],
  [/\b(latte|bevanda|bevande|drink)( vegetale)? (di |alla |al )?(soia|avena|riso|mandorl[ae]|cocco|nocciol[ae])\b/, "otherDrinks"],
  [/\bsucco di limone\b/, "condiments"],
  [/\b(cioccolata calda|latte al cioccolato|latte al cacao|frappe|milkshake|frullato)\b/, "sugaryDrinks", "sugaryDrinks"],
  [/\b(succo|succhi|spremut[ae]|nettare|aranciata|limonata|cola|chinotto|gassosa|bibit[ae]|te freddo|the freddo|ice tea|energy drink|acqua tonica|tonica|ginger ale|sciropp[oi]|soda)\b/, "sugaryDrinks", "sugaryDrinks"],
  [/\b(vin[oi]|birr[ae]|prosecco|spumante|champagne|aperitiv\w*|spritz|amaro|amari|grappa|whisky|vodka|gin|rum|liquor\w*|limoncello|cocktail|sidro|sangria)\b/, "alcohol"],
  [/\b(cappuccin[oi]|latte macchiato|caffe ?latte|caffellatte)\b/, "milkYogurt", "milk"],
  [/\b(acqua|caffe|espresso|decaffeinato|ginseng|te|the|tisan[ae]|camomill[ae]|infus[oi]|karkade)\b/, "otherDrinks"],
  // dolci
  [/\b(nutella|crema spalmabile|crema di nocciole|crema al cioccolato|crema alle nocciole)\b/, "sweets", "spreads"],
  [/\b(biscott(?!at)\w*|merendin\w*|brioche|cornett[oi]|croissant|ciambell\w*|plumcake|plum cake|muffin|wafer|savoiard\w*|krapfen|bombolon\w*|frollin\w*|crackers? dolc\w*)\b/, "sweets", "sweetBakery"],
  [/\b(tort[ae]|crostat\w*|pandoro|panettone|colomba|pasticcin\w*|cannol\w*|sfogliatell\w*|tiramisu|panna cotta|budin\w*|creme caramel|gelat[oi]|sorbett\w*|semifredd\w*|cheesecake|pan di spagna|crepes?|pancakes?|waffle|frittell\w*|zeppol\w*|bigne|strudel|pastiera|cassata|profiterole\w*)\b/, "sweets", "cakes"],
  [/\b(cioccolat\w*|barrett\w*|caramell\w*|confett[oi]|gomm[ae] da masticare|liquirizi\w*|pralin\w*|snack dolc\w*|ovetto)\b/, "sweets", "snacks"],
  // carni trasformate e pesce
  [/\b(prosciutt\w*|salam\w*|mortadell\w*|wurstel|wuerstel|bresaol\w*|speck|pancett\w*|coppa|culatell\w*|cotechin\w*|zampone|salsicc\w*|nduja|guancial\w*|carne in scatola|affettat\w*|hot dog|bacon|pate|porchetta|kaiserfleisch)\b/, "processedMeat", "processedMeat"],
  [/\btonno fresc\w*/, "fish", "fish"],
  [/\b(tonno|tonn[oi] in scatola|scatolett\w* di tonno|salmone affumicato|baccala|stoccafisso|(acciugh\w*|alici|sardin\w*|sgombr\w*) (sott olio|in scatola|sotto sale)|aringh\w* affumicat\w*|bottarga)\b/, "fish", "fishPreserved"],
  [/\b(pesce|pesci|salmon\w*|merluzz\w*|nasell\w*|orat[ae]|branzin\w*|spigol\w*|trot[ae]|sgombr\w*|alici|acciugh\w*|sardin\w*|pesce spada|platess\w*|sogliol\w*|rombo|cernia|dentice|ricciola|gamber\w*|scamp\w*|astic\w*|aragost\w*|calamar\w*|totan\w*|polp[oi]|seppi[ae]|seppioline|cozz[ae]|vongol\w*|ostric\w*|capesant\w*|crostace\w*|frutti di mare|mollusch\w*|halibut|tilapia|pangasio|persico|surimi|bastoncini di pesce)\b/, "fish", "fish"],
  // carni
  [/\b(pollo|polli|tacchino|coniglio|faraona|cappone|gallina|quaglia|petto di pollo|sovracosci\w*|fusi di pollo|nuggets?)\b/, "whiteMeat", "whiteMeat"],
  [/\b(manzo|vitell\w*|maiale|suin\w*|agnell\w*|capretto|montone|cavallo|equin\w*|selvaggina|cinghiale|cervo|bovin\w*|bistecc\w*|fiorentina|filett\w*|braciol\w*|costat\w*|costin\w*|spezzatino|ossobuc\w*|carpaccio|tagliata|hamburger|burger|macinat\w*|fegato|trippa|lonza|anatra|scaloppin\w*|fettin[ae]|roast beef|brasato|bollito|carne|carni)\b/, "redMeat", "redMeat"],
  // pasta all'uovo prima delle uova
  [/\b(pasta all uovo|pasta fresca|tagliatell\w*|fettuccin\w*|pappardell\w*|tortellin\w*|tortellon\w*|raviol\w*|cappellett\w*|agnolott\w*|tagliolin\w*|tajarin)\b/, "refinedGrains", "freshEggPasta"],
  [/\b(uov[oa]|frittat\w*|omelette|album\w*|tuorl\w*)\b/, "eggs", "eggs"],
  // latticini
  [/\b(fiocchi di latte|mozzarell\w*|ricott\w*|stracchin\w*|crescenz\w*|burrat\w*|fiordilatte|fior di latte|feta|caprino|primo sale|robiola|squacquerone|quark|philadelphia|formaggio fresco|formaggi freschi|scamorz\w*)\b/, "cheese", "cheeseFresh"],
  [/\b(parmigian\w*|grana|pecorin\w*|gorgonzol\w*|fontin\w*|provolon\w*|emmental|groviera|gruyere|asiago|montasio|taleggio|caciott\w*|caciocavall\w*|cheddar|gouda|brie|camembert|edam|edamer|mascarpone|formagg\w*|scaglie)\b/, "cheese", "cheeseAged"],
  [/\b(yogurt|kefir|skyr|latte fermentato)\b/, "milkYogurt", "yogurt"],
  [/\b(latte condensato)\b/, "sweets", "spreads"],
  [/\blatte\b/, "milkYogurt", "milk"],
  // frutta secca prima dei grassi («burro di arachidi»)
  [/\b(burro di arachidi|crema di arachidi|noci|noce(?! moscata)|mandorl\w*|nocciol\w*|pistacch\w*|anacard\w*|arachid\w*|pinol\w*|macadamia|pecan|semi|frutta secca|frutta a guscio|tahin\w*|castagn\w*|cocco)\b/, "nutsSeeds", "nutsSeeds"],
  [/\b(burro|panna|strutto|margarina|lardo)\b/, "oilsFats", "butter"],
  [/\b(olio|oli)\b/, "oilsFats", "oil"],
  // verdura che somiglia ai legumi
  [/\b(fagiolin[oi]|taccol\w*)\b/, "vegetables", "vegetables"],
  // legumi
  [/\b(tofu|tempeh|seitan di soia)\b/, "legumes", "soy"],
  [/\b(lenticch\w*|ceci|cece|fagiol\w*|pisell\w*|fave|fava|lupin\w*|cicerch\w*|soia) secch\w*/, "legumes", "legumesDry"],
  [/\b(lenticch\w*|ceci|cece|fagiol\w*|pisell\w*|fave|fava|lupin\w*|cicerch\w*|edamame|soia|legum\w*|hummus|azuki|mung)\b/, "legumes", "legumes"],
  // patate e snack salati
  [/\b(patatine fritte|patate fritte|gnocch\w*|pure|patat[ae])\b/, "potatoes", "potatoes"],
  [/\b(patatin\w*|chips|pop ?corn|salatin\w*|snack salat\w*|nachos|pretzel\w*)\b/, "saltySnacks", "snacks"],
  // cereali
  [/\b(fiocchi d avena|fiocchi di avena|porridge|avena)\b/, "wholeGrains", "breakfastCereals"],
  [/\b(cereali da colazione|corn ?flakes|muesli|granola|fiocchi di mais|fiocchi di cereali|cereali)\b/, "refinedGrains", "breakfastCereals"],
  [/\b(cracker\w*|grissin\w*|fett[ae] biscottat[ae]|gallett\w*|frisell\w*|tarall\w*|crostin\w*|crackers)\b/, "refinedGrains", "breadSubstitutes"],
  [/\b(pane|panin[oi]|pagnott\w*|baguette|rosett\w*|ciabatt\w*|focacc\w*|piadin[ae]|pan ?carre|pita|bruschett\w*|toast|tramezzino)\b/, "refinedGrains", "bread"],
  [/\b(pasta|spaghett\w*|penne|fusilli|rigatoni|farfalle|maccheron\w*|linguine|bucatini|orecchiette|paccheri|tortiglioni|mezze maniche|ditalini|conchiglie|trofie|riso|farro|orzo|cous ?cous|bulgur|quinoa|miglio|polenta|semola|farin[ae]|grano saraceno|amaranto|noodles|vermicelli)\b/, "refinedGrains", "grains"],
  // zuccheri
  [/\b(zuccher\w*|sciroppo d acero|melassa|dolcificant\w*)\b/, "sugars", "sugar"],
  [/\b(miele|marmellat\w*|confettur\w*|composta)\b/, "sugars", "honeyJam"],
  // condimenti prima di verdura e frutta («salsa di pomodoro»)
  [/\b(sale|pepe|acet\w*|senape|ketchup|maionese|sals[ae]|sugo|pesto|dado|brodo|spezie|origano|basilico|prezzemol\w*|rosmarin\w*|salvia|timo|curry|paprica|curcuma|cannella|vaniglia|lievit\w*|capperi|oliv[ae]|sottacet\w*|gomasio|aglio|peperoncin\w*|noce moscata|zenzero|cacao)\b/, "condiments"],
  // verdura
  [/\b(insalat\w*|lattug\w*|rucol\w*|valerian\w*|radicch\w*|indivi\w*|scarol\w*|songino|misticanza|crescione|lattughino)\b/, "vegetables", "leafySalad"],
  [/\b(spinac\w*|bietol\w*|cavol\w*|verz\w*|broccol\w*|carot\w*|zucchin\w*|zucc[ah]e?|melanzan\w*|peperon\w*|pomodor\w*|cetriol\w*|finocch\w*|sedan\w*|carciof\w*|asparag\w*|cipoll\w*|porr[oi]|fungh\w*|fungo|champignon|porcin\w*|barbabietol\w*|rap[ae]|ravanell\w*|rapanell\w*|cime di rapa|friariell\w*|cicori\w*|catalogn\w*|erbett\w*|verdur\w*|ortagg\w*|passata|pelati|polpa di pomodoro|mais|germogli|scalogn\w*)\b/, "vegetables", "vegetables"],
  // frutta
  [/\b(datter\w*|uvetta|frutta secca disidratata|(fich\w*|albicocc\w*|prugn\w*|mel[ae]) secch\w*|frutta essiccata|frutta disidratata)\b/, "fruit", "driedFruit"],
  [/\b(mel[ae]|per[ae]|banan\w*|aranc\w*|mandarin\w*|clementin\w*|limon\w*|lime|pompelm\w*|fragol\w*|cilieg\w*|pesca|pesche|nettarin\w*|albicocc\w*|prugn\w*|susin\w*|uva|kiwi|ananas|melon\w*|anguri\w*|cocomer\w*|fic[oh]i?|cachi|kaki|mirtill\w*|lampon\w*|more|ribes|melagran\w*|avocado|mango|papaya|papaia|frutta|macedonia|frutti di bosco|caco)\b/, "fruit", "fruit"],
];

/** Parole che rendono integrale un cereale riconosciuto dal nome (stessi cereali di `isWholeGrainKey`). */
const WHOLE_GRAIN_WORDS = /\b(integral[ei]|quinoa|miglio|bulgur|avena|grano saraceno|amaranto)\b/;

export interface NameMatch {
  group: DietGroup;
  portionKey?: PortionKey;
}

/** Gruppo dal nome, oppure `undefined` se nessuna parola nota compare. */
export function nameRuleOf(name: string): NameMatch | undefined {
  const text = foldName(name);
  if (text === "") return undefined;
  for (const [pattern, group, portionKey] of NAME_RULES) {
    if (!pattern.test(text)) continue;
    const g: DietGroup = group === "refinedGrains" && WHOLE_GRAIN_WORDS.test(text) ? "wholeGrains" : group;
    return portionKey !== undefined ? { group: g, portionKey } : { group: g };
  }
  return undefined;
}
