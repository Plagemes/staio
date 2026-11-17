// La regola invertita: con allergeni dichiarati, `clear` solo per alimenti semplici riconosciuti.
import { describe, expect, it } from "vitest";
import { FOODS } from "../nutrition/data/foods";
import { assessItem, assessRecipe, matchExclusion } from "./engine";
import { GROUP_ALLERGENS, SIMPLE_NUTRITION_IDS } from "./knownFoods";
import { ALLERGEN_KEYS, type AllergenKey } from "./tables";

const verdict = (name: string, allergens: readonly string[]): string => assessItem({ name }, allergens).verdict;

/** Alimenti semplici senza allergeni, scritti come in una ricetta: con tutti i 14 allergeni dichiarati devono essere `clear`. */
const SIMPLE_FOODS: readonly string[] = [
  // verdure
  "Zucchine", "Melanzane", "Peperoni rossi", "Peperone giallo", "Pomodori", "Pomodorini ciliegino", "Carote", "Patate", "Patate novelle", "Cipolla",
  "Cipolla rossa di Tropea", "Scalogno", "Aglio", "Spicchio d'aglio", "Porri", "Finocchi", "Carciofi", "Asparagi",
  "Broccoli", "Cavolfiore", "Cavolo nero", "Cavolo cappuccio", "Verza", "Cavolini di Bruxelles", "Cime di rapa",
  "Ravanelli", "Barbabietola", "Bietole", "Spinaci freschi", "Lattuga", "Rucola", "Valeriana", "Indivia", "Scarola",
  "Radicchio", "Cicoria", "Cetrioli", "Zucca", "Fagiolini", "Piselli", "Mais", "Funghi champignon", "Funghi porcini",
  "Topinambur", "Agretti",
  // frutta
  "Mele", "Pere", "Banane", "Arance", "Mandarini", "Limone", "Lime", "Pompelmo", "Fragole", "Ciliegie", "Pesche",
  "Albicocche", "Prugne", "Uva", "Kiwi", "Ananas", "Melone", "Anguria", "Fichi", "Cachi", "Mirtilli", "Lamponi", "More",
  "Ribes", "Melagrana", "Mango", "Papaia", "Avocado", "Nespole", "Clementine",
  "Scorza di limone",
  // carne
  "Petto di pollo", "Cosce di pollo", "Ali di pollo", "Pollo intero", "Fesa di tacchino", "Carne macinata di manzo",
  "Macinato di maiale", "Filetto di manzo", "Bistecca di manzo", "Costata", "Girello", "Lonza di maiale", "Arista",
  "Costine di maiale", "Filetto di maiale", "Spalla di maiale", "Agnello", "Cosciotto di agnello", "Coniglio", "Anatra",
  "Faraona", "Quaglie", "Vitello", "Fegato di vitello", "Trippa", "Ossobuco", "Cinghiale", "Capretto", "Tacchino",
  "Lingua di manzo",
  // legumi senza allergeni
  "Lenticchie", "Lenticchie rosse", "Ceci", "Fagioli cannellini", "Fagioli borlotti", "Fagioli neri", "Fave",
  "Piselli secchi", "Cicerchie", "Fagioli rossi", "Azuki",
  // cereali e amidi senza glutine, semi
  "Riso", "Riso basmati", "Riso integrale", "Riso carnaroli", "Quinoa", "Miglio", "Amaranto", "Fecola di patate",
  "Amido di mais", "Tapioca",
  // erbe
  "Basilico", "Prezzemolo", "Rosmarino", "Salvia", "Timo", "Origano", "Maggiorana", "Menta", "Alloro", "Erba cipollina",
  "Aneto", "Dragoncello", "Coriandolo", "Finocchietto", "Foglie di alloro",
  // spezie pure
  "Pepe nero", "Pepe bianco", "Peperoncino", "Paprika dolce", "Cannella", "Noce moscata", "Chiodi di garofano", "Cumino",
  "Curcuma", "Zenzero", "Zafferano", "Cardamomo", "Anice stellato", "Vaniglia", "Bacche di ginepro",
  // oli, sale, zucchero, acqua
  "Olio extravergine d'oliva", "Olio di oliva", "Olio di semi di girasole", "Strutto", "Sale", "Sale grosso", "Sale fino",
  "Zucchero", "Zucchero di canna", "Miele", "Acqua", "Caffè", "Bicarbonato",
  // come si scrivono in una ricetta
  "2 zucchine medie", "500 g di patate", "1 cipolla bianca tritata", "Sale q.b.", "Pepe nero macinato q.b.",
  "3 cucchiai di olio extravergine d'oliva", "Un ciuffo di prezzemolo", "Mezzo limone",
  "400 g di petto di pollo a cubetti", "Pomodori maturi",
];

/**
 * Erano nell'elenco degli alimenti semplici fino alla terza revisione: conserve, sottaceti, succhi, frutta secca o
 * disidratata, semi (lavorati con frutta a guscio, arachidi, sesamo), bevande, cacao. Con tutti i 14 allergeni
 * dichiarati non sono più `clear`.
 */
const NO_LONGER_SIMPLE: readonly string[] = [
  "Pomodori pelati", "Passata di pomodoro", "Polpa di pomodoro", "Concentrato di pomodoro", "Olive nere", "Datteri",
  "Cocco", "Frutti di bosco", "Succo di limone", "Ceci in scatola", "Semi di zucca", "Semi di girasole", "Semi di lino",
  "Semi di chia", "Tè verde", "Cacao amaro", "Mezzo limone (succo)",
];

const SULFITE_TREATED: ReadonlySet<string> = new Set(["gamberi-crudi", "gamberi-lessati", "astice-crudo"]);

describe("regola invertita: l'elenco chiuso degli alimenti semplici", () => {
  it("conserve, succhi, frutta disidratata, semi, bevande e cacao non sono più alimenti semplici", () => {
    expect(NO_LONGER_SIMPLE.filter((name) => verdict(name, ALLERGEN_KEYS) === "clear")).toEqual([]);
  });

  it(`almeno 150 alimenti semplici senza allergeni sono \`clear\` con tutti i 14 allergeni dichiarati`, () => {
    expect(SIMPLE_FOODS.length).toBeGreaterThanOrEqual(150);
    const notClear = SIMPLE_FOODS.filter((name) => verdict(name, ALLERGEN_KEYS) !== "clear");
    expect(notClear).toEqual([]);
  });

  it("un nome non riconosciuto è incerto con il motivo «nome non riconosciuto», diverso da «generico o composto»", () => {
    const unknown = assessItem({ name: "Zuppa del contadino" }, ["glutine"]).findings[0];
    // «zuppa» è una parola di preparazione: resta come parola non riconosciuta solo «contadino»
    expect(unknown).toMatchObject({ verdict: "uncertain", reason: "unrecognized", term: "contadino" });
    const generic = assessItem({ name: "Crema" }, ["glutine"]).findings[0];
    expect(generic).toMatchObject({ verdict: "uncertain", reason: "generic" });
    for (const name of ["Snack", "Bastoncini", "Merendina", "Preparato X", "Quorn", "Gyros", "Olio"]) {
      expect([name, verdict(name, ["arachidi"])]).toEqual([name, "uncertain"]);
    }
  });

  it("«olio» e «olio di semi» senza altro non bastano per arachidi, soia e sesamo; per gli altri allergeni sì", () => {
    for (const name of ["Olio", "Olio di semi", "Olio di semi vari", "Olio vegetale"]) {
      for (const a of ["arachidi", "soia", "sesamo"]) expect([name, a, verdict(name, [a])]).toEqual([name, a, "uncertain"]);
      expect([name, verdict(name, ["latte"])]).toEqual([name, "clear"]);
    }
  });

  it("i salumi non sono alimenti semplici: almeno incerti per il latte", () => {
    for (const name of ["Mortadella", "Wurstel", "Prosciutto cotto", "Salame", "Cotechino", "Speck", "Salsiccia", "Bresaola", "Guanciale", "Pancetta"]) {
      expect([name, verdict(name, ["latte"])]).not.toEqual([name, "clear"]);
    }
  });

  it("un nome di più parole che non vale per l'allergene non si spezza: «fiocchi di mais» non è `clear` per il glutine", () => {
    expect(verdict("Fiocchi di mais", ["glutine"])).not.toBe("clear");
    expect(verdict("Rosso d'uovo", ["uova"])).toBe("contains");
    expect(verdict("Mele rosse", ["uova"])).toBe("clear");
  });

  it("le esclusioni scritte a mano NON seguono la regola invertita: un nome sconosciuto non è sospetto", () => {
    expect(matchExclusion("Sughetto della nonna", "funghi")).toBeUndefined();
    const r = assessRecipe({ ingredients: [{ name: "Sughetto della nonna" }, { name: "Quorn" }] }, { excludedFoods: ["funghi"] });
    expect(r.verdict).toBe("clear");
  });
});

describe("tabella nutrizionale, gruppo per gruppo", () => {
  const GLUTEN_FREE_CEREALS = new Set([
    "riso-bianco-crudo", "riso-bianco-lessato", "riso-tondo-crudo", "riso-tondo-lessato", "riso-integrale-crudo",
    "riso-integrale-lessato", "farina-di-mais", "amido-di-mais", "quinoa-cruda", "quinoa-lessata", "miglio-crudo",
    "miglio-lessato", "gallette-di-riso", "popcorn", "patatine-in-sacchetto", "patatine-fritte-surgelate",
    "patatine-fritte-al-forno",
  ]);
  const NUT_SEEDS: Record<string, AllergenKey> = { arachidi: "arachidi", "burro-di-arachidi": "arachidi", "semi-di-sesamo": "sesamo" };
  const NOT_ALLERGENS = new Set(["cocco-fresco", "semi-di-girasole", "semi-di-zucca", "semi-di-lino", "semi-di-chia"]);

  /** L'allergene (o gli allergeni, uno basta) che ogni alimento di un gruppo allergenico deve dare come `contains`. */
  function expected(id: string, group: string): AllergenKey[] | undefined {
    switch (group) {
      case "latticini":
        return ["latte"];
      case "uova":
        return ["uova"];
      case "pesce":
        return ["pesce", "crostacei", "molluschi"];
      case "frutta-secca":
        return NOT_ALLERGENS.has(id) ? undefined : [NUT_SEEDS[id] ?? "frutta a guscio"];
      case "cereali":
        return GLUTEN_FREE_CEREALS.has(id) ? undefined : ["glutine"];
      case "legumi":
        if (["soia-secca", "soia-lessata", "edamame-surgelati", "tofu-crudo", "tempeh"].includes(id)) return ["soia"];
        if (id.startsWith("lupini")) return ["lupini"];
        if (id === "hummus") return ["sesamo"];
        if (id === "minestrone-in-scatola") return ["sedano"];
        return undefined;
      default:
        return undefined;
    }
  }

  it("ogni alimento di un gruppo allergenico dà `contains`, non `clear`", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const f of FOODS) {
      const keys = expected(f.id, f.group);
      if (!keys) continue;
      checked++;
      const r = assessItem({ name: f.name }, keys);
      if (!r.findings.some((x) => x.verdict === "contains")) wrong.push(`${f.group}: ${f.name} → ${r.verdict}`);
    }
    expect(checked).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  });

  it("nessun nome o alias di un alimento allergenico è `clear` per il suo allergene", () => {
    const wrong: string[] = [];
    for (const f of FOODS) {
      const keys = expected(f.id, f.group);
      if (!keys) continue;
      for (const alias of f.aliases ?? []) {
        const r = assessItem({ name: alias }, keys);
        if (r.verdict === "clear") wrong.push(`${f.id}: «${alias}»`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("i salumi della tabella sono almeno incerti per il latte", () => {
    const clear = FOODS.filter((f) => f.group === "salumi").filter((f) => verdict(f.name, ["latte"]) === "clear");
    expect(clear).toEqual([]);
  });

  it("il nome mostrato di ogni voce semplice («Manzo, fesa (coscia), cruda (taglio USA)») resta riconosciuto", () => {
    const wrong: string[] = [];
    const simple = FOODS.filter((f) => SIMPLE_NUTRITION_IDS.has(f.id));
    for (const f of simple) {
      const implied = GROUP_ALLERGENS[f.group] ?? [];
      for (const x of assessItem({ name: f.name }, ALLERGEN_KEYS).findings) {
        if (implied !== "all" && implied.includes(x.allergen as AllergenKey)) continue;
        // i crostacei del commercio possono essere trattati con solfiti
        if (x.allergen === "solfiti" && SULFITE_TREATED.has(f.id)) continue;
        if (x.reason === "unrecognized" || x.reason === "processed") wrong.push(`${f.name} → ${x.allergen}: ${x.reason} «${x.term}»`);
      }
    }
    expect(wrong).toEqual([]);
    expect(simple.length).toBeGreaterThan(200);
  });
});

describe("errori di battitura", () => {
  it.each<[string, string, string]>([
    ["Mozarella", "latte", "mozzarella"],
    ["Parmiggiano", "latte", "parmigiano"],
    ["Spagetti", "glutine", "spaghetti"],
    ["Ricota", "latte", "ricotta"],
    ["Stocafisso", "pesce", "stoccafisso"],
    ["Yougurt", "latte", "yogurt"],
    ["Mascarpome", "latte", "mascarpone"],
    ["Tagliatele", "glutine", "tagliatelle"],
  ])("«%s» → `contains` %s, con «forse intendevi «%s»?»", (name, allergen, entry) => {
    const f = assessItem({ name }, [allergen]).findings[0];
    expect(f).toMatchObject({ verdict: "contains", reason: "typo", term: entry });
    expect(f?.note).toMatch(/forse intendevi/);
  });

  it("le parole troppo corte non si correggono, ma restano incerte", () => {
    expect(verdict("Pannna", ["latte"])).toBe("uncertain");
    expect(verdict("Uvo", ["uova"])).toBe("uncertain");
  });

  it("una parola nota non è un refuso: «polpette» non è «polipetti»", () => {
    expect(assessItem({ name: "Polpette di zucchine" }, ["molluschi"]).findings[0]?.reason).not.toBe("typo");
  });
});

describe("coordinazione ed eccezioni", () => {
  it("«latte di mandorla e di vacca» contiene latte e frutta a guscio", () => {
    expect(verdict("Latte di mandorla e di vacca", ["latte"])).toBe("contains");
    expect(verdict("Latte di mandorla e di vacca", ["frutta a guscio"])).toBe("contains");
    expect(verdict("Burro di cacao e di vacca", ["latte"])).toBe("contains");
    // bevanda confezionata: non è latte, ma non è un alimento semplice
    expect(verdict("Latte di mandorla", ["latte"])).toBe("uncertain");
  });
});

/**
 * Le voci della tabella nutrizionale ammesse come alimenti semplici, una per una, per la revisione di una persona.
 * Aggiungerne una qui e in `SIMPLE_NUTRITION_IDS` è una decisione: va motivata.
 */
const ADMITTED_SIMPLE: readonly string[] = [
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

];

describe("voci della tabella nutrizionale ammesse come semplici", () => {
  it("l'elenco ammesso è esattamente questo, e ogni voce esiste", () => {
    const ids = new Set(FOODS.map((f) => f.id));
    expect(ADMITTED_SIMPLE.filter((id) => !ids.has(id))).toEqual([]);
    expect([...SIMPLE_NUTRITION_IDS].sort()).toEqual([...ADMITTED_SIMPLE].sort());
  });

  it("nessun prodotto da forno, cereale da colazione, dolce, salsa, conserva, bevanda (tranne acqua, caffè e tè nero) o salume è ammesso", () => {
    const allowedByGroup: Record<string, readonly string[]> = {
      salumi: [],
      dolci: ["zucchero-semolato", "zucchero-di-canna", "miele"],
      bevande: ["acqua", "caffe-espresso", "te-nero"],
    };
    for (const f of FOODS.filter((x) => SIMPLE_NUTRITION_IDS.has(x.id))) {
      const allowed = allowedByGroup[f.group];
      if (allowed) expect([f.id, allowed.includes(f.id)]).toEqual([f.id, true]);
    }
  });
});

describe("terza revisione: modificatori, una sola cosa per riga, preparazioni", () => {
  it("prodotti pronti, confezionati, surgelati, impanati, misti: `uncertain` per ogni allergene", () => {
    for (const name of ["Pollo pronto", "Pollo confezionato", "Pollo trattato", "Riso precotto", "Piselli surgelati", "Zucchine panate", "Verdure miste", "Pesce misto", "Tonno sott'olio", "Spinaci surgelati"]) {
      expect([name, verdict(name, ["sedano"])]).toEqual([name, "uncertain"]);
    }
    expect(assessItem({ name: "Spinaci surgelati" }, ["latte"]).findings[0]).toMatchObject({ reason: "processed" });
    // «non trattato» (agrumi) non conta
    expect(verdict("Scorza di limone non trattato", ALLERGEN_KEYS)).toBe("clear");
  });

  it("secco, essiccato, disidratato: `uncertain` per i solfiti su frutta, verdura e pesce, non sui legumi", () => {
    for (const name of ["Mango essiccato", "Mele essiccate", "Funghi secchi", "Funghi porcini secchi", "Patate disidratate"]) {
      expect([name, verdict(name, ["solfiti"])]).not.toEqual([name, "clear"]);
    }
    expect(verdict("Funghi secchi", ["latte"])).toBe("clear");
    expect(verdict("Lenticchie secche", ["solfiti"])).toBe("clear");
    for (const name of ["Gamberi surgelati", "Succo di limone confezionato"]) expect([name, verdict(name, ["solfiti"])]).not.toEqual([name, "clear"]);
  });

  it("una riga `clear` nomina UN alimento semplice; un elenco con virgole o «e» vale voce per voce", () => {
    for (const name of ["Riso con piselli", "Pollo al curry", "Latte di cocco", "Insalata di riso", "Insalata di pollo", "Purè di patate", "Purea di patate", "Succo di pomodoro", "Crema di zucca", "Vellutata di zucca", "Spiedini di pollo", "Macedonia di frutta", "Arrosto di vitello"]) {
      expect([name, verdict(name, ["uova", "latte", "sedano"])]).not.toEqual([name, "clear"]);
    }
    for (const name of ["Sale e pepe", "Carote, zucchine e cipolla", "Fettine di vitello", "Petto di pollo", "Carne macinata di manzo", "Filetti di orata", "Pollo arrosto", "Cuori di carciofo"]) {
      expect([name, verdict(name, ["latte", "uova"])]).toEqual([name, "clear"]);
    }
    // un taglio da solo non dice di che animale è
    for (const name of ["Petto", "Coda", "Lingua", "Filetto"]) expect([name, verdict(name, ["pesce"])]).toEqual([name, "uncertain"]);
  });

  it("radici che toccavano parole innocue: niente falsi `contains`", () => {
    const cases: Array<[string, string]> = [
      ["Zucchero semolato", "glutine"], ["Pastinaca", "glutine"], ["Granoturco", "glutine"], ["Panetto di lievito di birra", "glutine"],
      ["Pepe nero in grani", "glutine"], ["Farinata di ceci", "glutine"], ["Riso glutinoso", "glutine"], ["Zucca butternut", "latte"],
      ["Granatina", "latte"], ["Lattuga", "latte"], ["Pannocchia", "latte"], ["Olive senza nocciolo", "frutta a guscio"],
      ["Noce di vitello", "frutta a guscio"], ["Una noce di burro", "frutta a guscio"], ["Noce moscata", "frutta a guscio"],
      ["Pesca noce", "frutta a guscio"], ["Granelli di sale", "frutta a guscio"], ["Acetosella", "solfiti"],
      ["Pecorino sardo", "pesce"], ["Pesche", "pesce"], ["Uva", "uova"], ["Sforzo", "glutine"], ["Sorriso", "glutine"],
    ];
    for (const [name, allergen] of cases) expect([name, allergen, verdict(name, [allergen])]).not.toEqual([name, allergen, "contains"]);
    // il sedano rapa è sedano, il grano è glutine, il grana è latte
    expect(verdict("Sedano rapa", ["sedano"])).toBe("contains");
    expect(verdict("Grano", ["glutine"])).toBe("contains");
    expect(verdict("Grana", ["latte"])).toBe("contains");
    expect(verdict("Grana padano", ["uova"])).toBe("uncertain");
    expect(verdict("Provolone", ["uova"])).toBe("uncertain");
    expect(verdict("Riso mantecato", ["latte"])).not.toBe("clear");
  });
});
