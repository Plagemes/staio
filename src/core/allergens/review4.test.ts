// Quarta revisione indipendente: 314 nomi con allergeni, 88 attacchi all'elenco chiuso e 120 righe di ricetta senza
// latte né glutine. Prove di regressione permanenti.
import { describe, expect, it } from "vitest";
import { assessItem } from "./engine";
import { ALLERGEN_KEYS } from "./tables";

/** Nomi che contengono l'allergene (o possono contenerlo): con quell'allergene dichiarato mai `clear`. */
const A: ReadonlyArray<readonly [string, string]> = [
  // ingredienti nascosti / additivi
  ["lecitina", "soia"], ["lecitina E322", "soia"], ["E322", "soia"], ["emulsionante E322", "soia"], ["E 322", "soia"],
  ["caseinati", "latte"], ["caseinato di calcio", "latte"], ["albumina", "uova"], ["lisozima", "uova"], ["E1105", "uova"],
  ["lisozima (E1105)", "uova"], ["sciroppo di glucosio da frumento", "glutine"], ["destrosio di frumento", "glutine"],
  ["maltodestrine di frumento", "glutine"], ["malto d'orzo", "glutine"], ["estratto di malto d'orzo", "glutine"],
  ["surimi", "pesce"], ["colla di pesce", "pesce"], ["gelatina di pesce", "pesce"], ["salsa worcester", "pesce"],
  ["dado", "sedano"], ["dado vegetale", "sedano"], ["siero di latte in polvere", "latte"], ["lattosio", "latte"],
  ["proteine del latte", "latte"], ["burro anidro", "latte"], ["grasso del latte", "latte"], ["E471", "soia"],
  ["amido di frumento", "glutine"], ["glutine di frumento", "glutine"], ["fibra di frumento", "glutine"],
  ["E220", "solfiti"], ["anidride solforosa", "solfiti"], ["metabisolfito di potassio", "solfiti"], ["E224", "solfiti"],
  ["olio di soia", "soia"], ["proteine idrolizzate di soia", "soia"], ["farina di soia", "soia"], ["salsa di pesce", "pesce"],
  ["estratto di lievito", "glutine"], ["aromi", "sedano"], ["aroma naturale", "latte"], ["glutammato", "glutine"],
  // supermercato con nome comune
  ["sofficini", "glutine"], ["bastoncini findus", "pesce"], ["4 salti in padella", "glutine"], ["pancake mix", "uova"],
  ["preparato per torte", "glutine"], ["preparato per pizza", "glutine"], ["base per pizza", "glutine"], ["pasta sfoglia pronta", "latte"],
  ["rotolo di pasta brisée", "glutine"], ["pasta frolla pronta", "uova"], ["piadine", "glutine"], ["tortillas di frumento", "glutine"],
  ["wurstel di pollo", "latte"], ["cordon bleu di tacchino", "latte"], ["crocchette di pollo", "glutine"], ["burger di pollo", "glutine"],
  ["hamburger di soia", "soia"], ["affettato vegetale", "soia"], ["formaggio grattugiato misto", "latte"], ["sottilette light", "latte"],
  ["philadelphia light", "latte"], ["dessert al cioccolato", "latte"], ["merendine", "glutine"], ["crostatine", "uova"],
  ["plumcake confezionati", "uova"], ["biscotti secchi", "glutine"], ["grissini integrali", "glutine"], ["taralli al finocchio", "glutine"],
  ["patatine al formaggio", "latte"], ["popcorn al burro", "latte"], ["salatini", "glutine"], ["crackers di riso", "soia"],
  ["muesli croccante al cioccolato", "glutine"], ["barrette proteiche", "soia"], ["bevanda all'avena", "glutine"],
  ["latte di avena", "glutine"], ["panna vegetale", "soia"], ["margarina vegetale", "latte"], ["maionese light", "uova"],
  ["salsa rosa", "uova"], ["salsa tonnata pronta", "pesce"], ["sugo al ragù pronto", "sedano"], ["pesto pronto", "frutta a guscio"],
  ["sugo all'arrabbiata pronto", "sedano"], ["gnocchi di patate confezionati", "glutine"], ["polenta pronta", "glutine"],
  ["purè in fiocchi", "latte"], ["minestrone surgelato", "sedano"], ["zuppa pronta", "sedano"], ["vellutata pronta", "latte"],
  ["cereali al miele", "glutine"], ["fiocchi di frumento", "glutine"], ["gallette multicereali", "glutine"],
  // piatti regionali
  ["cassoeula", "sedano"], ["pizzoccheri della valtellina", "latte"], ["canederli allo speck", "glutine"], ["casoncelli", "glutine"],
  ["tortelli di zucca", "frutta a guscio"], ["anolini", "latte"], ["passatelli", "glutine"], ["piadina romagnola", "glutine"],
  ["crescia", "glutine"], ["vincisgrassi", "latte"], ["olive all'ascolana", "glutine"], ["arrosticini", "glutine"],
  ["pallotte cacio e uova", "uova"], ["sagne e ceci", "glutine"], ["orecchiette con le cime di rapa", "pesce"],
  ["panzerotti pugliesi", "latte"], ["tiella di riso patate e cozze", "molluschi"], ["frittelle di baccalà", "glutine"],
  ["sfincione", "pesce"], ["pasta con le sarde", "pesce"], ["caponata", "solfiti"], ["arancine al burro", "latte"],
  ["cannoli siciliani", "latte"], ["seadas", "latte"], ["culurgiones", "latte"], ["fregola con arselle", "molluschi"],
  ["malloreddus alla campidanese", "latte"], ["porceddu", "glutine"], ["bagna caoda", "pesce"], ["vitel tonnè", "pesce"],
  ["agnolotti del plin", "uova"], ["bonet", "uova"], ["gianduiotti", "frutta a guscio"], ["baccalà alla vicentina", "latte"],
  ["sarde in saor", "glutine"], ["bigoli in salsa", "pesce"], ["risi e bisi", "latte"], ["polenta e osei", "glutine"],
  ["frico friulano", "latte"], ["jota", "sedano"], ["strangolapreti", "glutine"], ["zelten", "frutta a guscio"],
  ["pici all'aglione", "glutine"], ["ribollita toscana", "sedano"], ["pappardelle al cinghiale", "uova"], ["castagnaccio", "frutta a guscio"],
  ["cecina", "glutine"], ["testaroli", "glutine"], ["trofie al pesto", "frutta a guscio"], ["focaccia di recco", "latte"],
  ["cappon magro", "pesce"], ["torta pasqualina", "uova"], ["carciofi alla giudia", "glutine"], ["supplì al telefono", "latte"],
  ["saltimbocca alla romana", "glutine"], ["coda alla vaccinara", "sedano"], ["amatriciana", "latte"], ["gricia", "latte"],
  ["pasta alla norma", "latte"], ["parmigiana", "latte"], ["sartù di riso", "uova"], ["casatiello", "uova"], ["pastiera", "uova"],
  ["babà al rum", "uova"], ["struffoli napoletani", "glutine"], ["'nduja", "latte"], ["pitta calabrese", "glutine"],
  // stranieri
  ["moussaka", "latte"], ["spanakopita", "glutine"], ["tzatziki", "latte"], ["paella", "crostacei"], ["gazpacho andaluso", "glutine"],
  ["tortilla española", "uova"], ["croquetas", "latte"], ["churros", "glutine"], ["pad thai", "arachidi"], ["tom yum", "crostacei"],
  ["green curry", "pesce"], ["pho", "pesce"], ["bibimbap", "sesamo"], ["kimchi", "pesce"], ["sushi rolls", "pesce"],
  ["tempura udon", "glutine"], ["miso soup", "soia"], ["teriyaki chicken", "soia"], ["dim sum", "glutine"], ["chow mein", "glutine"],
  ["fried rice", "uova"], ["falafel wrap", "glutine"], ["shawarma", "sesamo"], ["baba ghanoush", "sesamo"], ["tabbouleh", "glutine"],
  ["couscous royal", "glutine"], ["tajine", "frutta a guscio"], ["butter chicken", "latte"], ["chicken korma", "frutta a guscio"],
  ["naan bread", "glutine"], ["samosa", "glutine"], ["fish and chips", "pesce"], ["shepherd's pie", "latte"], ["yorkshire pudding", "uova"],
  ["coleslaw", "uova"], ["caesar salad", "pesce"], ["mac and cheese", "latte"], ["clam chowder", "molluschi"], ["pancakes americani", "uova"],
  ["brownie", "uova"], ["cookies", "glutine"], ["donuts", "glutine"], ["bagels", "glutine"], ["pretzel", "glutine"], ["muffins ai mirtilli", "uova"],
  ["quiche", "uova"], ["croque monsieur", "latte"], ["ratatouille", "solfiti"], ["bouillabaisse", "pesce"], ["crêpes suzette", "uova"],
  ["gratin dauphinois", "latte"], ["boeuf bourguignon", "solfiti"], ["coq au vin", "solfiti"], ["vol-au-vent", "glutine"], ["éclair", "uova"],
  ["macarons", "frutta a guscio"], ["madeleines", "uova"], ["financier", "frutta a guscio"], ["brioche française", "latte"], ["fromage blanc", "latte"],
  ["crème fraîche", "latte"], ["beurre", "latte"], ["œufs", "uova"], ["oeufs", "uova"], ["farine de blé", "glutine"], ["moutarde de dijon", "senape"],
  ["noisettes", "frutta a guscio"], ["amandes", "frutta a guscio"], ["crevettes", "crostacei"], ["moules", "molluschi"], ["saumon", "pesce"],
  ["cabillaud", "pesce"], ["thon", "pesce"], ["céleri", "sedano"], ["sésame", "sesamo"], ["arachides", "arachidi"], ["fromage", "latte"],
  ["wheat flour", "glutine"], ["whole milk", "latte"], ["heavy cream", "latte"], ["egg yolk", "uova"], ["shrimp paste", "crostacei"],
  ["oyster sauce", "molluschi"], ["fish sauce", "pesce"], ["soy milk", "soia"], ["sesame oil", "sesamo"], ["peanut oil", "arachidi"],
  ["walnuts halves", "frutta a guscio"], ["celery salt", "sedano"], ["mustard seeds", "senape"], ["sultanas", "solfiti"], ["white wine", "solfiti"],
  // righe lunghe, abbreviazioni, plurali, refusi a distanza 2
  ["250 gr di parmigiano reggiano grattugiato fresco", "latte"], ["1 cucchiaio raso di farina 00 setacciata", "glutine"],
  ["2 uova medie a temperatura ambiente", "uova"], ["3 tuorli", "uova"], ["100 ml panna fresca liquida", "latte"],
  ["1 bicchiere di vino rosso corposo", "solfiti"], ["400 g di gamberoni sgusciati e puliti", "crostacei"], ["8 filetti di acciuga sott'olio sgocciolati", "pesce"],
  ["1 cucchiaino di senape in polvere", "senape"], ["2 coste di sedano tritate finemente", "sedano"], ["50 g di pinoli tostati in padella", "frutta a guscio"],
  ["1 cucchiaio di salsa di soia a basso contenuto di sale", "soia"], ["semi di sesamo q.b. per decorare", "sesamo"], ["30 g di burro morbido a pezzetti", "latte"],
  ["parm. grattugiato", "latte"], ["parm reggiano", "latte"], ["mozz.", "latte"], ["gr. 200 ricotta", "latte"], ["farina tipo 00 gr 300", "glutine"],
  ["uova n. 2", "uova"], ["buro", "latte"], ["mozzaerlla", "latte"], ["parmiggiano reggiano", "latte"], ["pecorrino", "latte"],
  ["gorgonsola", "latte"], ["mascarpne", "latte"], ["farrina", "glutine"], ["spagheti", "glutine"], ["tagliateele", "glutine"],
  ["gamberri", "crostacei"], ["noccciole", "frutta a guscio"], ["mandrole", "frutta a guscio"], ["selano", "sedano"], ["sesammo", "sesamo"],
  ["acciuge", "pesce"], ["salmome", "pesce"], ["tonnno", "pesce"], ["cozzze", "molluschi"], ["vongle", "molluschi"],
  ["uvoa", "uova"], ["yogurth", "latte"], ["ricottta", "latte"], ["pannna montata", "latte"], ["soja sauce", "soia"],
  ["uova sbattute", "uova"], ["chiara d'uovo", "uova"], ["rossi d'uovo", "uova"], ["gusci", "uova"], ["frittatine", "uova"],
  ["cozze sgusciate", "molluschi"], ["polipetti", "molluschi"], ["totanetti", "molluschi"], ["mitili", "molluschi"], ["telline sgusciate", "molluschi"],
  ["crostacei misti", "crostacei"], ["code di mazzancolla", "crostacei"], ["gamberetti in salamoia", "crostacei"], ["paguro", "crostacei"], ["cicale di mare", "crostacei"],
];

/** Attacchi all'elenco chiuso degli alimenti semplici. */
const ATT: ReadonlyArray<readonly [string, string]> = [
  ["risotto", "latte"], ["risotto bianco", "latte"], ["legumi", "soia"], ["legumi", "lupini"], ["legumi misti", "soia"],
  ["farina", "latte"], ["pasta e fagioli", "latte"], ["pasta e ceci", "latte"], ["pasta e piselli", "latte"], ["riso e patate", "latte"],
  ["patate e cozze", "latte"], ["fave e cicoria", "glutine"], ["pasta e lenticchie", "latte"], ["pollo e peperoni", "glutine"],
  ["salmone cotto", "latte"], ["merluzzo cotto", "glutine"], ["pollo intero arrosto", "glutine"], ["arrosto di vitello", "solfiti"],
  ["vitello cotto", "latte"], ["maiale arrosto", "solfiti"], ["agnello arrosto", "solfiti"], ["costata cotta", "latte"],
  ["gamberi lessati", "solfiti"], ["gamberi crudi", "solfiti"], ["acciughe crude", "solfiti"], ["calamari crudi", "glutine"],
  ["mandorle", "arachidi"], ["nocciole", "arachidi"], ["semi di zucca", "sesamo"], ["semi di girasole", "frutta a guscio"],
  ["olio di semi di girasole", "arachidi"], ["olio di mais", "soia"], ["olio di colza", "senape"], ["strutto", "glutine"],
  ["paprica", "glutine"], ["peperoncino in polvere", "senape"], ["curcuma", "senape"], ["cumino", "sedano"], ["cannella", "frutta a guscio"],
  ["lievito di birra fresco", "glutine"], ["lievito di birra", "glutine"], ["lievito", "glutine"], ["origano secco", "solfiti"],
  ["cheddar", "glutine"], ["brie", "glutine"], ["gorgonzola", "glutine"], ["feta", "glutine"], ["emmental", "glutine"],
  ["fiocchi di avena", "latte"], ["couscous", "latte"], ["bulgur", "latte"], ["farina di mais", "glutine"], ["polenta", "latte"],
  ["mais", "glutine"], ["pannocchia", "glutine"], ["funghi", "solfiti"], ["funghi cotti", "glutine"], ["champignon cotti", "latte"],
  ["patata lessa", "latte"], ["zucchine lessate", "latte"], ["spinaci lessati", "latte"], ["spinaci", "latte"], ["carote cotte", "latte"],
  ["caffe", "latte"], ["caffè espresso", "latte"], ["miele", "glutine"], ["zucchero di canna", "glutine"], ["acqua", "latte"],
  ["pollo petto cotto", "glutine"], ["uovo sodo", "latte"], ["kefir", "glutine"], ["yogurt greco", "glutine"], ["latte di capra", "glutine"],
  ["pomodoro", "sedano"], ["pomodori", "solfiti"], ["cetriolo", "senape"], ["avocado", "frutta a guscio"], ["castagne", "glutine"],
  ["tonno fresco", "solfiti"], ["pesce spada", "solfiti"], ["salmone", "latte"], ["gamberi", "solfiti"], ["polpo", "glutine"],
  ["anatra", "latte"], ["coniglio arrosto", "solfiti"], ["fegato di manzo", "latte"], ["fegato", "latte"], ["pancetta fresca", "latte"],
];

/**
 * Attacchi che restano `clear` per decisione: un alimento semplice e un allergene che non lo riguarda (`farina` e
 * latte, `mais` e glutine, oli monoseme e arachidi), o una cottura casalinga semplice (`salmone cotto`).
 * Frutta e verdura fresche, pesce fresco e funghi freschi non sono trattati con solfiti; lo sono i secchi e i crostacei.
 */
const CLEAR_BY_DECISION: ReadonlyArray<readonly [string, string]> = [
  ["farina", "latte"], ["salmone cotto", "latte"], ["merluzzo cotto", "glutine"], ["pollo intero arrosto", "glutine"],
  ["vitello cotto", "latte"], ["maiale arrosto", "solfiti"], ["agnello arrosto", "solfiti"], ["costata cotta", "latte"],
  ["acciughe crude", "solfiti"], ["calamari crudi", "glutine"], ["olio di semi di girasole", "arachidi"],
  ["olio di mais", "soia"], ["olio di colza", "senape"], ["strutto", "glutine"], ["paprica", "glutine"],
  ["peperoncino in polvere", "senape"], ["curcuma", "senape"], ["cumino", "sedano"], ["cannella", "frutta a guscio"],
  ["lievito di birra fresco", "glutine"], ["lievito di birra", "glutine"], ["origano secco", "solfiti"],
  ["cheddar", "glutine"], ["brie", "glutine"], ["gorgonzola", "glutine"], ["feta", "glutine"], ["emmental", "glutine"],
  ["fiocchi di avena", "latte"], ["couscous", "latte"], ["bulgur", "latte"], ["mais", "glutine"],
  ["pannocchia", "glutine"], ["funghi", "solfiti"], ["funghi cotti", "glutine"], ["champignon cotti", "latte"],
  ["patata lessa", "latte"], ["zucchine lessate", "latte"], ["spinaci lessati", "latte"], ["spinaci", "latte"],
  ["carote cotte", "latte"], ["caffe", "latte"], ["caffè espresso", "latte"], ["miele", "glutine"],
  ["zucchero di canna", "glutine"], ["acqua", "latte"], ["pollo petto cotto", "glutine"], ["uovo sodo", "latte"],
  ["kefir", "glutine"], ["yogurt greco", "glutine"], ["latte di capra", "glutine"], ["pomodoro", "sedano"],
  ["pomodori", "solfiti"], ["cetriolo", "senape"], ["avocado", "frutta a guscio"], ["castagne", "glutine"],
  ["tonno fresco", "solfiti"], ["pesce spada", "solfiti"], ["salmone", "latte"], ["anatra", "latte"],
  ["coniglio arrosto", "solfiti"], ["fegato di manzo", "latte"],
];

/** Righe di ricetta senza latte né glutine: il costo della regola invertita. */
const SAFE: readonly string[] = [
  "500 g di patate a pasta gialla", "2 zucchine medie", "1 cipolla dorata", "1 spicchio d'aglio in camicia", "olio extravergine di oliva",
  "sale fino q.b.", "pepe nero q.b.", "1 rametto di rosmarino", "qualche foglia di salvia", "300 g di petto di pollo",
  "4 fettine di vitello", "800 g di spalla di maiale", "1 kg di cosce di pollo", "600 g di macinato di manzo", "1 coniglio a pezzi",
  "400 g di pomodori ramati", "250 g di pomodorini ciliegino", "1 melanzana viola", "2 peperoni gialli", "1 peperone rosso",
  "200 g di fagiolini", "300 g di piselli freschi", "1 cavolfiore piccolo", "1 broccolo", "1 mazzo di asparagi",
  "200 g di spinaci novelli", "1 cespo di lattuga", "100 g di rucola", "1 radicchio di treviso", "2 finocchi",
  "3 carote", "1 porro", "2 scalogni", "1 cipollotto fresco", "1 peperoncino fresco",
  "1 mazzetto di prezzemolo", "basilico fresco", "timo", "maggiorana", "origano",
  "2 foglie di alloro", "1 stecca di cannella", "3 chiodi di garofano", "1 pizzico di noce moscata", "1 bustina di zafferano",
  "paprika dolce", "curcuma in polvere", "zenzero fresco grattugiato", "cumino in semi", "pepe rosa",
  "320 g di riso carnaroli", "200 g di riso basmati", "250 g di lenticchie secche", "400 g di ceci lessati", "300 g di fagioli cannellini",
  "200 g di quinoa", "150 g di miglio", "1 l di acqua", "2 cucchiai di miele", "100 g di zucchero di canna",
  "200 g di zucchero", "succo di 1 limone", "scorza di 1 arancia", "3 mele renette", "2 pere williams",
  "4 banane mature", "500 g di fragole", "200 g di mirtilli", "1 ananas", "1 melone",
  "2 kiwi", "uva bianca", "1 mango", "1 avocado maturo", "lime",
  "olio di semi di girasole per friggere", "olio di oliva", "1 cucchiaio di olio evo", "sale grosso per l'acqua", "acqua tiepida",
  "1 cubetto di lievito di birra", "1 cucchiaino di bicarbonato", "amido di mais", "fecola di patate", "farina di riso",
  "500 g di zucca", "2 patate dolci", "1 cavolo cappuccio", "200 g di cavolo nero", "1 verza",
  "300 g di funghi champignon", "funghi porcini freschi", "1 barbabietola cotta", "2 cetrioli", "1 sedano rapa",
  "3 spicchi d'aglio", "1 cipolla rossa di tropea", "erba cipollina", "menta fresca", "coriandolo fresco",
  "4 cosce d'anatra", "2 petti di tacchino", "4 costolette d'agnello", "1 filetto di manzo", "4 bistecche di manzo",
  "300 g di salsiccia fresca", "2 hg di pancetta", "1 osso di prosciutto", "caffè espresso", "tè nero",
  "acqua frizzante", "ghiaccio", "succo d'arancia fresco", "cacao amaro in polvere", "vaniglia",
  "1 bacca di vaniglia", "anice stellato", "cardamomo", "pepe di cayenna", "semi di finocchio",
];

/** Righe di SAFE che restano `uncertain` con una buona ragione: salumi, farina composta, cacao in polvere. */
const SAFE_UNCERTAIN: readonly string[] = [
  "farina di riso", "300 g di salsiccia fresca", "2 hg di pancetta", "1 osso di prosciutto", "cacao amaro in polvere",
];

const verdict = (name: string, allergens: readonly string[]): string => assessItem({ name }, allergens).verdict;
const key = (name: string, allergen: string): string => `${name}|${allergen}`;

describe("quarta revisione: nomi con allergeni", () => {
  it("nessuno è `clear`", () => {
    expect(A.filter(([name, allergen]) => verdict(name, [allergen]) === "clear")).toEqual([]);
    expect(A.length).toBe(314);
  });
});

describe("quarta revisione: attacchi all'elenco chiuso", () => {
  const decided = new Set(CLEAR_BY_DECISION.map(([name, allergen]) => key(name, allergen)));

  it("ogni attacco è almeno `uncertain`, tranne quelli decisi", () => {
    const wrong = ATT.filter(([name, allergen]) => !decided.has(key(name, allergen))).filter(([name, allergen]) => verdict(name, [allergen]) === "clear");
    expect(wrong).toEqual([]);
  });

  it("gli attacchi decisi restano `clear`: un cambiamento va rivisto qui", () => {
    for (const [name, allergen] of CLEAR_BY_DECISION) {
      expect(ATT.some(([n, a]) => n === name && a === allergen)).toBe(true);
      expect([name, allergen, verdict(name, [allergen])]).toEqual([name, allergen, "clear"]);
    }
  });
});

describe("quarta revisione: costo su righe senza latte né glutine", () => {
  it("restano `uncertain` solo le righe con una buona ragione", () => {
    const uncertain = SAFE.filter((name) => verdict(name, ["latte", "glutine"]) !== "clear");
    expect(uncertain).toEqual(SAFE_UNCERTAIN);
  });
});

describe("quarta revisione: piatti scritti come elenchi", () => {
  it("«e» tra pasta o riso e un legume o una verdura è un piatto: `uncertain`, ingrediente generico", () => {
    for (const name of ["pasta e fagioli", "pasta e ceci", "pasta e piselli", "pasta e lenticchie", "pasta e patate", "riso e patate", "riso e piselli", "200 g di pasta e 300 g di fagioli", "riso e zucchine"]) {
      const f = assessItem({ name }, ["latte"]).findings[0];
      expect([name, f?.verdict, f?.reason]).toEqual([name, "uncertain", "generic"]);
    }
  });

  it("i nomi di piatti noti sono `uncertain`", () => {
    for (const [name, allergen] of [["patate e cozze", "latte"], ["fave e cicoria", "glutine"], ["pollo e peperoni", "glutine"], ["pesce e patate", "glutine"], ["pollo e patate", "latte"]] as const) {
      expect([name, verdict(name, [allergen])]).toEqual([name, "uncertain"]);
    }
  });

  it("gli elenchi veri restano voce per voce", () => {
    for (const name of ["carote, sedano e cipolla", "sale e pepe", "olio e sale", "mela e cannella", "pollo, patate"]) {
      expect([name, verdict(name, ["latte", "glutine"])]).toEqual([name, "clear"]);
    }
    expect(verdict("carote, sedano e cipolla", ["sedano"])).toBe("contains");
  });
});

describe("quarta revisione: «a pasta» come consistenza", () => {
  it("«patate a pasta gialla» non è pasta", () => {
    for (const name of ["500 g di patate a pasta gialla", "patate a pasta bianca", "patate a pasta soda"]) {
      expect([name, verdict(name, ["glutine", "latte", "uova"])]).toEqual([name, "clear"]);
    }
  });

  it("i formaggi a pasta filata, molle o dura restano latte, e la pasta resta glutine", () => {
    for (const name of ["formaggio a pasta filata", "formaggi a pasta molle", "formaggio a pasta dura"]) {
      expect([name, verdict(name, ["latte"])]).toEqual([name, "contains"]);
    }
    expect(verdict("pasta", ["glutine"])).toBe("contains");
    expect(verdict("pasta gialla", ["glutine"])).toBe("contains");
    expect(verdict("patate e pasta", ["glutine"])).toBe("contains");
  });
});

describe("quarta revisione: pesce e crostacei", () => {
  it("«cappon magro» contiene pesce e crostacei ed è incerto per il resto", () => {
    expect(verdict("cappon magro", ["pesce"])).toBe("contains");
    expect(verdict("cappon magro", ["crostacei"])).toBe("contains");
    expect(verdict("cappon magro", ["latte"])).toBe("uncertain");
  });

  it("i crostacei del commercio sono `uncertain` per i solfiti", () => {
    for (const name of ["gamberi crudi", "gamberi lessati", "gamberi", "gamberetti", "scampi", "mazzancolle", "astice", "Gamberi, crudi"]) {
      expect([name, verdict(name, ["solfiti"])]).toEqual([name, "uncertain"]);
      expect([name, verdict(name, ["crostacei"])]).toEqual([name, "contains"]);
    }
    expect(verdict("gamberi crudi", ["latte"])).toBe("clear");
  });
});

describe("quarta revisione: incerti senza buona ragione", () => {
  it("succo d'agrumi spremuto al momento, varietà di frutta e patate, scopi d'uso, tè nero: `clear`", () => {
    for (const name of ["succo di 1 limone", "succo d'arancia fresco", "succo di mezzo limone", "3 mele renette", "2 pere williams", "mele fuji", "patate kennebec", "uva italia", "arance navel", "olio di semi di girasole per friggere", "sale grosso per l'acqua", "olio per la teglia", "sale per condire", "tè nero"]) {
      expect([name, verdict(name, ["latte", "glutine"])]).toEqual([name, "clear"]);
    }
  });

  it("il succo che può essere confezionato resta `uncertain`", () => {
    for (const name of ["succo di limone", "succo d'arancia", "succo di limone confezionato", "succo di limone e zucchero", "succo di mela fresco", "tè verde", "tè"]) {
      expect([name, verdict(name, ["latte", "glutine", "solfiti"])]).toEqual([name, "uncertain"]);
    }
  });

  it("lo scopo non nasconde ciò che si mangia", () => {
    expect(verdict("burro per la teglia", ["latte"])).toBe("contains");
    expect(verdict("farina per spolverare", ["glutine"])).toBe("contains");
  });

  it("«sedano rapa» è sedano e nient'altro", () => {
    expect(verdict("1 sedano rapa", ["sedano"])).toBe("contains");
    expect(verdict("1 sedano rapa", ALLERGEN_KEYS.filter((k) => k !== "sedano"))).toBe("clear");
  });
});
