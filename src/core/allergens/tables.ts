// Tabelle degli allergeni. Le 14 voci sono quelle dell'allegato II del Regolamento (UE) n. 1169/2011; gli elenchi di
// alimenti, derivati e prodotti composti sono una compilazione prudente e non esaustiva (vedi SOURCES.md).
//
// Sintassi delle voci:
//   "parola" o "più parole"  radice: singolare e plurale, accenti e maiuscole non contano; dalle 5 lettere di radice
//                            vale anche come inizio di parola («gamber» trova «gamberetti»). Più parole: tutte nello
//                            stesso frammento, in qualunque ordine.
//   "=parola"                solo quella parola esatta (per radici che ne toccano altre: «=grana» non è «grano»).
//   "parola*"                inizio di parola, così com'è scritta (le radici della prima versione restano tutte).
//   "~parola"                parola contenuta in un'altra («fiordilatte», «pannacotta», «pescespada»).

export const ALLERGEN_KEYS = [
  "glutine", "latte", "uova", "pesce", "crostacei", "molluschi", "arachidi", "frutta a guscio", "soia", "sedano",
  "senape", "sesamo", "lupini", "solfiti",
] as const;

export type AllergenKey = (typeof ALLERGEN_KEYS)[number];

export interface AllergenTable {
  key: AllergenKey;
  /** Come la voce è scritta nell'allegato II. */
  regulation: string;
  /** Altri nomi con cui l'utente o un'etichetta indicano l'allergene (anche in inglese e nei codici di Open Food Facts). */
  aliases: readonly string[];
  /** Alimenti, derivati e prodotti che lo contengono di norma. */
  terms: readonly string[];
  /**
   * Espressioni che NON sono questo allergene anche se ne contengono una parola («burro di cacao» non è latte). Valgono
   * solo parola per parola, nell'ordine, con in mezzo al più una preposizione «di».
   */
  masks: readonly string[];
}

export const ALLERGEN_TABLES: readonly AllergenTable[] = [
  {
    key: "glutine",
    regulation:
      "cereali contenenti glutine (grano, segale, orzo, avena, farro, kamut o i loro ceppi ibridati) e prodotti derivati",
    aliases: [
      "glutine", "gluten", "celiachia", "celiaco", "cereali contenenti glutine", "cereali con glutine", "frumento",
      "grano", "wheat", "en:gluten",
    ],
    terms: [
      // radici della prima versione
      "farin*", "grano*", "frument*", "pasta*", "pane*", "pangrattat*", "semol*", "orzo*", "farro*", "segale*",
      "avena*", "kamut*", "couscous*", "seitan*", "biscott*", "cracker*", "grissin*", "fette biscottate", "gnocch*",
      "lasagn*", "spaghett*", "tagliatell*", "maccheron*", "fusill*", "rigaton*", "wheat*", "flour*", "bread*",
      "barley*", "rye*", "breadcrumb*", "malto*",
      // cereali
      "farina", "frumento", "=grano", "grani antichi", "grani di frumento", "grano duro", "grano tenero", "farro", "spelta", "kamut", "khorasan",
      "segale", "orzo", "avena", "fiocchi di avena", "triticale", "bulgur", "freekeh", "cous cous", "couscous",
      "seitan", "semola", "semolino", "crusca", "germe di grano", "amido di frumento", "glutine", "malto",
      "estratto di malto", "cereali", "muesli", "granola", "infarin*",
      // pane e prodotti da forno
      "pane", "pani", "panino", "panini", "pancarre", "pan carre", "pangrattato", "pan grattato", "panko", "crostini",
      "crouton", "piadina", "pizza", "focaccia", "grissini", "cracker", "taralli", "friselle", "fette biscottate",
      "tortilla", "wrap", "brioche", "cornetto", "croissant", "pan di spagna", "pandoro", "panettone", "colomba",
      "savoiardi", "wafer", "cialde", "biscotti", "crostata", "frolla", "pasta frolla", "pasta sfoglia", "pasta brise",
      "pasta fillo", "pasta matta", "pasta madre", "lievito madre", "crumble", "pastella", "impanatura", "panatura",
      "panato", "impanato", "besciamella", "roux", "cantucci", "baklava", "pizzoccheri",
      // pasta
      "pasta", "pastina", "pasta fresca", "pasta all uovo", "spaghetti", "spaghettoni", "penne", "pennette", "pennoni",
      "tagliatelle", "tagliolini", "fettuccine", "pappardelle", "lasagne", "maccheroni", "fusilli", "rigatoni",
      "linguine", "bucatini", "farfalle", "orecchiette", "paccheri", "ditalini", "tubetti", "sedanini", "mezze maniche",
      "trofie", "strozzapreti", "tortellini", "tortelloni", "ravioli", "cappelletti", "agnolotti", "gnocchi", "noodles",
      "udon", "ramen", "gyoza", "fregola", "malloreddus", "=pici", "bigoli", "trenette", "conchiglie", "conchigliette",
      "casarecce", "garganelli", "maltagliati", "cavatelli", "passatelli", "canederli", "knodel", "spatzle",
      "tonnarelli", "pastiera",
      // pane, lievitati e dolci da forno
      "mollica", "pane grattugiato", "tigelle", "crescentine", "gnocco fritto", "pinsa", "ciabatta", "rosetta",
      "michetta", "baguette", "=pita", "=pite", "pitta", "naan", "chapati", "roti", "panzerotti", "panzerotto",
      "calzone", "sfogliatella", "sfogliatelle", "=cannoli", "=cannolo", "struffoli", "zeppole", "zeppola", "bomboloni",
      "bombolone", "krapfen", "ciambellone", "ciambella", "torta paradiso", "plumcake", "plum cake", "muffin",
      "pasticcini", "pasticcino", "=frisa", "=frise", "cuscus", "tabbouleh", "tabule", "corn flakes", "cornflakes",
      "sfoglia", "graham", "pumpernickel", "=bao", "dumpling", "dumplings", "strudel", "cheesecake", "brownie",
      "brownies", "waffle", "tarallucci", "carasau", "orzotto", "pane carasau", "bigne", "pasta choux", "frittelle",
      "frittella", "quiche", "maritozzo", "maritozzi", "profiteroles", "cassata", "sbrisolona", "baci di dama",
      "panettone", "pandoro", "=colomba", "crostata", "=torta", "=torte", "pasta brise", "pan brioche", "kikkoman",
      // inglese
      "wheat", "flour", "bread", "barley", "rye", "oats", "spelt", "semolina", "breadcrumbs",
    ],
    masks: [
      "grano saraceno", "farina di riso", "farina di mais", "farina di ceci", "farina di castagne",
      "farina di mandorle", "farina di cocco", "farina di lenticchie", "farina di grano saraceno", "pasta di riso",
      "pasta di mais", "pasta di legumi", "pasta di ceci", "pasta di lenticchie", "pasta di mandorle",
      "pasta di nocciole", "pasta di pistacchi", "pasta di sesamo", "pasta di acciughe", "pasta di alici",
      "pasta di olive", "pasta di arachidi", "pasta di zucchero", "pasta di miso", "pasta di peperoncino",
      "pasta di curry", "pasta di tamarindo", "pasta di datteri", "sciroppo di glucosio",
      // parole innocue che iniziano come una radice del glutine («semol*», «pasta*», «grano*», «pane*»)
      "semolato", "pastinaca", "granoturco", "farina di granoturco", "granone", "panetto", "panelle", "=pasto",
      "lievito di birra", "farinata", "riso glutinoso",
    ],
  },
  {
    key: "latte",
    regulation: "latte e prodotti a base di latte (incluso lattosio)",
    aliases: [
      "latte", "lattosio", "latticini", "latte e derivati", "latte vaccino", "proteine del latte",
      "intolleranza al lattosio", "milk", "dairy", "lactose", "en:milk",
    ],
    terms: [
      "latte*", "burro*", "formaggi*", "panna*", "yogurt*", "parmigian*", "grana*", "mozzarell*", "ricott*",
      "mascarpon*", "pecorin*", "gorgonzol*", "besciamell*", "provol*", "fontina*", "stracchin*", "caciott*",
      "philadelphia*", "latticin*", "milk*", "butter*", "cheese*", "cream*", "whey*", "siero di latte", "caseina*",
      "kefir*", "~latte", "~panna", "imburr*", "latte", "lattosio", "latticini", "latticello", "latte in polvere",
      "burro", "burrata", "panna", "pannacotta", "yogurt", "yoghurt", "iogurt", "kefir", "skyr", "quark", "ghee",
      "siero", "siero di latte", "caseina", "caseinato", "lattoalbumina", "lattoglobulina", "proteine del latte",
      "cagliata", "formaggio", "formaggini", "parmigiano", "parmesan", "=grana", "grana padano", "pecorino",
      "mozzarella", "fior di latte", "fiordilatte", "bufala", "ricotta", "mascarpone", "gorgonzola", "provola",
      "provolone", "fontina", "fontal", "stracchino", "crescenza", "caciotta", "caciocavallo", "scamorza", "asiago",
      "taleggio", "emmental", "emmentaler", "groviera", "gruviera", "gruyere", "edamer", "=edam", "feta", "brie",
      "camembert", "cheddar", "philadelphia", "robiola", "quartirolo", "montasio", "castelmagno", "=toma",
      "stracciatella", "squacquerone", "primo sale", "casatella", "halloumi", "paneer", "besciamella",
      "crema pasticcera", "=gelato", "=gelati", "cioccolato al latte", "cioccolato bianco", "margarina", "milk",
      "butter", "cheese", "cream", "whey", "dairy", "caprino", "tomino", "gouda", "maasdam", "leerdammer", "sottilette",
      "sottiletta", "smetana", "dulce de leche", "budino", "budini", "semifreddo", "profiteroles", "cassata", "=bitto",
      "raschera", "=piave", "fiore sardo", "canestrato", "ragusano", "manchego", "roquefort", "stilton", "trentingrana",
      "puzzone", "vezzena", "galbanino", "spalmabile", "tzatziki", "raita", "lassi", "cappuccino", "creme fraiche",
      "panna acida", "crema catalana", "mousse", "panettone", "pandoro", "=colomba", "maritozzo", "maritozzi",
      "sfogliatella", "sfogliatelle", "=cannoli", "=cannolo", "canederli", "passatelli", "zeppole", "bomboloni",
      "krapfen", "ciambellone", "torta paradiso", "plumcake", "muffin", "cheesecake", "brownies", "waffle", "bigne",
      "quiche", "souffle", "flan", "panzerotti", "calzone", "naan", "eggnog", "ovetto", "baci di dama", "sbrisolona",
      "torta caprese", "crostata", "pastiera", "burro chiarificato", "mozzarella di bufala", "sfoglia",
    ],
    masks: [
      "burro di cacao", "burro di arachidi", "burro di mandorle", "burro di nocciole", "burro di anacardi",
      "burro di karite", "burro di cocco", "burro di pistacchi", "burro di semi", "latte di cocco", "latte di mandorla",
      "latte di mandorle", "latte di soia", "latte di riso", "latte di avena", "latte di nocciola", "latte di nocciole",
      "latte di anacardi", "latte di canapa", "latte di farro", "latte di kamut", "latte di miglio", "latte di quinoa",
      "latte vegetale", "crema di cocco", "panna di cocco", "cocoa butter", "peanut butter", "coconut milk",
      "almond milk", "soy milk", "oat milk", "rice milk", "lattuga cappuccina", "insalata cappuccina", "butternut",
      "granatina", "granadilla", "granaglie", "a grana lunga", "a grana corta", "a grana media", "a grana fine", "a grana grossa",
    ],
  },
  {
    key: "uova",
    regulation: "uova e prodotti a base di uova",
    aliases: ["uova", "uovo", "uova e derivati", "egg", "eggs", "en:eggs"],
    terms: [
      "uov*", "albume*", "tuorl*", "maionese*", "=egg", "=eggs", "meringh*", "zabaione*", "uovo", "uova", "albume",
      "albumina", "ovoalbumina", "lisozima", "tuorlo", "maionese", "meringa", "zabaione", "frittata", "omelette",
      "pasta all uovo", "crema pasticcera", "pan di spagna", "savoiardi", "aioli", "carbonara", "salsa tartara",
      "tartara", "cotoletta", "impanatura", "panatura", "impanato", "polpette", "polpettone", "tempura", "frolla",
      "pasta frolla", "crepes", "pancake", "brioche", "cornetto", "croissant", "=gelato", "=gelati", "tiramisu",
      "amaretti", "cantucci", "vitello tonnato", "mayonnaise", "panettone", "pandoro", "=colomba", "ciambellone",
      "ciambella", "plumcake", "muffin", "=torta", "=torte", "crostata", "bigne", "pasta choux", "frittelle",
      "frittella", "flan", "budino", "budini", "crema catalana", "quiche", "souffle", "passatelli", "canederli",
      "=mayo", "ovetto", "maritozzo", "maritozzi", "eggnog", "occhio di bue", "meringata", "egg noodles", "garganelli",
      "torta paradiso", "pasta fresca all uovo", "struffoli", "zeppole", "bomboloni", "krapfen", "profiteroles",
      "semifreddo", "mousse", "cheesecake", "brownies", "waffle", "pastiera", "sfogliatella", "sbrisolona",
      "ricciarelli", "brutti ma buoni", "torta caprese", "nougat", "cassata",
    ],
    masks: [
      "uova di lompo", "uova di salmone", "uova di pesce", "uova di trota", "uova di storione", "uova di aringa",
      "uova di riccio", "uova di muggine",
    ],
  },
  {
    key: "pesce",
    regulation: "pesce e prodotti a base di pesce",
    aliases: ["pesce", "pesci", "pesce e derivati", "fish", "en:fish"],
    terms: [
      "pesce*", "salmone*", "tonno*", "merluzz*", "baccala*", "stoccafisso*", "acciug*", "alici*", "sardin*",
      "sgombro*", "trota*", "branzino*", "orata*", "spigola*", "dentice*", "sogliola*", "halibut*", "fish*", "anchov*",
      "tuna*", "=cod", "colatura*", "~pesce", "=pesce", "=pesci", "salmone", "tonno", "tonnato", "merluzzo", "baccala",
      "stoccafisso", "acciuga", "alice", "sardina", "=sarda", "=sarde", "sardella", "sgombro", "trota", "branzino", "spigola",
      "=orata", "=orate", "dentice", "sogliola", "rombo", "platessa", "nasello", "halibut", "pesce spada", "pescespada",
      "cernia", "ricciola", "palombo", "verdesca", "aringa", "anguilla", "storione", "caviale", "bottarga", "lompo",
      "uova di lompo", "uova di salmone", "uova di pesce", "colatura di alici", "garum", "salsa di pesce", "fish sauce",
      "nuoc mam", "worcester", "worcestershire", "dashi", "katsuobushi", "bonito", "surimi", "pangasio", "tilapia",
      "persico", "luccio", "carpa", "triglia", "scorfano", "coda di rospo", "rana pescatrice", "pagello", "sarago",
      "muggine", "cefalo", "spratto", "eglefino", "salmerino", "ombrina", "colla di pesce", "vitello tonnato",
      "anchovy", "anchovies", "tuna", "salmon", "fish", "san pietro", "pesce san pietro", "lavarello", "coregone",
      "lucioperca", "capitone", "palamita", "tombarello", "alalunga", "lampuga", "sugarello", "sushi", "sashimi",
      "nigiri", "uramaki", "hosomaki", "=lox", "gravlax", "bagna cauda", "tobiko", "ikura", "missoltini", "missoltino",
      "latterini", "latterino", "bianchetti", "neonata", "=haddock", "mackerel", "trout", "sea bass", "pollock",
      "tonnetto", "sardines", "spigole", "sgombri", "tartare di tonno", "poke",
    ],
    masks: [],
  },
  {
    key: "crostacei",
    regulation: "crostacei e prodotti a base di crostacei",
    aliases: [
      "crostacei", "crostaceo", "frutti di mare", "shellfish", "crustaceans", "en:crustaceans",
    ],
    terms: [
      "gambero*", "gamberi*", "gamberett*", "scamp*", "aragost*", "granchi*", "astice*", "mazzancoll*", "shrimp*",
      "prawn*", "crab*", "lobster*", "crostace*", "gambero", "gamberetto", "gamberone", "mazzancolla", "scampo",
      "aragosta", "astice", "granchio", "granceola", "grancevola", "canocchia", "cannocchia", "cicala di mare", "krill",
      "polpa di granchio", "bisque", "crostaceo", "frutti di mare", "langostino", "shrimp", "prawn", "crab", "lobster",
      "crayfish", "granseola", "langoustine", "moleche", "moeche", "cicala", "cicale di mare", "pannocchie di mare",
      "=ebi", "king crab", "scampi", "gamberi rossi", "canocchie",
    ],
    masks: [],
  },
  {
    key: "molluschi",
    regulation: "molluschi e prodotti a base di molluschi",
    aliases: [
      "molluschi", "mollusco", "frutti di mare", "molluscs", "mollusks", "en:molluscs",
    ],
    terms: [
      "cozz*", "vongol*", "calamar*", "polpo*", "seppi*", "totan*", "ostric*", "capesant*", "lumach*", "mollusch*",
      "squid*", "octopus*", "oyster*", "clam*", "mussel*", "cozza", "vongola", "calamaro", "calamaretti", "=polpo",
      "=polpi", "polipo", "polipetti", "moscardino", "seppia", "seppiolina", "nero di seppia", "totano", "ostrica",
      "capasanta", "capesante", "cappesante", "lumaca", "escargot", "fasolari", "tellina", "cannolicchi", "murice",
      "garusoli", "patella", "datteri di mare", "abalone", "mollusco", "frutti di mare", "squid", "octopus", "oyster",
      "clam", "mussel", "scallop", "snail", "lupini di mare", "tartufi di mare", "tartufo di mare", "=muscoli", "peoci",
      "caparozzoli", "chiocciole", "chiocciola", "bulot", "bulots", "pulpo", "cape sante", "lumache", "escargots",
      "seppioline", "moscardini", "mitili", "arselle", "canestrelli",
    ],
    masks: [],
  },
  {
    key: "arachidi",
    regulation: "arachidi e prodotti a base di arachidi",
    aliases: [
      "arachidi", "arachide", "noccioline americane", "peanut", "peanuts", "en:peanuts",
    ],
    terms: [
      "arachid*", "noccioline*", "peanut*", "arachide", "noccioline", "nocciolina", "burro di arachidi",
      "olio di arachidi", "crema di arachidi", "satay", "bagigi", "spagnolette", "pad thai", "peanuts", "peanut butter",
      "peanut",
    ],
    masks: [],
  },
  {
    key: "frutta a guscio",
    regulation:
      "frutta a guscio: mandorle, nocciole, noci, noci di acagiù, noci di pecan, noci del Brasile, pistacchi, noci macadamia o noci del Queensland, e i loro prodotti",
    aliases: [
      "frutta a guscio", "frutta secca", "frutta secca a guscio", "noci", "noce", "nuts", "tree nuts", "en:nuts",
    ],
    terms: [
      "noci*", "=noce", "mandorl*", "nocciol*", "pistacch*", "anacard*", "pinoli*", "pecan*", "macadamia*", "castagn*",
      "frutta secca", "gianduia*", "nutella*", "marzapane*", "almond*", "hazelnut*", "walnut*", "cashew*", "pistachio*",
      "mandorla", "nocciola", "=noci", "noci pecan", "noci del brasile", "noci brasiliane", "noce del brasile",
      "noce macadamia", "noci del queensland", "anacardo", "acagiu", "pistacchio", "pinolo", "castagna", "=marroni",
      "frutta a guscio", "marzapane", "pasta di mandorle", "farina di mandorle", "latte di mandorla", "orzata",
      "amaretti", "amaretto", "cantucci", "torrone", "pralinato", "pralina", "gianduia", "gianduiotto", "nutella",
      "crema di nocciole", "frangipane", "pesto", "baklava", "nocino", "panforte", "croccante", "brutti ma buoni",
      "baci di dama", "ricciarelli", "pasta reale", "frutta martorana", "martorana", "sbrisolona", "torta caprese",
      "marron glace", "marrons glaces", "nougat", "gheriglio", "gherigli", "mandorlato", "nocciolato", "granella",
      "praline", "pecan pie", "almond", "hazelnut", "walnut", "cashew", "pistachio", "pecan", "macadamia", "brazil nut",
    ],
    masks: [
      "noce moscata", "noci moscate", "noce di cocco", "noci di cocco", "noce di burro", "noci di burro",
      "noce di vitello", "noce di manzo", "noce di maiale", "noce di bovino", "noce di vitellone", "noce di tacchino",
      "=senza nocciolo", "=senza noccioli", "=granelli", "pesca noce", "pesche noci", "granella di zucchero",
    ],
  },
  {
    key: "soia",
    regulation: "soia e prodotti a base di soia",
    aliases: ["soia", "soya", "soy", "soybeans", "en:soybeans"],
    terms: [
      "soia*", "soy*", "tofu*", "tempeh*", "edamame*", "miso*", "soia", "soja", "soya", "tofu", "tempeh", "edamame",
      "miso", "=tamari", "shoyu", "natto", "yuba", "salsa di soia", "lecitina di soia", "proteine di soia", "teriyaki",
      "hoisin", "satay", "okara", "proteine vegetali testurizzate", "proteine vegetali", "kikkoman", "fagioli di soia",
    ],
    masks: [],
  },
  {
    key: "sedano",
    regulation: "sedano e prodotti a base di sedano",
    aliases: ["sedano", "celery", "en:celery"],
    terms: [
      "sedano*", "celery*", "sedano", "sedano rapa", "semi di sedano", "sale al sedano", "celeriac", "soffritto",
      "minestrone", "celery", "gazpacho", "mirepoix", "bloody mary", "sale aromatico", "sale alle erbe", "odori",
    ],
    masks: [],
  },
  {
    key: "senape",
    regulation: "senape e prodotti a base di senape",
    aliases: ["senape", "mustard", "en:mustard"],
    terms: [
      "senape*", "mustard*", "senape", "semi di senape", "mostarda", "dijon", "salsa tartara", "mustard", "moutarde",
      "honey mustard",
    ],
    masks: [],
  },
  {
    key: "sesamo",
    regulation: "semi di sesamo e prodotti a base di semi di sesamo",
    aliases: [
      "sesamo", "semi di sesamo", "sesame", "sesame seeds", "en:sesame-seeds",
    ],
    terms: [
      "sesamo*", "sesame*", "tahin*", "tahini*", "sesamo", "semi di sesamo", "olio di sesamo", "tahina", "tahini",
      "hummus", "humus", "gomasio", "halva", "halvah", "zaatar", "za atar", "sesame", "babaganoush", "baba ganoush",
      "baba ghanoush", "furikake", "=goma", "falafel", "houmous", "hommus",
    ],
    masks: [],
  },
  {
    key: "lupini",
    regulation: "lupini e prodotti a base di lupini",
    aliases: ["lupini", "lupino", "lupin", "en:lupin"],
    terms: ["lupin*", "lupino", "farina di lupini", "lupin"],
    masks: [],
  },
  {
    key: "solfiti",
    regulation:
      "anidride solforosa e solfiti in concentrazioni superiori a 10 mg/kg o 10 mg/litro",
    aliases: [
      "solfiti", "solfito", "anidride solforosa", "anidride solforosa e solfiti", "sulphites", "sulfites",
      "sulphur dioxide", "en:sulphur-dioxide-and-sulphites",
    ],
    terms: [
      "solfit*", "vino*", "aceto*", "uvetta*", "uva passa", "sulphite*", "sulfite*", "wine*", "solfito",
      "anidride solforosa", "metabisolfito", "bisolfito", "e220", "e221", "e222", "e223", "e224", "e225", "e226",
      "e227", "e228", "=vino", "=vini", "aceto", "aceto balsamico", "uvetta", "uva sultanina", "sultanina", "marsala",
      "=porto", "sherry", "vermut", "vermouth", "spumante", "prosecco", "champagne", "sidro", "albicocche secche",
      "frutta secca", "frutta disidratata", "frutta essiccata", "wine", "balsamico", "vin santo", "vinsanto",
      "vincotto", "vino cotto", "mosto cotto", "saba", "madeira", "martini", "spritz", "aperol", "bellini", "sangria",
      "prugne secche", "prugna secca", "fichi secchi", "fico secco", "frutta candita", "canditi", "candito",
      "scorza candita", "patate disidratate", "patate in fiocchi", "pure istantaneo", "sottaceti", "sottaceto",
      "sott aceto", "giardiniera", "cetriolini",
      // vini per nome
      "lambrusco", "chianti", "barolo", "barbaresco", "brunello", "nebbiolo", "=pinot", "=moscato", "moscato d asti",
      "verdicchio", "montepulciano", "merlot", "sangiovese", "vermentino", "trebbiano", "chardonnay", "cabernet",
      "sauvignon", "primitivo", "nero d avola", "amarone", "valpolicella", "bardolino", "=soave", "franciacorta",
      "falanghina", "=fiano", "greco di tufo", "aglianico", "=dolcetto", "barbera", "grignolino", "lagrein",
      "gewurztraminer", "riesling", "muller thurgau", "sagrantino", "cannonau", "negroamaro", "ribolla", "friulano",
      "vernaccia", "passito", "recioto", "malvasia", "zibibbo", "brachetto", "asti spumante", "vino rosso",
      "vino bianco",
    ],
    masks: ["acetosella", "acetosa"],
  },
];

export interface CompositeEntry {
  /** Voce, nella sintassi delle tabelle. */
  term: string;
  /** Allergeni che contiene di norma: esito `contains`. */
  contains: readonly AllergenKey[];
  /** Allergeni che può contenere o no secondo la ricetta o la marca: esito `uncertain`. «all» = qualunque allergene. */
  uncertain: readonly AllergenKey[] | "all";
}

/**
 * Prodotti composti o pronti. Ciò che contengono di norma va in `contains` (anche quando è già nelle tabelle, per dirlo
 * nel motivo); ciò che dipende dalla marca o dalla ricetta va in `uncertain`.
 */
export const COMPOSITES: readonly CompositeEntry[] = [
  { term: "pesto", contains: ["frutta a guscio", "latte"], uncertain: [] },
  { term: "maionese", contains: ["uova"], uncertain: ["senape", "solfiti"] },
  { term: "mayonnaise", contains: ["uova"], uncertain: ["senape", "solfiti"] },
  { term: "salsa tartara", contains: ["uova", "senape"], uncertain: [] },
  { term: "aioli", contains: ["uova"], uncertain: [] },
  { term: "tartara", contains: ["uova"], uncertain: ["senape"] },
  {
    term: "worcester",
    contains: ["pesce"],
    uncertain: ["glutine", "solfiti", "sedano"],
  },
  {
    term: "worcestershire",
    contains: ["pesce"],
    uncertain: ["glutine", "solfiti", "sedano"],
  },
  { term: "salsa di soia", contains: ["soia", "glutine"], uncertain: [] },
  { term: "=tamari", contains: ["soia"], uncertain: ["glutine"] },
  { term: "teriyaki", contains: ["soia", "glutine"], uncertain: [] },
  { term: "hoisin", contains: ["soia"], uncertain: ["glutine", "sesamo"] },
  { term: "satay", contains: ["arachidi", "soia"], uncertain: [] },
  {
    term: "frutta secca",
    contains: ["frutta a guscio", "solfiti"],
    uncertain: ["arachidi", "sesamo"],
  },
  {
    term: "burro di arachidi",
    contains: ["arachidi"],
    uncertain: ["latte", "soia"],
  },
  {
    term: "crema di arachidi",
    contains: ["arachidi"],
    uncertain: ["latte", "soia"],
  },
  { term: "cotoletta", contains: ["glutine", "uova"], uncertain: ["latte"] },
  { term: "impanatura", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "panatura", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "impanato", contains: ["glutine", "uova"], uncertain: ["latte"] },
  { term: "panato", contains: ["glutine", "uova"], uncertain: ["latte"] },
  { term: "polpette", contains: ["glutine", "uova"], uncertain: ["latte"] },
  { term: "polpettone", contains: ["glutine", "uova"], uncertain: ["latte"] },
  {
    term: "surimi",
    contains: ["pesce"],
    uncertain: ["crostacei", "uova", "glutine", "soia"],
  },
  { term: "tahina", contains: ["sesamo"], uncertain: [] },
  { term: "tahini", contains: ["sesamo"], uncertain: [] },
  { term: "hummus", contains: ["sesamo"], uncertain: [] },
  { term: "besciamella", contains: ["latte", "glutine"], uncertain: [] },
  { term: "cous cous", contains: ["glutine"], uncertain: [] },
  { term: "pan di spagna", contains: ["glutine", "uova"], uncertain: [] },
  { term: "carbonara", contains: ["uova", "latte"], uncertain: [] },
  {
    term: "tiramisu",
    contains: ["latte", "uova", "glutine"],
    uncertain: ["solfiti"],
  },
  {
    term: "=gelato",
    contains: ["latte", "uova"],
    uncertain: ["frutta a guscio", "soia"],
  },
  {
    term: "=gelati",
    contains: ["latte", "uova"],
    uncertain: ["frutta a guscio", "soia"],
  },
  { term: "brioche", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "cornetto", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "croissant", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "pizza", contains: ["glutine"], uncertain: [] },
  { term: "piadina", contains: ["glutine"], uncertain: [] },
  { term: "tortilla", contains: ["glutine"], uncertain: [] },
  { term: "wrap", contains: ["glutine"], uncertain: [] },
  { term: "focaccia", contains: ["glutine"], uncertain: [] },
  { term: "crepes", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "pancake", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "frolla", contains: ["glutine", "latte", "uova"], uncertain: [] },
  { term: "tempura", contains: ["glutine", "uova"], uncertain: [] },
  { term: "pastella", contains: ["glutine"], uncertain: "all" },
  { term: "margarina", contains: ["latte"], uncertain: [] },
  { term: "birra", contains: ["glutine"], uncertain: ["solfiti"] },
  { term: "vitello tonnato", contains: ["pesce", "uova"], uncertain: [] },
  {
    term: "crema pasticcera",
    contains: ["latte", "uova", "glutine"],
    uncertain: [],
  },
  {
    term: "gianduia",
    contains: ["frutta a guscio", "latte"],
    uncertain: ["soia"],
  },
  {
    term: "nutella",
    contains: ["frutta a guscio", "latte"],
    uncertain: ["soia"],
  },
  {
    term: "crema di nocciole",
    contains: ["frutta a guscio"],
    uncertain: ["latte", "soia"],
  },
  { term: "marzapane", contains: ["frutta a guscio"], uncertain: [] },
  {
    term: "amaretti",
    contains: ["frutta a guscio", "uova"],
    uncertain: ["glutine"],
  },
  {
    term: "cantucci",
    contains: ["frutta a guscio", "glutine", "uova"],
    uncertain: ["latte"],
  },
  {
    term: "baklava",
    contains: ["frutta a guscio", "glutine"],
    uncertain: ["latte"],
  },
  {
    term: "cioccolato",
    contains: [],
    uncertain: ["latte", "soia", "frutta a guscio"],
  },
  {
    term: "biscotti",
    contains: ["glutine"],
    uncertain: ["latte", "uova", "frutta a guscio", "soia"],
  },
  { term: "savoiardi", contains: ["glutine", "uova"], uncertain: [] },
  { term: "pancarre", contains: ["glutine"], uncertain: ["latte", "soia"] },
  { term: "pan carre", contains: ["glutine"], uncertain: ["latte", "soia"] },
  { term: "pasta fresca", contains: ["glutine"], uncertain: ["uova"] },
  { term: "lasagne", contains: ["glutine"], uncertain: ["uova"] },
  { term: "tagliatelle", contains: ["glutine"], uncertain: ["uova"] },
  { term: "tagliolini", contains: ["glutine"], uncertain: ["uova"] },
  { term: "fettuccine", contains: ["glutine"], uncertain: ["uova"] },
  { term: "pappardelle", contains: ["glutine"], uncertain: ["uova"] },
  { term: "gnocchi", contains: ["glutine"], uncertain: ["uova"] },
  { term: "tortellini", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "tortelloni", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "ravioli", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "cappelletti", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "agnolotti", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "soffritto", contains: ["sedano"], uncertain: [] },
  { term: "minestrone", contains: ["sedano"], uncertain: "all" },
  { term: "lecitina", contains: [], uncertain: ["soia", "uova"] },
  { term: "curry", contains: [], uncertain: ["senape", "sedano", "glutine"] },
  { term: "ketchup", contains: [], uncertain: ["sedano", "senape"] },
  { term: "spezie", contains: [], uncertain: ["senape", "sedano"] },
  { term: "lievito per dolci", contains: [], uncertain: ["glutine"] },
  { term: "lievito chimico", contains: [], uncertain: ["glutine"] },
  { term: "lievito in polvere", contains: [], uncertain: ["glutine"] },
  {
    term: "latte vegetale",
    contains: [],
    uncertain: ["latte", "soia", "frutta a guscio", "glutine"],
  },
  {
    term: "bevanda vegetale",
    contains: [],
    uncertain: ["latte", "soia", "frutta a guscio", "glutine"],
  },
  { term: "grano saraceno", contains: [], uncertain: ["glutine"] },
  { term: "farina di riso", contains: [], uncertain: ["glutine"] },
  { term: "farina di mais", contains: [], uncertain: ["glutine"] },
  { term: "farina di ceci", contains: [], uncertain: ["glutine"] },
  {
    term: "farina di castagne",
    contains: ["frutta a guscio"],
    uncertain: ["glutine"],
  },
  {
    term: "farina di mandorle",
    contains: ["frutta a guscio"],
    uncertain: ["glutine"],
  },
  { term: "farina di cocco", contains: [], uncertain: ["glutine"] },
  { term: "farina di lenticchie", contains: [], uncertain: ["glutine"] },
  { term: "pasta di riso", contains: [], uncertain: ["glutine"] },
  { term: "pasta di mais", contains: [], uncertain: ["glutine"] },
  { term: "pasta di legumi", contains: [], uncertain: ["glutine"] },
  { term: "pasta di ceci", contains: [], uncertain: ["glutine"] },
  { term: "pasta di lenticchie", contains: [], uncertain: ["glutine"] },
  { term: "zabaione", contains: ["uova"], uncertain: ["solfiti"] },
  {
    term: "frutti di mare",
    contains: ["crostacei", "molluschi"],
    uncertain: [],
  },
  { term: "bisque", contains: ["crostacei"], uncertain: ["latte", "sedano"] },
  // seconda revisione: piatti e prodotti che contengono di norma più allergeni
  {
    term: "pastiera",
    contains: ["glutine", "latte", "uova"],
    uncertain: ["frutta a guscio"],
  },
  { term: "passatelli", contains: ["glutine", "uova", "latte"], uncertain: [] },
  {
    term: "canederli",
    contains: ["glutine", "uova", "latte"],
    uncertain: "all",
  },
  { term: "garganelli", contains: ["glutine", "uova"], uncertain: [] },
  {
    term: "panettone",
    contains: ["glutine", "latte", "uova"],
    uncertain: ["frutta a guscio", "solfiti", "soia"],
  },
  {
    term: "pandoro",
    contains: ["glutine", "latte", "uova"],
    uncertain: ["soia"],
  },
  {
    term: "=colomba",
    contains: ["glutine", "latte", "uova"],
    uncertain: ["frutta a guscio", "solfiti", "soia"],
  },
  { term: "=torta", contains: ["glutine", "uova"], uncertain: "all" },
  { term: "=torte", contains: ["glutine", "uova"], uncertain: "all" },
  {
    term: "torta caprese",
    contains: ["frutta a guscio", "uova", "latte"],
    uncertain: [],
  },
  {
    term: "torta paradiso",
    contains: ["glutine", "uova", "latte"],
    uncertain: [],
  },
  {
    term: "crostata",
    contains: ["glutine", "uova", "latte"],
    uncertain: "all",
  },
  {
    term: "ciambellone",
    contains: ["glutine", "uova", "latte"],
    uncertain: [],
  },
  { term: "plumcake", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "muffin", contains: ["glutine", "uova", "latte"], uncertain: "all" },
  { term: "cheesecake", contains: ["glutine", "latte", "uova"], uncertain: [] },
  {
    term: "brownies",
    contains: ["glutine", "uova", "latte"],
    uncertain: ["frutta a guscio", "soia"],
  },
  { term: "waffle", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "bigne", contains: ["glutine", "uova", "latte"], uncertain: "all" },
  {
    term: "profiteroles",
    contains: ["glutine", "uova", "latte"],
    uncertain: [],
  },
  { term: "maritozzo", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "maritozzi", contains: ["glutine", "uova", "latte"], uncertain: [] },
  {
    term: "sfogliatella",
    contains: ["glutine", "latte", "uova"],
    uncertain: [],
  },
  {
    term: "sfogliatelle",
    contains: ["glutine", "latte", "uova"],
    uncertain: [],
  },
  {
    term: "=cannoli",
    contains: ["glutine", "latte"],
    uncertain: ["uova", "frutta a guscio", "solfiti"],
  },
  {
    term: "=cannolo",
    contains: ["glutine", "latte"],
    uncertain: ["uova", "frutta a guscio", "solfiti"],
  },
  {
    term: "cassata",
    contains: ["glutine", "latte", "uova"],
    uncertain: ["frutta a guscio", "solfiti"],
  },
  {
    term: "struffoli",
    contains: ["glutine", "uova"],
    uncertain: ["latte", "solfiti"],
  },
  { term: "zeppole", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "bomboloni", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "krapfen", contains: ["glutine", "uova", "latte"], uncertain: [] },
  { term: "frittelle", contains: ["glutine", "uova"], uncertain: ["latte"] },
  { term: "quiche", contains: ["glutine", "uova", "latte"], uncertain: "all" },
  { term: "panzerotti", contains: ["glutine", "latte"], uncertain: "all" },
  { term: "calzone", contains: ["glutine", "latte"], uncertain: "all" },
  { term: "pasticcini", contains: ["glutine"], uncertain: "all" },
  {
    term: "pasta choux",
    contains: ["glutine", "uova", "latte"],
    uncertain: [],
  },
  { term: "budino", contains: ["latte", "uova"], uncertain: ["glutine"] },
  { term: "budini", contains: ["latte", "uova"], uncertain: ["glutine"] },
  { term: "semifreddo", contains: ["latte", "uova"], uncertain: "all" },
  { term: "mousse", contains: ["latte", "uova"], uncertain: "all" },
  { term: "crema catalana", contains: ["latte", "uova"], uncertain: [] },
  { term: "souffle", contains: ["uova", "latte"], uncertain: ["glutine"] },
  { term: "flan", contains: ["uova", "latte"], uncertain: [] },
  { term: "eggnog", contains: ["uova", "latte"], uncertain: [] },
  { term: "ovetto", contains: ["uova", "latte"], uncertain: "all" },
  { term: "strudel", contains: ["glutine"], uncertain: "all" },
  {
    term: "sbrisolona",
    contains: ["glutine", "frutta a guscio", "latte", "uova"],
    uncertain: [],
  },
  {
    term: "baci di dama",
    contains: ["glutine", "frutta a guscio", "latte"],
    uncertain: [],
  },
  { term: "ricciarelli", contains: ["frutta a guscio", "uova"], uncertain: [] },
  {
    term: "brutti ma buoni",
    contains: ["frutta a guscio", "uova"],
    uncertain: [],
  },
  { term: "nougat", contains: ["frutta a guscio", "uova"], uncertain: [] },
  {
    term: "croccante",
    contains: ["frutta a guscio"],
    uncertain: ["arachidi", "sesamo"],
  },
  { term: "naan", contains: ["glutine"], uncertain: ["latte", "uova"] },
  { term: "kikkoman", contains: ["soia", "glutine"], uncertain: [] },
  {
    term: "proteine vegetali testurizzate",
    contains: ["soia"],
    uncertain: ["glutine"],
  },
  {
    term: "pad thai",
    contains: ["arachidi", "uova", "pesce"],
    uncertain: ["glutine", "soia", "crostacei"],
  },
  {
    term: "sushi",
    contains: ["pesce"],
    uncertain: [
      "crostacei", "molluschi", "soia", "glutine", "sesamo", "uova", "solfiti",
    ],
  },
  { term: "bagna cauda", contains: ["pesce"], uncertain: ["latte"] },
  { term: "tabbouleh", contains: ["glutine"], uncertain: [] },
  { term: "falafel", contains: ["sesamo"], uncertain: ["glutine"] },
  { term: "gazpacho", contains: ["sedano"], uncertain: ["glutine", "solfiti"] },
  {
    term: "bloody mary",
    contains: ["sedano", "pesce"],
    uncertain: ["solfiti"],
  },
  { term: "wasabi", contains: [], uncertain: ["senape"] },
  { term: "senape", contains: ["senape"], uncertain: ["solfiti"] },
  { term: "mostarda", contains: ["senape"], uncertain: ["solfiti"] },
  { term: "dijon", contains: ["senape"], uncertain: ["solfiti"] },
  { term: "pomodori secchi", contains: [], uncertain: ["solfiti"] },
  { term: "frutta disidratata", contains: ["solfiti"], uncertain: [] },
  {
    term: "spalmabile",
    contains: ["latte"],
    uncertain: ["frutta a guscio", "soia"],
  },
  { term: "cappuccino", contains: ["latte"], uncertain: [] },
  {
    term: "hamburger",
    contains: [],
    uncertain: [
      "glutine", "latte", "uova", "soia", "senape", "sedano", "solfiti",
    ],
  },
  {
    term: "spezzatino",
    contains: [],
    uncertain: ["glutine", "solfiti", "sedano"],
  },
  { term: "brasato", contains: [], uncertain: ["solfiti", "sedano"] },
  { term: "stracotto", contains: [], uncertain: ["solfiti", "sedano"] },
  { term: "marinato", contains: [], uncertain: "all" },
  { term: "marinata", contains: [], uncertain: "all" },
  { term: "gratinato", contains: [], uncertain: "all" },
  { term: "gratin", contains: [], uncertain: "all" },
  { term: "fritto misto", contains: [], uncertain: "all" },
  { term: "sciroppato", contains: [], uncertain: ["solfiti"] },
  { term: "mantecato", contains: [], uncertain: "all" },
  { term: "mantecata", contains: [], uncertain: "all" },
  // il grana padano e il provolone possono contenere lisozima (da uovo)
  { term: "grana padano", contains: ["latte"], uncertain: ["uova"] },
  { term: "provolone", contains: ["latte"], uncertain: ["uova"] },
  { term: "sciroppate", contains: [], uncertain: ["solfiti"] },
  // salumi e insaccati: possono contenere latte (lattosio, caseinati), glutine, soia, senape, frutta a guscio (pistacchi
  // nella mortadella), solfiti (vino, conservanti). Mai `clear`.
  ...[
    "salame", "salami", "salamino", "salamini", "mortadella", "mortadelle", "wurstel", "wuerstel", "wurst",
    "frankfurter", "frankfurters", "hot dog", "prosciutto", "prosciutti", "cotechino", "cotechini", "zampone",
    "zamponi", "salsiccia", "salsicce", "luganega", "luganeghe", "salamella", "salamelle", "pancetta", "pancette",
    "bacon", "speck", "coppa", "capocollo", "bresaola", "lardo", "lardelli", "guanciale", "guanciali", "nduja",
    "soppressata", "soppressate", "sopressa", "culatello", "finocchiona", "ciauscolo", "porchetta", "kebab", "salumi",
    "salume", "affettati misti", "insaccati", "insaccato", "pate", "carne in scatola", "carne secca", "carne salada",
    "cacciatorini", "cacciatorino", "salsicciotto", "salsicciotti", "chorizo", "jamon", "pastrami", "corned beef",
  ].map((term): CompositeEntry => ({
    term: `=${term}`,
    contains: [],
    uncertain: "all",
  })),
];

/**
 * Ingredienti generici o composti di cui non si può sapere il contenuto: per un utente con allergeni dichiarati l'esito
 * è `uncertain` per ciascuno di essi, mai `clear`. Valgono sui nomi degli ingredienti e degli alimenti collegati, non
 * sui passi né sul titolo («una crema di zucca» come titolo non dice nulla degli ingredienti).
 */
export const GENERIC_TERMS: readonly string[] = [
  "crema", "salsa", "sugo", "ragu", "ripieno", "farcia", "farcitura", "dado", "brodo", "brodo granulare", "preparato",
  "spezie miste", "mix di spezie", "miscela di spezie", "=mix", "miscela", "condimento", "insaporitore", "glassa",
  "topping", "copertura", "impasto", "base pronta", "fondo bruno", "fumetto", "pastella", "salsina", "sugo pronto",
  "salsa pronta", "piatto pronto", "surgelato misto",
  // legumi non specificati: possono essere soia, lupini, arachidi
  "=legumi", "legumi misti",
];

/**
 * Prodotti pronti o composti e gli ingredienti tipici che contengono senza dirlo nel nome («sonde»). Servono alle
 * esclusioni scritte a mano: chi esclude i pinoli esclude anche il pesto. Per gli allergeni c'è `COMPOSITES`.
 */
export const HIDDEN_CONTENTS: ReadonlyArray<{
  stem: string;
  probes: readonly string[];
  what: string;
}> = [
  {
    stem: "pesto",
    probes: ["parmigiano", "pinoli"],
    what: "formaggio e pinoli",
  },
  { stem: "worcestershire", probes: ["acciughe"], what: "acciughe" },
  { stem: "worcester", probes: ["acciughe"], what: "acciughe" },
  { stem: "margarina", probes: ["latte"], what: "latte" },
  { stem: "gelato", probes: ["latte", "uova"], what: "latte e uova" },
  {
    stem: "brioche",
    probes: ["farina", "burro", "uova"],
    what: "farina, burro e uova",
  },
  {
    stem: "cornett",
    probes: ["farina", "burro", "uova"],
    what: "farina, burro e uova",
  },
  {
    stem: "croissant",
    probes: ["farina", "burro", "uova"],
    what: "farina, burro e uova",
  },
  { stem: "pizza", probes: ["farina"], what: "farina" },
  { stem: "piadina", probes: ["farina"], what: "farina" },
  { stem: "tortilla", probes: ["farina"], what: "farina" },
  { stem: "wrap", probes: ["farina"], what: "farina" },
  { stem: "focaccia", probes: ["farina"], what: "farina" },
  {
    stem: "crepes",
    probes: ["farina", "latte", "uova"],
    what: "farina, latte e uova",
  },
  {
    stem: "pancake",
    probes: ["farina", "latte", "uova"],
    what: "farina, latte e uova",
  },
  {
    stem: "frolla",
    probes: ["farina", "burro", "uova"],
    what: "farina, burro e uova",
  },
  { stem: "tempura", probes: ["farina", "uova"], what: "farina e uova" },
  {
    stem: "tiramisu",
    probes: ["mascarpone", "uova", "biscotti", "caffe"],
    what: "mascarpone, uova, biscotti e caffè",
  },
  {
    stem: "carbonara",
    probes: ["uova", "formaggio", "guanciale"],
    what: "uova, formaggio e guanciale",
  },
  {
    stem: "amatriciana",
    probes: ["guanciale", "pecorino", "pomodoro"],
    what: "guanciale, pecorino e pomodoro",
  },
  {
    stem: "gricia",
    probes: ["guanciale", "pecorino"],
    what: "guanciale e pecorino",
  },
  { stem: "aioli", probes: ["uova", "aglio"], what: "uova e aglio" },
  { stem: "tartara", probes: ["uova"], what: "uova" },
  {
    stem: "cotolett",
    probes: ["pangrattato", "uova"],
    what: "pangrattato e uova",
  },
  {
    stem: "impanat",
    probes: ["pangrattato", "uova"],
    what: "pangrattato e uova",
  },
  {
    stem: "panat",
    probes: ["pangrattato", "uova"],
    what: "pangrattato e uova",
  },
  {
    stem: "polpett",
    probes: ["pangrattato", "uova", "carne"],
    what: "pangrattato, uova e carne",
  },
  { stem: "salsa di soia", probes: ["farina"], what: "frumento" },
  { stem: "birra", probes: ["orzo"], what: "orzo" },
  {
    stem: "ragu",
    probes: ["carne", "pomodoro", "vino"],
    what: "carne, pomodoro e vino",
  },
  {
    stem: "bolognese",
    probes: ["carne", "pomodoro"],
    what: "carne e pomodoro",
  },
  { stem: "dado", probes: ["carne", "sedano"], what: "spesso carne o sedano" },
  { stem: "tonnato", probes: ["tonno", "uova"], what: "tonno e uova" },
  {
    stem: "caponata",
    probes: ["aceto", "melanzane"],
    what: "aceto e melanzane",
  },
  { stem: "zabaione", probes: ["uova", "marsala"], what: "uova e marsala" },
];

/** Espressioni che rendono specifico un ingrediente generico («salsa di pomodoro» non è una salsa qualunque). */
export const GENERIC_MASKS: readonly string[] = [
  "salsa di pomodoro", "sugo di pomodoro", "passata di pomodoro", "crema di latte", "crema pasticcera", "salsa di soia",
];
