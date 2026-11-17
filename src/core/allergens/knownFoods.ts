// L'elenco chiuso degli alimenti semplici riconosciuti: con allergeni dichiarati un ingrediente è `clear` solo se il suo
// nome nomina UN alimento semplice (più quantità, tagli e aggettivi innocui) e nessuna tabella lo tocca. Tutto il resto
// è `uncertain`.
//
// Semplice = non lavorato o a ingrediente unico: verdura e frutta fresche, carne e pesce non lavorati, uova, legumi
// secchi o freschi, cereali in chicco e loro farine, oli, latte e formaggi semplici, sale, zucchero, spezie pure.
// Non sono semplici, anche se fatti di un solo alimento: prodotti da forno, cereali da colazione, dolci, salse e
// condimenti, conserve e sottaceti, bevande (tranne acqua e caffè), piatti pronti, salumi. Per quelli ciò che non è
// certo è `uncertain`: il pane resta `contains` per il glutine e `uncertain` per sesamo, latte, soia e uova.
//
// Fonti: la tabella di composizione degli alimenti del progetto (`../nutrition/data/foods`), voce per voce con la
// decisione esplicita in `SIMPLE_NUTRITION_IDS`, più un elenco compilato qui di alimenti semplici comuni che lì mancano.
import { FOODS } from "../nutrition/data/foods";
import type { AllergenKey } from "./tables";

/**
 * Che cosa è un alimento, per le regole che ne dipendono: un `cut` (filetto, petto, coscia) non basta da solo; una
 * riga di sola carne può nominare più alimenti («fettine di vitello»); il secco vale per i solfiti su `produce` e `fish`.
 */
export type FoodKind = "produce" | "fish" | "meat" | "cut" | "legume" | "grain" | "dairy" | "egg" | "nut" | "seed" | "fat" | "herb" | "spice" | "basic";

export interface KnownFoodSource {
  /** Da dove viene: id della tabella nutrizionale, o «elenco-…» per quelli compilati qui. */
  id: string;
  /** Il nome completo, controllato con le tabelle degli allergeni per sapere che cosa contiene l'alimento. */
  name: string;
  /** I nomi con cui riconoscerlo. */
  phrases: readonly string[];
  /** Allergeni che l'alimento contiene (o può contenere) per gruppo anche se il nome non lo dice. */
  implied: readonly AllergenKey[] | "all";
  /** Alimento semplice: i suoi nomi possono dare `clear`. Se no, i suoi nomi non valgono per nessun allergene. */
  simple: boolean;
  kind?: FoodKind;
}

/** Gruppi della tabella nutrizionale e allergeni che implicano. I salumi non sono mai alimenti semplici. */
export const GROUP_ALLERGENS: Readonly<Record<string, readonly AllergenKey[] | "all">> = {
  latticini: ["latte"],
  uova: ["uova"],
  pesce: ["pesce", "crostacei", "molluschi"],
  // frutta a guscio, arachidi e sesamo si lavorano negli stessi impianti
  "frutta-secca": ["frutta a guscio", "arachidi", "sesamo"],
  salumi: "all",
};

const GROUP_KIND: Readonly<Record<string, FoodKind>> = {
  frutta: "produce",
  verdura: "produce",
  legumi: "legume",
  cereali: "grain",
  latticini: "dairy",
  uova: "egg",
  carne: "meat",
  salumi: "meat",
  pesce: "fish",
  "frutta-secca": "nut",
  "oli-e-grassi": "fat",
  dolci: "basic",
  bevande: "basic",
  condimenti: "basic",
};

/**
 * Le voci della tabella nutrizionale ammesse come alimenti semplici, decise una per una. Ogni voce che manca qui non è
 * semplice. Escluse di proposito: frutta secca e disidratata, conserve e sottaceti (pelati, passata, olive, capperi),
 * legumi in scatola e surgelati, tofu e tempeh, pasta fresca e all'uovo, pane e prodotti da forno, cereali da
 * colazione, porridge, latte in polvere e condensato, formaggi con lisozima o additivi (provolone, gouda, mozzarella
 * per pizza, spalmabili), carne brasata o in umido, pesce affumicato o in scatola, baccalà, cocco (di solito
 * disidratato), burro di arachidi, margarina, cacao, dolci, bevande tranne acqua e caffè, salse, brodi, dadi, curry,
 * lieviti secchi e chimici.
 */
export const SIMPLE_NUTRITION_IDS: ReadonlySet<string> = new Set([
  // frutta fresca
  "mela-cruda", "pera-cruda", "banana-cruda", "arancia-cruda", "mandarino-crudo", "limone-crudo", "pompelmo-crudo",
  "fragola-cruda", "ciliegia-cruda", "pesca-cruda", "nettarina-cruda", "albicocca-cruda", "prugna-cruda", "uva-cruda",
  "kiwi-crudo", "ananas-crudo", "melone-cantalupo-crudo", "anguria-cruda", "fico-crudo", "cachi-crudo",
  "mirtillo-crudo", "lampone-crudo", "mora-cruda", "ribes-rosso-crudo", "melagrana-cruda", "avocado-crudo",
  "mango-crudo", "lime-crudo", "papaia-cruda",
  // verdura fresca
  "pomodoro-crudo", "pomodoro-ciliegino-crudo", "cetriolo-crudo", "lattuga-cappuccia-cruda",
  "lattuga-a-foglia-verde-cruda", "indivia-cruda", "radicchio-crudo", "rucola-cruda", "carota-cruda", "carota-cotta",
  "patata-cruda", "patata-lessa", "patata-dolce-cruda", "cipolla-cruda", "cipollotto-crudo", "aglio-crudo",
  "porro-crudo", "peperone-rosso-crudo", "peperoncino-rosso-crudo", "melanzana-cruda", "zucchina-cruda",
  "zucchina-lessata", "zucca-cruda", "spinaci-crudi", "spinaci-lessati", "bietola-cruda", "bietola-lessata",
  "broccolo-crudo", "broccolo-lessato", "cavolfiore-crudo", "cavolfiore-lessato", "cavolo-cappuccio-crudo",
  "verza-cruda", "sedano-crudo", "finocchio-crudo", "carciofo-crudo", "asparagi-crudi", "barbabietola-cruda",
  "funghi-champignon-crudi", "funghi-champignon-lessati", "fagiolini-crudi", "fagiolini-lessati",
  "piselli-freschi-crudi", "mais-dolce-crudo", "lattuga-romana-cruda", "rapanello-crudo", "cavolo-riccio-crudo",
  "cavolini-di-bruxelles-crudi", "peperone-giallo-crudo", "peperone-verde-crudo", "cipolla-rossa-cruda",
  // legumi secchi e lessati
  "lenticchie-secche", "lenticchie-lessate", "ceci-secchi", "ceci-lessati", "fagioli-cannellini-secchi",
  "fagioli-cannellini-lessati", "fagioli-borlotti-lessati", "fagioli-rossi-secchi", "fagioli-rossi-lessati",
  "piselli-secchi-spaccati", "piselli-secchi-lessati", "fave-secche", "fave-lessate", "soia-secca", "soia-lessata",
  "lupini-lessati", "lupini-secchi",
  // cereali in chicco, farine, pasta secca di semola
  "pasta-secca", "pasta-cotta", "pasta-integrale-secca", "pasta-integrale-cotta", "riso-bianco-crudo",
  "riso-bianco-lessato", "riso-tondo-crudo", "riso-tondo-lessato", "riso-integrale-crudo", "riso-integrale-lessato",
  "farina-00", "farina-integrale", "semola-di-grano-duro", "farina-di-mais", "amido-di-mais", "fiocchi-di-avena",
  "orzo-perlato-crudo", "orzo-perlato-lessato", "farro-crudo", "farro-lessato", "bulgur-secco", "bulgur-lessato",
  "couscous-secco", "couscous-lessato", "quinoa-cruda", "quinoa-lessata", "miglio-crudo", "miglio-lessato",
  // latte e formaggi semplici
  "latte-intero", "latte-parzialmente-scremato", "latte-scremato", "latte-di-capra", "kefir", "yogurt-intero-naturale",
  "yogurt-magro-naturale", "yogurt-greco-intero", "panna-fresca", "burro", "parmigiano-reggiano", "pecorino-romano",
  "mozzarella-fiordilatte", "ricotta-intera", "gorgonzola", "fontina", "emmental", "formaggio-di-capra-fresco",
  "cheddar", "feta", "brie",
  // uova
  "uovo-intero-crudo", "uovo-tuorlo-crudo", "uovo-albume-crudo", "uovo-sodo", "uovo-di-quaglia",
  // carne cruda o cotta senza altro
  "manzo-macinato-85-crudo", "manzo-fesa-cruda", "manzo-girello-crudo", "manzo-girello-arrosto", "manzo-filetto-crudo",
  "manzo-controfiletto-crudo", "manzo-spalla-cruda", "manzo-sottofesa-cruda", "manzo-scamone-crudo",
  "manzo-costata-cruda", "manzo-costata-cotta", "manzo-fegato-crudo", "maiale-lonza-cruda", "maiale-lonza-arrosto",
  "maiale-braciola-cruda", "maiale-filetto-crudo", "maiale-filetto-arrosto", "maiale-macinato-crudo",
  "maiale-macinato-cotto", "maiale-spalla-cruda", "maiale-spalla-arrosto", "maiale-coscia-cruda",
  "maiale-coscia-arrosto", "maiale-costine-crude", "maiale-pancetta-fresca-cruda", "maiale-fegato-crudo",
  "agnello-crudo", "agnello-cosciotto-arrosto", "coniglio-crudo", "coniglio-arrosto", "pollo-petto-crudo",
  "pollo-petto-cotto", "pollo-coscia-con-pelle-cruda", "pollo-coscia-con-pelle-arrosto", "pollo-ala-con-pelle-cruda",
  "pollo-intero-crudo", "pollo-intero-arrosto", "tacchino-petto-crudo", "tacchino-petto-arrosto",
  "anatra-senza-pelle-cruda", "vitello-fesa-cruda", "vitello-crudo", "vitello-cotto", "vitello-costoletta-grigliata",
  // pesce fresco
  "salmone-allevamento-crudo", "salmone-allevamento-cotto", "tonno-fresco-crudo", "merluzzo-crudo", "merluzzo-cotto",
  "nasello-crudo", "platessa-crudo", "platessa-cotto", "branzino-crudo", "trota-allevamento-cruda",
  "trota-allevamento-cotta", "pesce-spada-crudo", "sgombro-atlantico-crudo", "acciughe-crude", "tilapia-cruda",
  "gamberi-crudi", "gamberi-lessati", "astice-crudo", "calamari-crudi", "polpo-crudo", "seppia-cruda", "cozze-crude",
  "vongole-crude", "ostriche-crude", "capesante-crude",
  // frutta a guscio e semi
  "mandorle", "noci", "nocciole", "pinoli", "pistacchi", "anacardi", "castagne-crude", "arachidi", "semi-di-sesamo",
  "semi-di-girasole", "semi-di-zucca", "semi-di-lino", "semi-di-chia",
  // oli e grassi
  "olio-d-oliva", "olio-di-semi-di-girasole", "olio-di-mais", "olio-di-colza", "olio-di-cocco", "strutto",
  // di base
  "zucchero-semolato", "zucchero-di-canna", "miele", "acqua", "caffe-espresso", "te-nero",
  // sale, erbe, spezie pure
  "sale-da-cucina", "pepe-nero", "basilico-fresco", "prezzemolo-fresco", "rosmarino-fresco", "timo-fresco",
  "zenzero-fresco", "origano-secco", "alloro", "paprica", "peperoncino-in-polvere", "cannella", "noce-moscata",
  "curcuma", "cumino", "zafferano", "lievito-di-birra-fresco", "bicarbonato",
]);

/** Le voci della tabella nutrizionale che non sono alimenti semplici: tutte quelle che `SIMPLE_NUTRITION_IDS` non ammette. */
export const NOT_SIMPLE_FOOD_IDS: ReadonlySet<string> = new Set(FOODS.filter((f) => !SIMPLE_NUTRITION_IDS.has(f.id)).map((f) => f.id));

/**
 * Nomi che una voce semplice usa ma che indicano di solito un piatto, un prodotto confezionato o una cosa ambigua:
 * «risotto» (alias del riso tondo), «hamburger», «tonno» (quasi sempre in scatola), «yogurt» (spesso alla frutta o ai
 * cereali), «grana» (con lisozima, da uovo). Non valgono per nessun allergene.
 */
export const NOT_SIMPLE_ALIASES: readonly string[] = [
  "risotto", "porridge", "hamburger", "hamburger di manzo", "hamburger crudo", "hamburger cotto", "spezzatino",
  "spezzatino di manzo", "spezzatino di maiale", "spezzatino di agnello", "brasato", "brasato di manzo", "stracotto",
  "rosbif", "roast beef", "arrosto di manzo", "arrosto di maiale", "prosciutto fresco", "scaloppine", "scaloppina di vitello", "carne per saltimbocca", "spezzatino di vitello",
  "cotoletta di vitello", "tonno", "tagliatelle secche", "mais dolce", "granturco dolce", "yogurt", "grana",
  "grana padano", "pecorino grattugiato", "formaggio", "formaggi", "formaggio blu", "blu", "greco", "insalata",
  "insalata verde", "legumi", "frutta secca", "caffe al bar", "rosso", "te",
];

/** Nomi di prodotti lavorati fatti di parole che da sole sarebbero alimenti semplici e aggettivi innocui. */
const NOT_SIMPLE_PHRASES: readonly string[] = [
  "pomodori pelati", "pomodoro pelato", "pomodorini pelati", "pelati interi", "polpa di pomodoro", "pomodori secchi",
  "frutti di bosco", "frutti rossi", "frutta fresca", "frutta mista", "verdure miste", "germogli di soia",
  "insalata mista", "riso soffiato", "mais tostato", "patate duchessa", "patate schiacciate", "carne di soia",
  "macinato misto", "coda di bue",
];

const headOf = (name: string): string => (name.split(",")[0] ?? name).replace(/\([^)]*\)/g, " ").trim();

const notSimpleAlias = new Set(NOT_SIMPLE_ALIASES);

/** Crostacei del commercio: spesso trattati con solfiti (metabisolfito) contro l'annerimento. */
const SULFITE_TREATED_IDS: ReadonlySet<string> = new Set(["gamberi-crudi", "gamberi-lessati", "astice-crudo"]);

const withSulfites = (id: string, implied: readonly AllergenKey[] | "all"): readonly AllergenKey[] | "all" =>
  implied !== "all" && SULFITE_TREATED_IDS.has(id) ? [...implied, "solfiti"] : implied;

const fromNutrition: KnownFoodSource[] = FOODS.map((f) => {
  const simple = SIMPLE_NUTRITION_IDS.has(f.id);
  const all = [headOf(f.name), ...(f.aliases ?? [])];
  const kind = GROUP_KIND[f.group];
  return {
    id: f.id,
    name: f.name,
    phrases: simple ? all.filter((p) => !notSimpleAlias.has(p.toLowerCase())) : all,
    implied: withSulfites(f.id, GROUP_ALLERGENS[f.group] ?? []),
    simple,
    ...(kind ? { kind } : {}),
  };
});

const FISH: readonly AllergenKey[] = ["pesce", "crostacei", "molluschi"];
const NUT_PLANT: readonly AllergenKey[] = ["frutta a guscio", "arachidi", "sesamo"];

/** Alimenti semplici comuni che la tabella nutrizionale non ha. Forma base: plurali e accenti si riconoscono da sé. */
const LISTED: ReadonlyArray<readonly [FoodKind, readonly AllergenKey[], readonly string[]]> = [
  [
    "produce",
    [],
    [
      // verdure
      "zucchina", "zucchino", "fiori di zucca", "fiori di zucchina", "melanzana", "peperone", "friggitelli", "pomodoro",
      "pomodorino", "pomodori san marzano", "pomodoro cuore di bue", "pomodoro ramato", "pomodori pachino", "carota",
      "patata", "patate novelle", "cipolla", "cipolla bianca", "cipolla di tropea", "scalogno", "aglio", "porro",
      "finocchio", "carciofo", "asparago", "asparagi bianchi", "broccolo", "broccoletti", "cavolfiore", "cavolo",
      "cavolo nero", "cavolo rosso", "cavolo cappuccio", "verza", "cavolini di bruxelles", "rapa", "rape",
      "cime di rapa", "friarielli", "ravanello", "barbabietola", "bietola", "biete", "erbette", "spinaci", "spinacini",
      "lattuga", "rucola", "valeriana", "songino", "misticanza", "indivia", "indivia belga", "scarola", "radicchio",
      "radicchio di treviso", "cicoria", "catalogna", "puntarelle", "crescione", "tarassaco", "borragine", "ortica",
      "cetriolo", "zucca", "zucca delica", "zucca mantovana", "fagiolini", "taccole", "piselli", "fave fresche", "mais",
      "pannocchia", "funghi", "champignon", "porcini", "funghi porcini", "finferli", "galletti", "chiodini",
      "pleurotus", "shiitake", "tartufo nero", "tartufo bianco", "topinambur", "pastinaca", "daikon", "okra", "cardo",
      "cardi", "patata dolce", "batata", "peperoncino", "lattughino", "cicorino", "agretti", "barba di frate",
      "cavolo romanesco", "romanesco", "broccolo romanesco", "zucchine trombetta", "melanzane viola", "peperoni corno",
      "cipolle borettane", "cipolline", "aglio orsino", "porri", "cetriolini freschi", "sedano rapa",
      // frutta
      "mela", "mela golden", "mela renetta", "mela verde", "pera", "pera williams", "pera abate", "banana", "arancia",
      "arance rosse", "mandarino", "clementina", "mandarancio", "limone", "lime", "pompelmo", "fragola", "fragoline",
      "ciliegia", "amarene fresche", "pesca", "pesca tabacchiera", "nettarina", "albicocca", "prugna", "susina", "uva",
      "uva bianca", "uva nera", "kiwi", "ananas", "melone", "anguria", "cocomero", "fico", "fichi d india", "cachi",
      "mirtillo", "lampone", "mora", "ribes", "melagrana", "melograno", "mango", "papaia", "frutto della passione",
      "maracuja", "litchi", "lychee", "avocado", "nespola", "cedro", "bergamotto", "kumquat", "mela cotogna",
      "giuggiole", "uva spina", "gelso", "physalis", "pitaya", "carambola", "guava", "scorza di limone",
      "scorza d arancia", "buccia di limone",
    ],
  ],
  [
    "meat",
    [],
    [
      "manzo", "vitello", "vitellone", "bovino", "scottona", "maiale", "suino", "pollo", "galletto", "tacchino",
      "agnello", "capretto", "abbacchio", "montone", "pecora", "coniglio", "anatra", "oca", "faraona", "quaglia",
      "piccione", "cappone", "gallina", "cavallo", "puledro", "asino", "cinghiale", "cervo", "capriolo", "daino",
      "lepre", "fagiano", "carne", "carne bianca", "carne rossa", "carne macinata", "trippa", "ossobuco", "ossibuchi",
      "lonza", "arista", "girello", "scamone", "costata", "costate", "fiorentina", "entrecote", "carne di cavallo",
      "fuselli di pollo", "ala di pollo",
    ],
  ],
  [
    // tagli e frattaglie: non dicono di quale animale (anche pesce: «filetto», «coda di rospo», «lingua»)
    "cut",
    [],
    [
      "fegato", "fegatini", "lingua", "cuore", "rognone", "rognoni", "animelle", "cotenna", "cotiche", "guancia",
      "guancette", "coda", "stinco", "stinchi", "lombo", "filetto", "controfiletto", "fesa", "sottofesa", "fettine",
      "bistecca", "bistecche", "braciola", "braciole", "costolette", "costine", "puntine", "spalla", "coscia", "cosce",
      "sovracoscia", "sovracosce", "fusi", "petto", "ali", "alette", "ala", "busto", "carre", "cosciotto", "midollo",
      "polmone", "milza", "reni", "zampetto", "piedini", "frattaglie", "rigaglie", "trancio", "tranci", "filetti",
    ],
  ],
  [
    "legume",
    [],
    [
      "lenticchie", "lenticchie rosse", "lenticchie decorticate", "lenticchie di castelluccio", "ceci", "fagioli",
      "cannellini", "borlotti", "fagioli neri", "fagioli dall occhio", "fagioli azuki", "azuki", "fagioli di lima",
      "fagioli corona", "fagioli spagna", "piattellini", "cicerchie", "fave", "piselli secchi", "roveja",
    ],
  ],
  [
    // cereali e amidi senza glutine
    "grain",
    [],
    [
      "riso", "riso basmati", "riso venere", "riso integrale", "riso carnaroli", "riso arborio", "riso vialone nano",
      "riso rosso", "riso nero", "riso selvatico", "riso jasmine", "riso thai", "riso parboiled", "riso glutinoso",
      "quinoa", "miglio", "amaranto", "sorgo", "teff", "tapioca", "fecola di patate", "fecola", "amido di mais",
      "maizena", "amido di riso", "amido di tapioca", "manioca", "cassava", "arrowroot",
    ],
  ],
  [
    "seed",
    NUT_PLANT,
    [
      "semi di zucca", "semi di girasole", "semi di lino", "semi di chia", "semi di papavero", "semi di canapa", "chia",
      "lino", "papavero",
    ],
  ],
  [
    "herb",
    [],
    [
      "basilico", "prezzemolo", "rosmarino", "salvia", "timo", "origano", "maggiorana", "menta", "mentuccia", "alloro",
      "foglie di alloro", "erba cipollina", "aneto", "dragoncello", "estragone", "cerfoglio", "coriandolo",
      "finocchietto", "finocchietto selvatico", "santoreggia", "melissa", "nepitella", "lemongrass", "citronella",
      "foglie di lime", "foglie di curry", "levistico", "timo limone", "basilico thai",
    ],
  ],
  [
    "spice",
    [],
    [
      "pepe", "pepe nero", "pepe bianco", "pepe rosa", "pepe verde", "pepe di sichuan", "pepe lungo",
      "peperoncino in polvere", "peperoncino secco", "peperoncino in scaglie", "paprika", "paprica", "paprika dolce",
      "paprika affumicata", "cannella", "stecca di cannella", "noce moscata", "chiodi di garofano", "cumino",
      "cumino nero", "coriandolo in polvere", "curcuma", "zenzero", "zenzero in polvere", "zafferano", "cardamomo",
      "anice stellato", "anice", "semi di anice", "semi di finocchio", "semi di cumino", "semi di coriandolo",
      "vaniglia", "bacca di vaniglia", "baccello di vaniglia", "ginepro", "bacche di ginepro", "pimento", "sommacco",
      "sumac", "fieno greco", "galanga", "assafetida", "cayenna", "pepe di cayenna", "macis",
    ],
  ],
  [
    "fat",
    [],
    [
      "olio d oliva", "olio di oliva", "olio extravergine", "olio extravergine d oliva", "olio extra vergine",
      "olio evo", "olio di girasole", "olio di semi di girasole", "olio di mais", "olio di riso", "olio di cocco",
      "olio di avocado", "olio di vinacciolo", "olio di semi di lino", "olio di colza", "olio di canola", "canola",
      "strutto", "sugna", "olio d oliva extravergine",
    ],
  ],
  [
    "basic",
    [],
    [
      "sale", "sale fino", "sale grosso", "sale marino", "sale rosa", "sale integrale", "sale iodato", "sale di maldon",
      "fior di sale", "fleur de sel", "zucchero", "zucchero semolato", "zucchero di canna", "zucchero muscovado",
      "zucchero integrale", "zucchero di cocco", "miele", "miele di acacia", "miele millefiori", "acqua",
      "acqua frizzante", "acqua tiepida", "acqua calda", "acqua fredda", "ghiaccio", "cubetti di ghiaccio", "caffe",
      "caffe espresso", "bicarbonato", "bicarbonato di sodio", "agar agar", "agar",
    ],
  ],
  [
    "fish",
    FISH,
    [
      "orata", "dentice", "cernia", "ricciola", "palombo", "triglia", "triglie", "scorfano", "rana pescatrice",
      "coda di rospo", "pagello", "sarago", "cefalo", "muggine", "aringa", "anguilla", "storione", "persico", "luccio",
      "carpa", "salmerino", "sarde", "sardine", "alici", "acciughe", "totani", "moscardini", "seppioline", "pesce", "pesci", "pesce bianco", "spigola", "branzino", "rombo",
      "sogliola", "merluzzo", "nasello", "salmone", "trota", "sgombro", "pesce spada", "calamari", "polpo", "seppia",
      "cozze", "vongole", "ostriche", "capesante",
    ],
  ],
  [
    "fish",
    [...FISH, "solfiti"],
    ["canocchie", "scampi", "mazzancolle", "granchio", "aragosta", "gamberi", "gamberetti", "astice"],
  ],
  [
    "dairy",
    ["latte"],
    [
      "crema di latte", "panna", "panna fresca", "burro", "latte", "mozzarella", "ricotta", "parmigiano",
      "yogurt bianco", "yogurt naturale",
    ],
  ],
  ["egg", ["uova"], ["uovo", "uova", "tuorlo", "albume"]],
];

const fromList: KnownFoodSource[] = LISTED.map(([kind, implied, phrases], i) => ({
  id: `elenco-${i}`,
  name: "",
  phrases,
  implied,
  simple: true,
  kind,
}));

/**
 * Nomi semplici che non bastano per alcuni allergeni: «olio» o «olio di semi» possono essere di arachidi, di soia, di
 * sesamo. Per gli altri allergeni valgono.
 */
const RESTRICTED: KnownFoodSource[] = [
  {
    id: "olio-generico",
    name: "",
    phrases: ["olio", "olio di semi", "olio di semi vari", "olio vegetale", "olio per friggere"],
    implied: ["arachidi", "soia", "sesamo"],
    simple: true,
    kind: "fat",
  },
  {
    // «pasta» senza altro può essere all'uovo, e le linee della pasta secca lavorano anche uova e soia
    id: "pasta-generica",
    name: "",
    phrases: ["pasta"],
    implied: ["uova", "soia"],
    simple: true,
    kind: "grain",
  },
];

const NOT_SIMPLE: KnownFoodSource[] = [
  { id: "nomi-non-semplici", name: "", phrases: [...NOT_SIMPLE_ALIASES, ...NOT_SIMPLE_PHRASES], implied: "all", simple: false },
];

export const KNOWN_FOOD_SOURCES: readonly KnownFoodSource[] = [...fromNutrition, ...fromList, ...RESTRICTED, ...NOT_SIMPLE];

/**
 * Parole che accompagnano un alimento senza cambiarne il contenuto: quantità, unità, taglio, dimensione, colore,
 * maturazione, provenienza, cottura casalinga semplice. Non bastano da sole: «rosso» da solo non è un alimento
 * riconosciuto. Le parole di prodotti lavorati («misto», «surgelato», «pronto»…) stanno in `PROCESSED_WORDS`.
 */
export const MODIFIER_WORDS: readonly string[] = [
  // quantità e unità
  "g", "gr", "grammi", "grammo", "kg", "chili", "chilo", "hg", "etto", "etti", "mg", "ml", "cl", "dl", "l", "lt",
  "litro", "litri", "cc", "cucchiaio", "cucchiai", "cucchiaino", "cucchiaini", "tazza", "tazze", "tazzina", "bicchiere",
  "bicchieri", "pizzico", "pizzichi", "presa", "q", "b", "qb", "quanto", "basta", "spicchio", "spicchi", "foglia",
  "foglie", "fogliolina", "foglioline", "ciuffo", "ciuffi", "mazzetto", "mazzo", "rametto", "rametti", "ramo", "rami",
  "fetta", "fette", "fettina", "pezzo", "pezzi", "pezzetto", "pezzetti", "costa", "coste", "cespo", "cespi", "manciata",
  "pugno", "bustina", "panetto", "cubetto", "cubetti", "dadini", "spicchietti", "mezzo", "mezza", "meta", "circa",
  "abbondante", "abbondanti", "scarso", "scarsa", "qualche", "alcuni", "alcune", "poco", "poca", "pochi", "un", "due",
  "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "dozzina", "pz", "n", "nr", "x", "cm", "mm",
  "gocce", "goccia", "filo", "giro", "punta", "stecca", "stecche", "baccello", "bacca", "bacche", "grani", "granelli",
  "seme", "semi",
  // dimensioni, stato, cottura casalinga semplice
  "piccolo", "piccola", "piccoli", "piccole", "grande", "grandi", "grosso", "grossa", "medio", "media", "medi",
  "maturo", "matura", "maturi", "mature", "acerbo", "fresco", "fresca", "freschi", "fresche", "freschissimo", "crudo",
  "cruda", "crudi", "crude", "cotto", "cotta", "cotti", "cotte", "lesso", "lessa", "lessi", "lessato", "lessati",
  "bollito", "bolliti", "vapore", "forno", "griglia", "grigliato", "grigliati", "arrosto", "piastra", "padella",
  "tritato", "tritata", "tritati", "tritate", "trito", "triturato", "macinato", "macinata", "macinati", "macinate",
  "grattugiato", "grattugiata", "intero", "intera", "interi", "intere", "tagliato", "tagliata", "tagliati", "tagliate",
  "affettato", "affettata", "affettati", "a", "julienne", "rondelle", "listarelle", "striscioline", "dadolata",
  "tocchetti", "cubettato", "sbucciato", "sbucciata", "sbucciati", "pelato", "pelata", "mondato", "mondati", "pulito",
  "puliti", "pulita", "lavato", "lavati", "sgocciolato", "sgocciolati", "scolato", "scolati", "denocciolato",
  "denocciolate", "denocciolati", "snocciolate", "sgusciato", "sgusciati", "sgranati", "disossato", "disossata",
  "sfilettato", "decorticato", "decorticate", "ammollato", "ammollati", "reidratato", "naturale", "naturali", "puro",
  "pura", "magro", "magra", "magri", "tenero", "tenera", "teneri", "novello", "novella", "novelli", "novelle",
  "primizia", "selvatico", "selvatica", "selvatici", "spontaneo", "bio", "biologico", "biologica", "biologici",
  "biologiche", "km", "zero", "nostrano", "nostrana", "locale", "italiano", "italiana", "italiani", "italiane", "extra",
  "extravergine", "vergine", "senza", "buccia", "pelle", "osso", "torsolo", "picciolo", "gambo", "gambi", "cuore",
  "cuori", "punte", "cime", "polpa", "scorza", "liquido", "vetro", "piccante", "piccanti", "amaro", "amara", "aspro",
  "rosso", "rossa", "rossi", "rosse", "giallo", "gialla", "gialli", "gialle", "verde", "verdi", "bianco", "bianca",
  "bianchi", "bianche", "nero", "nera", "neri", "nere", "viola", "arancione", "lungo", "lunga", "lunghi", "tondo",
  "tonda", "tondi", "rotondo", "tropea", "pachino", "san", "marzano", "piennolo", "datterino", "ciliegino", "ramato",
  "ramati", "taggiasca", "taggiasche", "bronte", "sorrento", "amalfi", "sicilia", "siciliano", "siciliana", "ligure",
  "toscano", "toscana", "pugliese", "romano", "romana", "napoletano", "calabrese", "sardo", "sarda", "dop", "igp",
  "doc", "docg", "temperatura", "ambiente", "frigo", "frigorifero", "decorare", "decorazione", "guarnire",
  "guarnizione", "servire", "facoltativo", "facoltativa", "piacere", "gusto", "occorrenza", "necessario", "parte",
  "resto", "volta", "ogni", "persona", "persone", "porzione", "porzioni", "tipo", "qualita", "varieta", "taglio",
  "allevamento", "pescato", "scaglie", "polvere", "pistilli", "steli", "radice", "bulbo", "fiori", "germogli",
  "arrostito", "arrostita", "arrostiti", "arrostite", "camicia", "golden", "tarocco", "sanguinello",
  "dissalato", "dissalati", "trevigiano", "cimetta", "cimette", "corta",
  // varietà di mele, pere, patate, pomodori, uva e arance
  "renetta", "renette", "fuji", "gala", "granny", "smith", "pink", "lady", "stark", "red", "delicious", "annurca",
  "braeburn", "jonagold", "williams", "abate", "kaiser", "conference", "decana", "kennebec", "vitelotte", "monalisa",
  "costoluto", "camone", "piccadilly", "perino", "marinda", "regina", "vittoria", "pizzutello", "crimson", "navel",
  "valencia", "italia",
  // nomi della tabella nutrizionale («Manzo, fesa (coscia), cruda (taglio USA)»)
  "dato", "usa", "tagli", "chuck", "bottom", "round", "mock", "tender", "rib", "eye", "scuro", "scura", "umido", "solo",
  "sola", "non", "aggiunto", "aggiunti", "aggiunte",
];

/**
 * Parole di prodotti lavorati, confezionati o conservati: ciò che contengono dipende dalla marca. Rendono la riga
 * `uncertain` per ogni allergene («pollo pronto», «piselli surgelati», «verdure miste», «tonno sott'olio»). «Non
 * trattato» (agrumi) non conta.
 */
export const PROCESSED_WORDS: readonly string[] = [
  "pronto", "pronta", "pronti", "pronte", "confezionato", "confezionata", "confezionati", "confezionate", "trattato",
  "trattata", "trattati", "trattate", "precotto", "precotta", "precotti", "precotte", "surgelato", "surgelata",
  "surgelati", "surgelate", "congelato", "congelata", "congelati", "congelate", "panato", "panata", "panati", "panate",
  "impanato", "impanata", "impanati", "impanate", "pastella", "glassato", "glassata", "glassati", "glassate",
  "caramellato", "caramellata", "caramellati", "caramellate", "candito", "candita", "canditi", "candite", "affumicato",
  "affumicata", "affumicati", "affumicate", "fritto", "fritta", "fritti", "fritte", "zuccherato", "zuccherata",
  "zuccherati", "zuccherate", "dolce", "dolci", "istantaneo", "istantanea", "istantanei", "istantanee", "solubile",
  "liofilizzato", "liofilizzata", "liofilizzati", "liofilizzate", "misto", "mista", "misti", "miste", "aromatizzato",
  "aromatizzata", "aromatizzati", "aromatizzate", "condito", "condita", "conditi", "condite", "insaporito",
  "insaporita", "speziato", "speziata", "light", "ripieno", "ripiena", "ripieni", "ripiene", "farcito", "farcita",
  "mantecato", "mantecata", "scatola", "scatolette", "scatoletta", "lattina", "barattolo", "vasetto", "busta",
  "confezione", "brik", "bottiglia", "conserva", "salamoia", "sott", "sottolio", "sottaceto", "sottaceti",
];

/** Frutta, verdura e pesce secchi o essiccati: spesso trattati con solfiti. Rendono la riga `uncertain` per i solfiti. */
export const SULFITE_WORDS: readonly string[] = [
  "secco", "secca", "secchi", "secche", "essiccato", "essiccata", "essiccati", "essiccate", "disidratato",
  "disidratata", "disidratati", "disidratate", "appassito", "appassita", "appassiti", "appassite",
];

/**
 * Parole di preparazione: la riga è un piatto o un prodotto composto, non un alimento («insalata di riso», «purè di
 * patate», «succo di pomodoro»). Rendono la riga `uncertain` per ogni allergene. «Arrosto», «lesso» e «bollito» lo
 * sono solo in testa alla riga e seguiti da «di» («arrosto di vitello»): dopo il nome sono una cottura («pollo arrosto»).
 */
export const PREPARATION_WORDS: readonly string[] = [
  "insalata", "insalate", "pure", "purea", "crema", "creme", "vellutata", "vellutate", "zuppa", "zuppe", "minestra",
  "minestre", "minestrone", "sugo", "sughi", "salsa", "salse", "succo", "succhi", "spremuta", "spremute", "spremuto",
  "frullato", "frullati", "frappe", "smoothie", "centrifugato", "centrifuga", "estratto", "spiedino", "spiedini",
  "macedonia", "passato", "passata", "composta", "confettura", "marmellata", "sformato", "sformatino", "tortino",
  "involtino", "involtini", "stufato", "spezzatino", "brasato", "stracotto", "ragu", "polpetta", "polpette",
  "polpettone", "crocchetta", "crocchette", "frittata", "frittelle", "brodo", "mousse", "tartare", "battuto",
  "soffritto", "ripieno", "impasto", "pesto", "glassa", "caponata", "peperonata", "parmigiana", "cotoletta",
  "cotolette", "scaloppina", "scaloppine", "tagliata", "carpaccio", "gratin", "teglia", "pasticcio", "timballo",
  "terrina", "mix", "preparato", "preparazione",
];

/** Cotture che sono un piatto quando aprono la riga e reggono un «di»: «arrosto di vitello», «bollito di manzo». */
export const DISH_HEAD_WORDS: readonly string[] = ["arrosto", "arrosti", "lesso", "bollito", "bolliti"];

/**
 * Piatti che si scrivono come un elenco di alimenti semplici: «pasta e fagioli» porta di solito parmigiano o pecorino,
 * «patate e cozze» il pecorino, «pesce e patate» la pastella. Rendono la riga `uncertain` per ogni allergene. Oltre a
 * questi, ogni «e» tra un cereale (pasta, riso, orzo) e una verdura, un legume o un pesce è un piatto.
 */
export const DISH_NAMES: readonly string[] = [
  "patate e cozze", "riso patate e cozze", "fave e cicoria", "fave e cicorie", "pollo e peperoni", "pesce e patate",
  "pollo e patate", "polpo e patate", "baccala e patate", "risi e bisi", "pasta e fagioli", "pasta e ceci",
  "pasta e patate", "pasta e piselli", "pasta e lenticchie", "pasta e cavoli", "pasta e broccoli", "pasta e zucca",
  "riso e patate", "riso e piselli", "riso e lenticchie", "fagioli e cotiche", "salsiccia e fagioli",
  "salsiccia e friarielli", "cime di rapa e salsiccia", "fish and chips",
];

/** Usi dichiarati che non aggiungono niente da mangiare: «olio per friggere», «sale grosso per l'acqua». */
export const PURPOSE_WORDS: readonly string[] = [
  "friggere", "frittura", "acqua", "condire", "condimento", "servire", "teglia", "teglie", "stampo", "stampi",
  "ungere", "spolverare", "spolverizzare", "cottura", "cuocere", "decorare", "guarnire", "pentola",
];

/** Consistenze della polpa: «patate a pasta gialla», «formaggio a pasta filata». Lì «pasta» non è la pasta. */
export const TEXTURE_WORDS: readonly string[] = [
  "gialla", "bianca", "soda", "molle", "dura", "semidura", "filata", "morbida", "farinosa", "compatta", "cotta",
  "cruda", "semicotta", "pressata", "erborinata",
];

/**
 * Agrumi il cui succo spremuto in casa è un alimento semplice: «succo di 1 limone», «succo d'arancia fresco». Senza
 * una quantità o «fresco» il succo può essere confezionato e resta `uncertain`.
 */
export const CITRUS_WORDS: readonly string[] = [
  "limone", "limoni", "arancia", "arance", "lime", "pompelmo", "pompelmi", "mandarino", "mandarini", "clementina",
  "clementine", "mandarancio", "mandaranci", "bergamotto", "cedro",
];
