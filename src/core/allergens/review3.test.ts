// Terza revisione indipendente: 481 nomi con allergeni mai visti prima e 244 attacchi all'elenco chiuso degli alimenti
// semplici. Prove di regressione permanenti: nessun nome con allergene è `clear`.
import { describe, expect, it } from "vitest";
import { assessItem } from "./engine";
import { ALLERGEN_KEYS } from "./tables";

/** Nomi che contengono l'allergene (o possono contenerlo): con quell'allergene dichiarato mai `clear`. */
const C: Readonly<Record<string, readonly string[]>> = {
  glutine: [
    "crema spalmabile alle nocciole", "bastoncini di merluzzo", "brodo granulare", "burger vegetale", "pollo impanato",
    "patate duchessa", "verdure in pastella", "riso soffiato al cioccolato", "torta margherita", "torta di mele",
    "200 g di pane raffermo tagliato a cubetti", "pancetta e crostini", "mezze penne", "ziti", "vermicelli", "capellini",
    "fettuccelle", "anellini", "stelline", "risoni", "orzo perlato", "farro perlato", "pane di altamura", "pane azzimo",
    "schiacciata", "crackers integrali", "grissini torinesi", "taralli pugliesi", "panettone gastronomico", "tramezzini",
    "toast", "sandwich", "hot dog", "kebab", "burrito", "quesadilla", "pane per hamburger", "panino al latte", "bruschetta",
    "panzanella", "pappa al pomodoro", "ribollita", "acquacotta", "zuppa di farro", "pasta e fagioli", "pasta e ceci",
    "arancini", "supplì", "crocchette di patate", "fish and chips", "cotolette di pollo", "nuggets di pollo",
    "wurstel impanati", "cordon bleu", "pollo fritto", "frittura di paranza", "calamari fritti", "verdure pastellate",
    "fiori di zucca fritti", "salsa di soia", "seitan alla piastra", "birra chiara", "malto d'orzo", "caffè d'orzo",
    "orzo solubile", "polenta taragna", "grano saraceno tostato", "cereali per la colazione", "muesli croccante",
    "porridge", "farinata", "farina di farro", "farina di segale", "pan brioche", "pan bauletto", "sfilatini", "focaccine",
    "gnocchetti sardi", "spatzle", "knodel", "gyoza", "ravioli cinesi", "involtini primavera", "noodles di grano",
    "ramen istantaneo", "pane naan", "pane arabo", "lavash", "gallette di farro", "cous cous di verdure",
  ],
  latte: [
    "gelato alla crema", "patate duchessa", "verdure gratinate", "risotto mantecato", "riso mantecato", "patate al burro",
    "pollo alla panna", "funghi alla panna", "pasta burro e salvia", "salsa alfredo", "fonduta", "frico", "montasio",
    "bra", "castelmagno", "valtellina casera", "nostrano", "provolone del monaco", "pecorino sardo", "pecorino toscano",
    "caciocavallo podolico", "scamorza", "burrata di andria", "nodini", "treccia", "bocconcini", "ciliegine di mozzarella",
    "mozzarella fior di latte", "formaggio grattugiato", "formaggio fresco", "fiocchi di latte", "cottage cheese",
    "cream cheese", "sour cream", "mascarpone", "crema al mascarpone", "latte di capra", "latte di pecora", "panna da cucina",
    "panna montata", "panna spray", "besciamella", "cappuccino", "latte macchiato", "frappè", "milkshake", "frullato",
    "cioccolata calda", "biscotti al burro", "frollini", "pan di stelle", "plumcake allo yogurt", "torta allo yogurt",
    "crostata alla crema", "bignè alla crema", "cannolo", "sfogliatelle", "zeppole di san giuseppe", "maritozzi con la panna",
    "tiramisù", "panna cotta", "creme brulee", "budino al cioccolato", "mousse", "purè di patate", "purè", "gnocchi alla sorrentina",
    "pizza margherita", "pizza bianca", "calzone", "lasagne alla bolognese", "parmigiana di melanzane", "cacio e pepe",
    "pasta al pesto", "pesto", "brie", "camembert", "gorgonzola dolce", "emmental", "fontal", "edamer", "gouda",
    "grana grattugiato", "riso al grana", "scaglie di grana", "riso con grana", "pasta e grana", "ricotta di pecora",
    "kefir", "yogurt greco", "latte ad alta digeribilità", "proteine del siero", "whey protein", "caseinato di sodio",
  ],
  uova: [
    "torta margherita", "plumcake", "ciambellone", "pan di spagna", "crema pasticcera", "pasta all'uovo", "tagliolini all'uovo",
    "maionese", "salsa tonnata", "crespelle", "pancakes", "frittata di patate", "tortilla de patatas", "uova strapazzate",
    "uovo in camicia", "uovo pochè", "uovo sodo", "uova di gallina", "polpette di carne", "hamburger di manzo",
    "burger di manzo", "polpettone", "cotoletta alla milanese", "pollo impanato", "fritto misto", "passatelli in brodo",
    "stracciatella in brodo", "carbonara", "spaghetti alla carbonara", "zabaglione", "meringhe", "biscotti", "amaretti",
    "savoiardi", "pandoro", "panettone", "colomba pasquale", "brioche", "croissant", "krapfen", "bombolone", "frittelle di mele",
    "chiacchiere", "castagnole", "struffoli", "pastiera napoletana", "crostata", "sbrisolona", "biscotti della nonna",
    "noodles all'uovo", "egg noodles", "uova di quaglia", "albume d'uovo", "tuorlo d'uovo", "ovetti di cioccolato",
    "gelato alla crema", "semifreddo", "soufflé al formaggio", "quiche lorraine", "sformato di verdure", "tortino di verdure",
    "flan di zucchine", "torta salata", "cannelloni", "lasagne", "tortellini in brodo", "ravioli di ricotta",
  ],
  pesce: [
    "bastoncini di merluzzo", "tonno in scatola", "tonno sott'olio", "filetti di tonno", "200 g di tonno sgocciolato",
    "salmone affumicato", "sgombro in scatola", "sardine sott'olio", "alici marinate", "acciughe sotto sale", "pasta d'acciughe",
    "colatura", "salsa worcestershire", "caesar dressing", "salsa caesar", "vitello tonnato", "insalata nizzarda",
    "spaghetti alle vongole", "zuppa di pesce", "cacciucco", "brodetto", "fumetto di pesce", "frittura di paranza",
    "fish burger", "crocchette di pesce", "polpette di pesce", "carpaccio di salmone", "tartare di salmone",
    "pesce persico impanato", "merluzzo gratinato", "baccalà mantecato", "stoccafisso alla vicentina", "tonno rosso",
    "pesce spada affumicato", "trancio di salmone", "filetto di orata", "branzino al forno", "pesce azzurro",
    "sgombro affumicato", "aringhe affumicate", "anguilla affumicata", "tonno pinne gialle", "ventresca di tonno",
    "bottarga di muggine", "uova di trota", "caviale", "surimi", "polpa di granchio", "sushi misto", "onigiri al tonno",
    "pesce gatto", "pangasio", "halibut", "rombo chiodato", "salmone selvatico", "kippers", "rollmops", "tonno fresco",
  ],
  crostacei: ["code di gambero", "gamberi in tempura", "cocktail di gamberi", "zuppa di crostacei", "risotto agli scampi", "spaghetti all'astice", "gamberoni alla griglia", "granchio reale", "mazzancolle tropicali", "gamberetti surgelati", "bisque di gamberi", "gamberi argentini", "aragostine"],
  molluschi: ["insalata di mare", "frittura di calamari", "anelli di totano", "polpo alla luciana", "seppie con piselli", "cozze alla marinara", "impepata di cozze", "vongole veraci", "ostriche fine de claire", "capesante gratinate", "calamaretti spillo", "moscardini in umido", "lumache alla bourguignonne", "risotto al nero di seppia", "spaghetti alle vongole", "zuppa di cozze"],
  arachidi: ["olio di arachide", "olio di semi di arachide", "burro d'arachidi", "crema di arachidi", "arachidi tostate", "salsa satay", "snickers", "m&m's alle arachidi", "noccioline tostate", "pollo al satay", "olio di semi vari"],
  "frutta a guscio": [
    "crema spalmabile alle nocciole", "nutella", "pesto alla genovese", "pesto di pistacchio", "granella di pistacchio",
    "mandorle a lamelle", "farina di mandorle", "latte di mandorla", "pasta di mandorle", "noci sgusciate", "gherigli di noce",
    "nocciole tostate", "pistacchi di bronte", "pinoli tostati", "anacardi salati", "noci pecan", "noci macadamia",
    "crema di pistacchio", "torrone morbido", "croccante alle mandorle", "amaretti di saronno", "cantuccini", "panforte",
    "torta di noci", "biscotti alle mandorle", "gelato al pistacchio", "gelato alla nocciola", "praline", "frutta secca mista",
    "mix di frutta secca", "muesli con frutta secca", "barretta ai cereali", "salsa di noci", "pansoti", "frangipane",
  ],
  soia: ["bevanda di soia", "salsa teriyaki", "burger vegetale", "bistecca di soia", "tofu affumicato", "latte di soia", "yogurt di soia", "edamame", "miso", "salsa di soia", "lecitina", "lecitina di soia", "germogli di soia", "fagioli di soia", "proteine di soia", "spezzatino di soia", "panna di soia", "tempeh", "polpette vegane", "wurstel vegani", "salsa hoisin", "ramen", "noodles"],
  sedano: ["brodo granulare", "dado vegetale", "dado", "soffritto surgelato", "sedano rapa", "costa di sedano", "minestrone surgelato", "sale aromatizzato", "insaporitore", "succo di pomodoro", "bloody mary", "ragù", "sugo di carne", "brodo di carne", "zuppa di verdure", "passato di verdure", "vellutata di verdure", "sale al sedano", "olio al sedano"],
  senape: ["senape di digione", "mostarda di frutta", "maionese", "salsa tartara", "salsa barbecue", "hot dog", "vinaigrette", "dressing", "salsa yogurt e senape", "senape in grani", "salsa al curry", "ketchup", "condimento per insalata"],
  sesamo: ["semi di sesamo", "olio di sesamo", "tahina", "hummus di ceci", "pane al sesamo", "grissini al sesamo", "panino al sesamo", "salsa tahini", "gomasio", "halva", "sesamo tostato", "za'atar", "pane per hamburger", "bagel", "cracker al sesamo"],
  lupini: ["lupini", "lupini salati", "farina di lupini", "burger di lupini", "lupini in salamoia"],
  solfiti: ["vino bianco secco", "vino rosso", "un bicchiere di vino", "sfumare con vino", "aceto di vino", "aceto balsamico", "glassa di aceto balsamico", "marsala", "porto", "cognac", "brandy", "uvetta sultanina", "albicocche secche", "frutta secca", "frutta essiccata", "succo di limone confezionato", "gamberi surgelati", "funghi secchi", "patate in fiocchi", "purè istantaneo", "salsiccia", "senape"],
};

/** Righe senza allergeni, scritte come in una ricetta: servono a misurare quante diventano `uncertain` (il costo). */
const SAFE: readonly string[] = [
  "2 zucchine", "300 g di riso carnaroli", "1 cipolla bianca tritata", "2 spicchi d'aglio", "olio extravergine d'oliva q.b.",
  "sale q.b.", "pepe nero macinato", "400 g di pomodori pelati", "1 mazzetto di basilico", "500 g di patate",
  "2 carote", "1 costa di finocchio", "200 g di piselli surgelati", "1 peperone rosso", "1 melanzana", "rosmarino",
  "salvia", "4 cosce di pollo", "500 g di petto di pollo", "400 g di macinato di manzo", "1 kg di spalla di maiale",
  "brodo vegetale", "acqua q.b.", "1 limone", "succo di mezzo limone", "zucchero semolato 100 g", "lenticchie 250 g",
  "ceci lessati", "fagioli borlotti", "500 g di spinaci freschi", "prezzemolo tritato", "1 porro", "zafferano 1 bustina",
  "paprika dolce", "cumino in polvere", "peperoncino", "olive taggiasche", "capperi dissalati", "200 g di funghi champignon",
  "funghi porcini secchi", "1 cavolfiore", "broccoli 500 g", "4 fette di vitello", "agnello 1 kg", "polenta istantanea",
  "farina di mais", "patate dolci", "zucca 600 g", "cavolo nero", "fagiolini 300 g", "pomodorini datterini", "rucola",
  "radicchio", "1 finocchio", "3 mele golden", "2 pere", "fragole 250 g", "banane", "succo d'arancia", "miele 2 cucchiai",
  "cannella in polvere", "chiodi di garofano", "alloro 2 foglie", "timo fresco", "origano secco", "aceto di mele",
  "vino bianco", "salsa di pomodoro", "passata di pomodoro", "concentrato di pomodoro", "olio di semi di girasole",
  "riso basmati", "quinoa 200 g", "amido di mais", "fecola di patate", "lievito istantaneo per torte salate", "zenzero fresco",
  "lime", "coriandolo fresco", "latte di cocco", "cocco grattugiato", "avocado", "mais in scatola", "cipollotto",
  "erba cipollina", "scalogno", "sedano", "costine di maiale", "salsiccia di maiale", "pancetta", "guanciale",
  "prosciutto crudo", "bresaola", "coniglio a pezzi", "fegatini di pollo", "1 peperoncino fresco", "pomodori san marzano",
  "olio evo", "sale grosso", "acqua frizzante", "caffè espresso", "cacao amaro", "zucchero di canna",
];

/** Attacchi all'elenco chiuso: modificatori, alimenti noti come prodotti, combinazioni, omografi. */
const T: ReadonlyArray<readonly [string, string]> = [
  // (a) modificatori
  ["pollo arrosto", "latte"], ["patate arrosto", "latte"], ["pollo al forno", "latte"], ["pollo pronto", "glutine"],
  ["pollo confezionato", "glutine"], ["pesce misto", "crostacei"], ["verdure miste", "sedano"], ["carne mista", "glutine"],
  ["salmone affumicato", "pesce"], ["pollo affumicato", "latte"], ["mais dolce", "latte"], ["riso dolce", "latte"],
  ["patate in conserva", "solfiti"], ["olive in salamoia", "solfiti"], ["funghi in conserva", "solfiti"],
  ["polpa di granchio", "crostacei"], ["succo di pomodoro", "sedano"], ["riso grana", "latte"], ["riso e grana", "latte"],
  ["patate gratinate", "latte"], ["patate gratinate", "glutine"], ["riso mantecato", "latte"], ["zucchine impanate", "glutine"],
  ["zucchine in pastella", "uova"], ["patate al burro", "latte"], ["pollo alla panna", "latte"], ["melanzane fritte", "glutine"],
  ["pollo fritto", "glutine"], ["pollo zuccherato", "latte"], ["patate senza buccia", "latte"], ["riso senza glutine", "latte"],
  ["patate surgelate", "glutine"], ["pollo surgelato", "glutine"], ["spinaci surgelati", "latte"], ["piselli in scatola", "solfiti"],
  ["mais in scatola", "solfiti"], ["pollo trattato", "glutine"], ["carne arrostita", "soia"], ["pollo tipo nuggets", "glutine"],
  ["riso precotto", "latte"], ["patate precotte", "glutine"], ["pollo cotto", "glutine"], ["pollo ripieno", "glutine"],
  ["pollo marinato", "soia"], ["pollo glassato", "soia"], ["costine glassate", "senape"], ["carne alla griglia", "senape"],
  // (b) alimenti noti come prodotti
  ["riso soffiato al cioccolato", "latte"], ["riso soffiato", "glutine"], ["patate duchessa", "latte"], ["patate duchessa", "uova"],
  ["pollo impanato", "glutine"], ["verdure in pastella", "glutine"], ["tonno", "pesce"], ["tonno in scatola", "pesce"],
  ["mais tostato", "arachidi"], ["patatine", "latte"], ["patatine", "glutine"], ["patatine fritte", "glutine"],
  ["riso venere", "latte"], ["pane", "sesamo"], ["pane", "soia"], ["pane", "latte"], ["pane in cassetta", "latte"],
  ["pane in cassetta", "soia"], ["pancarrè", "latte"], ["cracker", "sesamo"], ["cracker", "latte"], ["cereali da colazione", "frutta a guscio"],
  ["cereali da colazione", "latte"], ["pita", "sesamo"], ["pane arabo", "sesamo"], ["baguette", "latte"], ["pane per hamburger", "sesamo"],
  ["pane grattugiato", "latte"], ["pangrattato", "sesamo"], ["fette biscottate", "sesamo"], ["biscotti", "sesamo"], ["risotto", "latte"],
  ["risotto", "solfiti"], ["polenta", "latte"], ["gnocchi di patate", "uova"], ["gnocchi di patate", "glutine"], ["purè", "latte"],
  ["patate schiacciate", "latte"], ["cetriolini sottaceto", "senape"], ["cetriolini sottaceto", "solfiti"], ["hummus", "sesamo"],
  ["tofu", "soia"], ["edamame", "soia"], ["maionese", "uova"], ["ketchup", "sedano"], ["cioccolato fondente", "latte"],
  ["cioccolato fondente", "soia"], ["cioccolato fondente", "frutta a guscio"], ["marmellata", "solfiti"], ["confettura", "solfiti"],
  ["gelato", "frutta a guscio"], ["budino", "latte"], ["creme caramel", "uova"], ["crema caramella", "uova"], ["flan", "uova"],
  ["cheesecake", "glutine"], ["torta margherita", "uova"], ["torta margherita", "glutine"], ["plumcake", "uova"], ["ciambellone", "uova"],
  ["pesto", "frutta a guscio"], ["pesto di basilico", "latte"], ["salsa al basilico", "frutta a guscio"], ["sugo", "sedano"],
  ["sugo pronto", "sedano"], ["brodo di pollo", "sedano"], ["brodo", "sedano"], ["dado", "sedano"], ["dado da brodo", "glutine"],
  ["popcorn", "latte"], ["birra", "glutine"], ["vino", "solfiti"], ["aceto", "solfiti"], ["aceto di mele", "solfiti"],
  ["succo di limone", "solfiti"], ["spremuta", "solfiti"], ["olio di semi", "arachidi"], ["olio di semi vari", "arachidi"], ["olio", "sesamo"],
  ["margarina", "latte"], ["strutto", "latte"], ["lardo", "latte"], ["cornetto", "frutta a guscio"], ["gallette", "glutine"],
  ["gallette di mais", "glutine"], ["fiocchi di mais", "glutine"], ["corn flakes", "glutine"], ["muesli", "frutta a guscio"],
  ["formaggio fresco spalmabile", "frutta a guscio"], ["mozzarella", "glutine"], ["yogurt", "frutta a guscio"], ["yogurt", "glutine"],
  ["latte condensato", "glutine"], ["cacao", "latte"], ["cacao in polvere", "latte"], ["caffe solubile", "latte"], ["te", "latte"],
  ["infuso", "frutta a guscio"], ["frutti di bosco", "solfiti"], ["datteri", "glutine"], ["cocco", "frutta a guscio"], ["olive", "solfiti"],
  ["capperi", "solfiti"], ["germogli", "soia"], ["germogli di soia verde", "soia"], ["fagioli mung", "soia"], ["lino", "glutine"],
  ["semi di girasole", "arachidi"], ["semi", "sesamo"], ["insalata", "senape"], ["insalata verde", "senape"], ["frutta fresca", "frutta a guscio"],
  ["ala", "glutine"], ["coda", "pesce"], ["petto", "pesce"], ["ali", "glutine"], ["fusi", "glutine"], ["lombo", "pesce"],
  // (c) combinazioni
  ["crema di carciofi", "latte"], ["ragù", "sedano"], ["polpette", "uova"], ["hamburger", "glutine"], ["hamburger", "uova"],
  ["ripieno di carne", "uova"], ["carne macinata e pane", "latte"], ["pollo e patate", "latte"], ["insalata di riso", "uova"],
  ["insalata di pollo", "uova"], ["riso e piselli", "latte"], ["pasta e patate", "latte"], ["zuppa di legumi", "sedano"],
  ["brodo di carne", "sedano"], ["sugo di pomodoro", "sedano"], ["passata di pomodoro", "sedano"], ["salsa di pomodoro", "sedano"],
  ["vellutata di zucca", "latte"], ["purea di patate", "latte"], ["crema di zucca", "latte"], ["pesce e patate", "glutine"],
  ["pollo e mandorle", "frutta a guscio"], ["insalata di mare", "molluschi"], ["frutti di mare", "molluschi"], ["patate e salmone", "pesce"],
  ["mela e cannella", "latte"], ["riso alla cantonese", "uova"], ["pollo al curry", "senape"], ["carne di soia", "soia"],
  ["latte di cocco", "latte"], ["cocco e latte", "latte"], ["zucchero e burro", "latte"], ["filetto di pesce", "pesce"],
  // (d) omografi
  ["pesca", "pesce"], ["pesche", "pesce"], ["fico", "frutta a guscio"], ["noce di cocco", "frutta a guscio"], ["lingua", "pesce"],
  ["lingua di gatto", "uova"], ["lingue di gatto", "latte"], ["occhi di bue", "uova"], ["cuore", "latte"], ["cuori di palma", "latte"],
  ["coda di rospo", "pesce"], ["san pietro", "pesce"], ["orecchiette", "glutine"], ["gnocchetti", "glutine"], ["pici", "glutine"],
  ["chiocciole", "molluschi"], ["chiocciole", "glutine"], ["farfalle", "glutine"], ["conchiglie", "molluschi"], ["sedanini", "glutine"],
  ["sedanini", "sedano"], ["mela cotogna", "solfiti"], ["mostarda", "senape"], ["mostarda", "solfiti"], ["latte di mandorla", "frutta a guscio"],
  ["burro di cacao", "latte"], ["noce moscata", "frutta a guscio"], ["arachide", "arachidi"], ["mandorlo", "frutta a guscio"],
  ["sale al sedano", "sedano"], ["sale aromatico", "sedano"], ["sale alle erbe", "sedano"], ["sale affumicato", "sedano"],
  ["pomodori secchi", "solfiti"], ["albicocche", "solfiti"], ["uva sultanina", "solfiti"], ["uvetta", "solfiti"], ["prugne", "solfiti"],
  ["prugne secche", "solfiti"], ["fichi secchi", "solfiti"], ["mele essiccate", "solfiti"], ["mango essiccato", "solfiti"],
  ["patate disidratate", "solfiti"], ["funghi secchi", "solfiti"], ["gamberi surgelati", "solfiti"], ["mais secco", "solfiti"],
];

/**
 * Attacchi che restano `clear` per decisione, ciascuno con il perché. Tutti gli altri attacchi devono essere almeno
 * `uncertain`.
 */
const CLEAR_BY_DECISION: ReadonlyArray<readonly [string, string, string]> = [
  ["pollo arrosto", "latte", "cottura casalinga semplice: resta innocua"],
  ["patate arrosto", "latte", "cottura casalinga semplice"],
  ["pollo al forno", "latte", "cottura casalinga semplice"],
  ["pollo cotto", "glutine", "cottura casalinga semplice"],
  ["carne arrostita", "soia", "cottura casalinga semplice"],
  ["carne alla griglia", "senape", "cottura casalinga semplice"],
  ["patate senza buccia", "latte", "«senza buccia» toglie, non aggiunge"],
  ["riso senza glutine", "latte", "il riso è un cereale in chicco; la dichiarazione riguarda solo il glutine"],
  ["riso venere", "latte", "varietà di riso"],
  ["strutto", "latte", "grasso a ingrediente unico"],
  ["mozzarella", "glutine", "formaggio fresco semplice (contiene latte, non glutine)"],
  ["lino", "glutine", "semi: incerti per frutta a guscio, arachidi e sesamo, non per il glutine"],
  ["mela e cannella", "latte", "elenco con «e»: voce per voce"],
  ["pesca", "pesce", "frutto: la radice è distinta da «pesce»"],
  ["pesche", "pesce", "frutto"],
  ["fico", "frutta a guscio", "frutto fresco"],
  ["mela cotogna", "solfiti", "frutto fresco"],
  ["noce moscata", "frutta a guscio", "spezia, non frutta a guscio (eccezione delle tabelle)"],
  ["albicocche", "solfiti", "frutto fresco; «albicocche secche» è `contains`"],
  ["prugne", "solfiti", "frutto fresco; «prugne secche» è `contains`"],
];

const key = (name: string, allergen: string): string => `${name}|${allergen}`;

describe("terza revisione: nomi con allergeni", () => {
  it(`nessuno dei nomi con allergeni è \`clear\` per il suo allergene`, () => {
    const all = Object.entries(C).flatMap(([allergen, names]) => names.map((name) => [name, allergen] as const));
    expect(all.length).toBeGreaterThan(400);
    expect(all.filter(([name, allergen]) => assessItem({ name }, [allergen]).verdict === "clear")).toEqual([]);
  });
});

describe("terza revisione: attacchi all'elenco chiuso", () => {
  const decided = new Set(CLEAR_BY_DECISION.map(([name, allergen]) => key(name, allergen)));

  it("ogni attacco è almeno `uncertain`, tranne quelli decisi e motivati", () => {
    const wrong = T.filter(([name, allergen]) => !decided.has(key(name, allergen))).filter(([name, allergen]) => assessItem({ name }, [allergen]).verdict === "clear");
    expect(wrong).toEqual([]);
  });

  it("gli attacchi decisi restano `clear`: un cambiamento va rivisto qui", () => {
    for (const [name, allergen] of CLEAR_BY_DECISION) {
      expect(T.some(([n, a]) => n === name && a === allergen)).toBe(true);
      expect([name, allergen, assessItem({ name }, [allergen]).verdict]).toEqual([name, allergen, "clear"]);
    }
  });

  it("il pane resta `contains` per il glutine e `uncertain` per sesamo, latte, soia e uova", () => {
    const f = assessItem({ name: "Pane" }, ["glutine", "sesamo", "latte", "soia", "uova"]).findings;
    expect(Object.fromEntries(f.map((x) => [x.allergen, x.verdict]))).toEqual({
      glutine: "contains",
      sesamo: "uncertain",
      latte: "uncertain",
      soia: "uncertain",
      uova: "uncertain",
    });
  });
});

describe("costo misurato sulle righe senza allergeni", () => {
  // Misura della terza revisione: 23/103 `uncertain` con latte, glutine e frutta a guscio dichiarati (erano 11), 22/103
  // con le uova, 22/103 con tutti i 14 (sedano, vino e aceto lì sono `contains`). In più ci sono conserve, salse,
  // succhi, surgelati, cacao, cocco, vino e aceto, che ora sono `uncertain` per regola.
  it.each<[string, readonly string[]]>([
    ["latte, glutine, frutta a guscio", ["latte", "glutine", "frutta a guscio"]],
    ["uova", ["uova"]],
    ["tutti i 14", ALLERGEN_KEYS],
  ])("con %s dichiarati non più di un quarto delle righe è `uncertain`", (_, declared) => {
    const uncertain = SAFE.filter((name) => assessItem({ name }, declared).verdict === "uncertain");
    expect(uncertain.length).toBeLessThanOrEqual(Math.ceil(SAFE.length / 4));
  });
});
