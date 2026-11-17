// Regressione permanente: i casi della seconda revisione (circa 400 nomi reali di alimenti con allergeni, refusi
// compresi, più le espressioni con eccezioni e dichiarazioni «senza…»). Nessuno può dare `clear` per l'allergene
// indicato: `contains` o, al minimo, `uncertain`.
import { describe, expect, it } from "vitest";
import { assessItem, assessRecipe } from "./engine";

const BY_ALLERGEN: Record<string, string[]> = {
  glutine: [
    "pastiera", "mollica", "pan grattugiato", "fregola", "malloreddus", "pici", "bigoli", "trenette", "conchiglie",
    "casarecce", "garganelli", "maltagliati", "cavatelli", "passatelli", "canederli", "tigelle", "crescentine",
    "gnocco fritto", "pinsa", "ciabatta", "rosetta", "michetta", "baguette", "pita", "naan", "chapati", "panzerotti",
    "calzone", "sfogliatella", "cannoli", "struffoli", "zeppole", "bomboloni", "krapfen", "ciambellone", "torta paradiso",
    "plumcake", "muffin", "pasticcini", "tarallucci", "frisa", "cuscus", "tabbouleh", "corn flakes", "pane carasau",
    "sfoglia", "pasta sfogla", "spagetti", "tagliatele", "farina 00", "farina manitoba", "farina integrale", "orzotto",
    "birra", "seitan senza glutine", "farro senza glutine", "orzo senza glutine", "graham", "pumpernickel", "bao",
    "dumplings", "pasta brisè", "biscotto", "farina tipo 1", "strudel", "cheesecake", "brownies", "waffle",
  ],
  latte: [
    "caprino", "tomino", "gouda", "maasdam", "leerdammer", "sottilette", "creme fraiche", "panna acida", "smetana",
    "dulce de leche", "budino", "semifreddo", "crema catalana", "mousse al cioccolato", "profiteroles", "cannoli siciliani",
    "cassata", "bitto", "raschera", "piave", "fiore sardo", "canestrato", "ragusano", "manchego", "roquefort", "stilton",
    "pecorino romano", "parmiggiano", "mozarella", "mascarpone", "ricotta salata", "stracchino", "burro chiarificato",
    "mortadella", "wurstel", "prosciutto cotto", "salame", "cotechino", "latte condensato", "gelato al fiordilatte",
    "cheddar", "philadelphia", "spalmabile", "formaggio spalmabile", "tzatziki", "raita", "lassi", "cappuccino",
    "caffellatte", "mozzarella di bufala", "scamorza affumicata", "galbanino", "pannna", "yougurt", "ricota", "grana padano",
    "trentingrana", "asiago", "fontina", "puzzone", "vezzena", "taleggio",
  ],
  uova: [
    "panettone", "pandoro", "colomba", "ciambellone", "plumcake", "muffin", "torta", "crostata", "bignè", "pasta choux",
    "frittelle", "flan", "budino", "crema catalana", "quiche", "soufflé", "passatelli", "canederli", "mayo", "uvo",
    "ovetto", "tagliatelle all'uovo", "maritozzo", "egg noodles", "eggnog", "uova di quaglia", "tuorli", "albumi",
    "meringata", "occhio di bue", "uova sode", "pasta fresca all uovo",
  ],
  pesce: [
    "san pietro", "lavarello", "coregone", "lucioperca", "capitone", "palamita", "tombarello", "alalunga", "lampuga",
    "sugarello", "sushi", "sashimi", "nigiri", "lox", "gravlax", "bagna cauda", "tobiko", "ikura", "missoltini",
    "latterini", "bianchetti", "neonata", "haddock", "mackerel", "trout", "sea bass", "pollock", "cod", "sardines",
    "anchovies", "acciughe sott olio", "filetti di alici", "salmone affumicato", "sgombri", "orate", "spigole", "baccalà",
    "stocafisso", "tonnetto", "bonito", "seppia", "pesce persico", "tartare di tonno", "poke di salmone",
  ],
  crostacei: [
    "granseola", "langoustine", "moleche", "cicale", "pannocchie di mare", "gamberi rossi", "gamberetti", "scampi",
    "astici", "king crab", "ebi", "mazzancolle", "canocchie", "prawns", "shrimps", "aragoste", "polpa di granchio",
    "gamberi di fiume", "crostacei misti", "bisque di astice",
  ],
  molluschi: [
    "lupini di mare", "tartufi di mare", "muscoli", "peoci", "caparozzoli", "chiocciole", "bulot", "murici", "cozze",
    "vongole veraci", "calamari", "polpo", "seppioline", "moscardini", "totani", "ostriche", "cape sante", "telline",
    "cannolicchi", "fasolari", "lumache", "escargots", "squid", "octopus", "mussels", "clams", "scallops", "calamaro",
    "polipo", "pulpo", "seppie",
  ],
  arachidi: ["bagigi", "spagnolette", "peanuts", "noccioline americane", "burro d'arachidi", "olio di semi di arachide", "pad thai", "satay", "arachidi salate", "peanut butter"],
  "frutta a guscio": [
    "croccante", "brutti ma buoni", "baci di dama", "ricciarelli", "pasta reale", "frutta martorana", "sbrisolona",
    "torta caprese", "nociole", "mandorle", "nocciole", "pistacchi", "pistacci", "anacardi", "noci pecan", "macadamia",
    "noci del brasile", "gianduiotti", "torrone", "pralinato", "frangipane", "pesto", "pesto di pistacchio",
    "granella di nocciole", "crema di pistacchio", "mandorlato", "nocciolato", "almonds", "hazelnuts", "walnuts",
    "cashews", "pistachios", "latte di mandorla", "farina di mandorle", "orzata", "amaretto", "nocino", "panforte",
    "marron glacé", "praline", "nougat", "pecan pie", "nutella", "noce", "gheriglio",
  ],
  soia: ["okara", "proteine vegetali testurizzate", "spezzatino di soia", "kikkoman", "soy sauce", "tofu", "tempeh", "edamame", "miso", "tamari", "shoyu", "yuba", "natto", "bevanda di soia", "salsa teriyaki", "fagioli di soia", "soja"],
  sedano: ["sedano rapa", "celeriac", "soffritto", "minestrone", "gazpacho", "mirepoix", "bloody mary", "dado vegetale", "brodo vegetale", "sale aromatico", "costa di sedano", "sedani"],
  senape: ["senape", "mostarda", "dijon", "honey mustard", "wasabi", "senape in grani", "salsa tartara", "mostarda di cremona", "moutarde"],
  sesamo: ["babaganoush", "baba ganoush", "furikake", "goma", "falafel", "houmous", "hummus", "tahina", "tahini", "gomasio", "halva", "za'atar", "semi di sesamo", "olio di sesamo", "sesame"],
  lupini: ["lupini", "lupino", "farina di lupini", "lupin", "lupine"],
  solfiti: [
    "balsamico", "vin santo", "vinsanto", "vincotto", "mosto cotto", "lambrusco", "chianti", "barolo", "nebbiolo", "pinot",
    "moscato", "verdicchio", "madeira", "martini", "spritz", "albicocche secche", "uvetta", "uva passa", "marsala",
    "aceto di mele", "aceto", "vino bianco", "prosecco", "sidro", "patate disidratate", "prugne secche", "fichi secchi",
    "frutta candita", "canditi", "senape",
  ],
};

const EXPRESSIONS: Array<[string, string]> = [
  ["burro di cacao e burro", "latte"],
  ["burro di cacao, burro", "latte"],
  ["burro di cacao con burro", "latte"],
  ["burro di cacao/latte", "latte"],
  ["noce moscata e noci", "frutta a guscio"],
  ["noce moscata e noce", "frutta a guscio"],
  ["noce di cocco e nocciole", "frutta a guscio"],
  ["pasta senza glutine con pangrattato", "glutine"],
  ["pasta senza glutine e farina", "glutine"],
  ["latte di mandorla e latte", "latte"],
  ["latte di mandorla e latte intero", "latte"],
  ["latte di mandorla", "frutta a guscio"],
  ["uova di lompo e uova", "uova"],
  ["uova di lompo", "pesce"],
  ["mozzarella senza lattosio", "latte"],
  ["latte senza lattosio", "latte"],
  ["latte delattosato", "latte"],
  ["formaggio senza lattosio", "latte"],
  ["burro senza lattosio", "latte"],
  ["pane senza glutine al farro", "glutine"],
  ["farina di farro senza glutine", "glutine"],
  ["farina di riso e frumento", "glutine"],
  ["farina di mais e di grano", "glutine"],
  ["pasta di mandorle e farina", "glutine"],
  ["latte di cocco e panna", "latte"],
  ["latte di soia e latte vaccino", "latte"],
  ["latte di mandorla e di vacca", "latte"],
  ["latte di riso o latte", "latte"],
  ["noce di burro", "latte"],
  ["noce di burro e noci", "frutta a guscio"],
  ["crema di latte", "latte"],
  ["burro di arachidi", "arachidi"],
  ["burro di arachidi", "latte"],
  ["pasta di acciughe", "pesce"],
  ["pasta di sesamo", "sesamo"],
  ["grano saraceno e grano", "glutine"],
  ["grano saraceno", "glutine"],
  ["latte vegetale", "latte"],
  ["bevanda vegetale", "latte"],
  ["burro di cacao del burro", "latte"],
  ["noce moscata noci", "frutta a guscio"],
  ["pane gluten free con orzo", "glutine"],
  ["senza glutine", "glutine"],
  ["biscotti senza glutine", "glutine"],
  ["cous cous senza glutine", "glutine"],
  ["pangrattato senza glutine", "glutine"],
  ["burro di karitè e burro", "latte"],
  ["noci di cocco e noci", "frutta a guscio"],
  ["latte di mandorle di latte", "latte"],
];

describe("seconda revisione: nessun alimento con allergene risulta compatibile", () => {
  const cases = Object.entries(BY_ALLERGEN).flatMap(([key, names]) => names.map((name) => [key, name] as const));

  it("i casi sono quelli della revisione (almeno 350 nomi)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(350);
  });

  it("nessun nome dà `clear` per il suo allergene", () => {
    const clear = cases.filter(([key, name]) => assessItem({ name }, [key]).verdict === "clear");
    expect(clear).toEqual([]);
  });

  it("le espressioni con eccezioni e dichiarazioni non danno `clear`", () => {
    const clear = EXPRESSIONS.filter(([text, key]) => assessItem({ name: text }, [key]).verdict === "clear");
    expect(clear).toEqual([]);
  });

  it("nei passi: «una noce di burro» è latte, «noce moscata e noci tritate» è frutta a guscio", () => {
    const r = assessRecipe(
      { title: "Torta", ingredients: [{ name: "zucchero" }], steps: ["aggiungi una noce di burro", "spolvera di noce moscata e noci tritate"] },
      { allergens: ["latte", "frutta a guscio"] },
    );
    expect(r.allergens.map((a) => [a.allergen, a.verdict, a.steps.length > 0])).toEqual([
      ["latte", "contains", true],
      ["frutta a guscio", "contains", true],
    ]);
  });
});
