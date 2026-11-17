import { describe, expect, it } from "vitest";
import {
  ALLERGEN_CHECK_NOTICE,
  ALLERGEN_KEYS,
  assessItem,
  assessRecipe,
  assessText,
  canonicalAllergen,
  canonicalAllergens,
  matchExclusion,
  type AllergenKey,
  type ItemSubject,
  type Verdict,
} from "./index";
import { stemWord } from "./normalize";

/** L'esito per un solo allergene. */
function verdictOf(subject: ItemSubject | string, allergen: string): Verdict {
  const item = typeof subject === "string" ? { name: subject } : subject;
  const f = assessItem(item, [allergen]).findings[0];
  return f ? f.verdict : "clear";
}

interface AllergenCase {
  /** Singolare, plurale, accento, maiuscole, derivato, composto…: devono dare `contains`. */
  forms: string[];
  /** Una frase di un passo della ricetta. */
  step: string;
  /** Un ingrediente generico collegato a un alimento di dispensa che lo contiene. */
  linked: [ingredient: string, pantryName: string];
  /** Parole simili che non devono dare un falso positivo evitabile. */
  notThis: string[];
}

const CASES: Record<AllergenKey, AllergenCase> = {
  glutine: {
    forms: ["Spaghetto", "Spaghetti", "Pancarrè", "PANGRATTATO", "Seitan", "Pan grattato", "Cous-cous", "Farina di farro", "Pasta frolla", "Cotoletta alla milanese", "Fiocchi d'avena"],
    step: "Infarinate leggermente le zucchine e friggetele.",
    linked: ["Base", "Pasta sfoglia rotonda"],
    notThis: ["Riso", "Mais", "Pasta di mandorle", "Pasta senza glutine", "Avena senza glutine"],
  },
  latte: {
    forms: ["Formaggio", "Formaggi grattugiati", "Caffellatte", "MOZZARELLA", "Ricotta", "Besciamella", "Siero di latte", "Caseinato di sodio", "Lattosio", "Mozzarelline di bufala", "Grana Padano", "Pecorìno"],
    step: "Mantecate con una noce di burro e il parmigiano.",
    linked: ["Crema", "Philadelphia light"],
    notThis: ["Burro di cacao", "Latte di mandorla", "Latte di cocco", "Lattuga"],
  },
  uova: {
    forms: ["Uovo", "Uova", "Tuorli", "ALBUME", "Maionese", "Pasta all'uovo", "Frittata", "Meringhe", "Uòva sode"],
    step: "Sbattete le uova con lo zucchero.",
    linked: ["Salsa bianca", "Maionese light"],
    notThis: ["Uova di lompo", "Melanzana (eggplant)", "Uva"],
  },
  pesce: {
    forms: ["Acciuga", "Acciughe", "Baccalà", "SALMONE", "Colatura di alici", "Pesce spada", "Surimi", "Uova di lompo", "Worcestershire", "Merluzzi"],
    step: "Aggiungete il tonno sgocciolato.",
    linked: ["Filetti", "Filetti di merluzzo"],
    notThis: ["Pesca", "Pesche sciroppate", "Tonnarelli", "Cuocete finché la crosta è dorata"],
  },
  crostacei: {
    forms: ["Gambero", "Gamberi", "Gamberetti", "SCAMPI", "Mazzancolle", "Polpa di granchio", "Bisque", "Aragòsta", "Granchi"],
    step: "Sgusciate i gamberoni e teneteli da parte.",
    linked: ["Code", "Code di gambero surgelate"],
    notThis: ["Granturco", "Grana padano", "Cicoria"],
  },
  molluschi: {
    forms: ["Cozza", "Cozze", "Vongole veraci", "CALAMARI", "Polipo", "Moscardini", "Nero di seppia", "Capesante", "Ostriche", "Seppie"],
    step: "Fate aprire le vongole in padella.",
    linked: ["Misto", "Cozze sgusciate"],
    // «chiocciole» (anche formato di pasta) è lumache per la seconda revisione: prudenza
    notThis: ["Polpa di pomodoro", "Polpette di zucchine", "Polenta"],
  },
  arachidi: {
    forms: ["Arachide", "Arachidi", "ARACHIDI", "Burro di arachidi", "Olio di arachidi", "Noccioline", "Satay di pollo", "Aràchidi tostate"],
    step: "Guarnite con arachidi tritate.",
    linked: ["Crema", "Crema di arachidi"],
    notThis: ["Nocciole", "Burro", "Ceci"],
  },
  "frutta a guscio": {
    forms: ["Mandorla", "Mandorle", "Nocciole", "NOCI", "Pistacchio", "Anacardi", "Noci pecan", "Marzapane", "Pesto alla genovese", "Gianduia", "Pralinato", "Latte di mandorla"],
    step: "Spolverizzate con granella di pistacchi.",
    linked: ["Farina", "Farina di mandorle"],
    notThis: ["Noce moscata", "Noce di cocco", "Una noce di burro", "Cocco rapè"],
  },
  soia: {
    forms: ["Soia", "Salsa di soia", "Tofu", "TEMPEH", "Edamame", "Miso", "Lecitina di soia", "Tamari", "Soja", "Proteine di soia"],
    step: "Bagnate con un filo di salsa di soia.",
    linked: ["Bevanda", "Bevanda di soia"],
    notThis: ["Sale", "Sogliola", "Tamarindo"],
  },
  sedano: {
    forms: ["Sedano", "Sedani", "Coste di sedano", "SEDANO RAPA", "Semi di sedano", "Sale al sedano", "Soffritto", "Minestrone", "Sèdano"],
    step: "Tritate carota, sedano e cipolla.",
    linked: ["Verdure", "Sedano bianco"],
    notThis: ["Seitan", "Senape", "Finocchio"],
  },
  senape: {
    forms: ["Senape", "Semi di senape", "SENAPE DI DIJON", "Mostarda", "Mostarda di Cremona", "Salsa tartara", "Dijon", "Sènape", "Senapi"],
    step: "Spennellate il filetto con la senape.",
    linked: ["Salsa", "Senape in grani"],
    notThis: ["Mosto", "Sedano", "Rape"],
  },
  sesamo: {
    forms: ["Sesamo", "Semi di sesamo", "SESAMO", "Tahina", "Tahini", "Hummus", "Gomasio", "Olio di sesamo", "Halva", "Sèsamo nero"],
    step: "Cospargete di sesamo tostato.",
    linked: ["Crema", "Tahina biologica"],
    notThis: ["Semi di girasole", "Seitan", "Ceci"],
  },
  lupini: {
    forms: ["Lupino", "Lupini", "LUPINI", "Farina di lupini", "Lupini salati", "Lupin flour", "Lùpini", "Proteine di lupino"],
    step: "Sgusciate i lupini e sciacquateli.",
    linked: ["Farina", "Farina di lupini dolci"],
    notThis: ["Luppolo", "Lumache", "Lenticchie"],
  },
  solfiti: {
    forms: ["Vino", "Vini", "Vino bianco", "ACETO", "Aceto balsamico", "Uvetta", "Marsala", "Albicocche secche", "Metabisolfito di potassio", "Anidride solforosa", "Sherry"],
    step: "Sfumate con il vino bianco.",
    linked: ["Uva", "Uva passa"],
    notThis: ["Uva fresca", "Vaniglia", "Vinaccioli"],
  },
};

describe("i 14 allergeni dell'allegato II", () => {
  it("le tabelle coprono tutti e 14", () => {
    expect([...ALLERGEN_KEYS].sort()).toEqual(Object.keys(CASES).sort());
    expect(ALLERGEN_KEYS).toHaveLength(14);
  });

  for (const key of ALLERGEN_KEYS) {
    const c = CASES[key];
    describe(key, () => {
      it("riconosce almeno 8 forme: singolare, plurale, accenti, maiuscole, derivati, composti", () => {
        expect(c.forms.length).toBeGreaterThanOrEqual(8);
        for (const form of c.forms) expect([form, verdictOf(form, key)]).toEqual([form, "contains"]);
      });

      it("dentro una frase di un passo della ricetta", () => {
        expect(assessText(c.step, [key]).map((f) => f.allergen)).toEqual([key]);
      });

      it("dal nome dell'alimento di dispensa collegato", () => {
        const [ingredient, pantryName] = c.linked;
        const f = assessItem({ name: ingredient, linkedNames: [pantryName] }, [key]).findings[0];
        expect(f).toMatchObject({ verdict: "contains", origin: "linked", text: pantryName });
      });

      it("non dà falsi positivi evitabili su parole simili", () => {
        expect(c.notThis.length).toBeGreaterThanOrEqual(3);
        for (const w of c.notThis) {
          expect([w, verdictOf(w, key)]).not.toEqual([w, "contains"]);
          expect([w, assessText(w, [key])]).toEqual([w, []]);
        }
      });
    });
  }
});

describe("casi ambigui, decisi con prudenza", () => {
  it.each<[string, string, Verdict]>([
    // latte di mandorla: è frutta a guscio, non latte (nome tradizionale ammesso dalla normativa); come bevanda
    // confezionata non è un alimento semplice (terza revisione): incerto per il latte, mai `contains`
    ["Latte di mandorla", "frutta a guscio", "contains"],
    ["Latte di mandorla", "latte", "uncertain"],
    ["Latte d'avena", "glutine", "contains"],
    ["Latte vegetale", "latte", "uncertain"],
    ["Latte vegetale", "soia", "uncertain"],
    ["Latte senza lattosio", "latte", "contains"],
    ["Panna vegetale", "latte", "contains"],
    ["Noce moscata", "frutta a guscio", "clear"],
    // non è burro; ma è un prodotto lavorato, spesso negli stessi impianti del cioccolato al latte
    ["Burro di cacao", "latte", "uncertain"],
    ["Burro e cacao", "latte", "contains"],
    ["Uova di lompo", "pesce", "contains"],
    // non sono uova di gallina; ma sono una conserva (terza revisione)
    ["Uova di lompo", "uova", "uncertain"],
    ["Grano saraceno", "glutine", "uncertain"],
    ["Farina di riso", "glutine", "uncertain"],
    ["Farina di grano saraceno", "glutine", "uncertain"],
    // seconda revisione: la dichiarazione «senza glutine» si verifica in etichetta, al più incerto; mai per i cereali
    // che il glutine lo contengono per natura
    ["Pasta senza glutine", "glutine", "uncertain"],
    ["Biscotti senza glutine", "glutine", "uncertain"],
    ["Seitan senza glutine", "glutine", "contains"],
    ["Farro senza glutine", "glutine", "contains"],
    ["Orzo senza glutine", "glutine", "contains"],
    ["Pane gluten free", "glutine", "uncertain"],
    ["Pane e biscotti senza glutine", "glutine", "contains"],
    ["Cioccolato fondente", "latte", "uncertain"],
    ["Pinoli", "frutta a guscio", "contains"],
    ["Riso senza latte", "latte", "contains"],
  ])("«%s» con %s: %s", (name, allergen, verdict) => {
    expect(verdictOf(name, allergen)).toBe(verdict);
  });
});

describe("tre esiti: l'ingrediente generico è incerto, mai compatibile", () => {
  it.each(["Crema", "Salsa", "Ripieno", "Dado", "Preparato per torte", "Impanatura", "Spezie miste", "Brodo granulare", "Sugo pronto"])(
    "«%s» non è mai `clear` per chi ha allergeni",
    (name) => {
      for (const key of ALLERGEN_KEYS) expect([name, key, verdictOf(name, key)]).not.toEqual([name, key, "clear"]);
      expect(verdictOf(name, "kiwi")).not.toBe("clear");
    },
  );

  it("un ingrediente specificato non è generico: «salsa di pomodoro», «crema di latte»", () => {
    // la salsa di pomodoro non è una salsa qualunque, ma è una conserva: incerta, non `contains` (terza revisione)
    expect(verdictOf("Salsa di pomodoro", "uova")).toBe("uncertain");
    expect(assessItem({ name: "Salsa di pomodoro" }, ["uova"]).findings[0]?.reason).not.toBe("table");
    expect(verdictOf("Crema di latte", "uova")).toBe("clear");
    expect(verdictOf("Crema di latte", "latte")).toBe("contains");
  });

  it("generico ma collegato a un alimento che lo contiene: `contains`, dal collegamento", () => {
    const f = assessItem({ name: "Crema", linkedNames: ["Crema di arachidi"] }, ["arachidi", "latte"]).findings;
    expect(f.find((x) => x.allergen === "arachidi")).toMatchObject({ verdict: "contains", origin: "linked" });
    expect(f.find((x) => x.allergen === "latte")?.verdict).toBe("uncertain");
  });

  it("passi e titolo dicono solo `contains`: «servite con la salsa» non rende incerta la ricetta", () => {
    expect(assessText("Servite con la salsa.", ["latte"])).toEqual([]);
    const r = assessRecipe({ title: "Crema di zucca", ingredients: [{ name: "Zucca" }, { name: "Patate" }], steps: ["Frullate tutto."] }, { allergens: ["latte"] });
    expect(r.verdict).toBe("clear");
  });

  it("una ricetta: il trovato vince sull'incerto, e l'incerto resta tale", () => {
    const r = assessRecipe({ ingredients: [{ name: "Dado" }, { name: "Burro" }] }, { allergens: ["latte", "sedano"] });
    expect(r.allergens).toEqual([
      expect.objectContaining({ allergen: "latte", verdict: "contains" }),
      expect.objectContaining({ allergen: "sedano", verdict: "uncertain" }),
    ]);
    expect(r.verdict).toBe("contains");
  });
});

describe("prodotto ed etichetta", () => {
  it("il nome del prodotto conta come quello dell'ingrediente", () => {
    expect(verdictOf({ name: "Biscotti secchi", productName: "Frollini al burro" }, "latte")).toBe("contains");
  });

  it("gli allergeni dichiarati in etichetta, anche come codici di Open Food Facts", () => {
    const f = assessItem({ name: "Snack", labelAllergens: ["en:milk", "en:sesame-seeds"] }, ["latte", "sesamo", "uova"]).findings;
    expect(f.map((x) => [x.allergen, x.verdict, x.origin])).toEqual([
      ["latte", "contains", "label"],
      ["sesamo", "contains", "label"],
      // regola invertita: «Snack» non è un alimento semplice riconosciuto, l'uovo non si può escludere
      ["uova", "uncertain", "name"],
    ]);
    expect(f[2]?.reason).toBe("unrecognized");
  });

  it("un'etichetta senza l'allergene non rende sicuro un nome che lo contiene", () => {
    expect(verdictOf({ name: "Pane al latte", labelAllergens: ["en:gluten"] }, "latte")).toBe("contains");
  });
});

describe("allergeni dichiarati: alias letti in modo tollerante", () => {
  it.each<[string, AllergenKey]>([
    ["Uovo", "uova"],
    ["UOVA", "uova"],
    ["Arachide", "arachidi"],
    ["crostaceo", "crostacei"],
    ["Mollusco", "molluschi"],
    ["Solfito", "solfiti"],
    ["anidride solforosa", "solfiti"],
    ["Lupino", "lupini"],
    ["Lattosio", "latte"],
    ["latticini", "latte"],
    ["Celiachia", "glutine"],
    ["en:milk", "latte"],
    ["en:sulphur-dioxide-and-sulphites", "solfiti"],
    ["Frutta a guscio", "frutta a guscio"],
    ["frutta secca", "frutta a guscio"],
    ["noce", "frutta a guscio"],
    ["Allergia al sedano", "sedano"],
    ["  Sésamo ", "sesamo"],
  ])("«%s» → %s", (value, key) => {
    expect(canonicalAllergens(value)).toContain(key);
  });

  it("«frutti di mare» vale per crostacei e molluschi", () => {
    expect(canonicalAllergens("frutti di mare")).toEqual(["crostacei", "molluschi"]);
  });

  it("un valore sconosciuto non diventa un allergene a caso, e si cerca come parola", () => {
    expect(canonicalAllergen("kiwi")).toBeUndefined();
    expect(verdictOf("Kiwi gold", "kiwi")).toBe("contains");
    expect(verdictOf("Kiwis", "Kiwi")).toBe("contains");
    expect(verdictOf("Mela", "kiwi")).toBe("clear");
  });
});

describe("esclusioni libere e iponimi", () => {
  it.each<[string, string]>([
    ["maiale", "Salsiccia fresca"],
    ["maiale", "Prosciutto crudo"],
    ["Carne di maiale", "Guanciale"],
    ["funghi", "Porcini secchi"],
    ["funghi", "Champignon"],
    ["fungo", "Funghi trifolati"],
    ["fegato", "Fegatini di pollo"],
    ["frattaglie", "Trippa alla romana"],
    ["alcol", "Vino rosso"],
    ["alcolici", "Rum"],
    ["carne", "Bresaola"],
    ["pesce", "Acciughe sott'olio"],
    ["latticini", "Mozzarella"],
    ["pinoli", "Pesto alla genovese"],
    ["coriandolo", "Coriandolo fresco"],
    ["Pomodori", "Pomodorini ciliegini"],
  ])("escludere «%s» toglie «%s»", (excluded, name) => {
    expect(matchExclusion(name, excluded)).toBeDefined();
  });

  it.each<[string, string]>([
    ["maiale", "Pollo"],
    ["funghi", "Zucchine"],
    ["fegato", "Fagioli"],
    ["alcol", "Aceto di mele"],
    ["mela verde", "Mela rossa"],
  ])("escludere «%s» lascia «%s»", (excluded, name) => {
    expect(matchExclusion(name, excluded)).toBeUndefined();
  });
});

describe("normalizzazione", () => {
  it("singolare e plurale hanno la stessa radice", () => {
    for (const [a, b] of [["fungo", "funghi"], ["pistacchio", "pistacchi"], ["acciuga", "acciughe"], ["uovo", "uova"], ["noce", "noci"], ["mollusco", "molluschi"], ["granchio", "granchi"]]) {
      expect(stemWord(a as string)).toBe(stemWord(b as string));
    }
  });
});

it("il testo onesto per le schermate dice che non sostituisce l'etichetta e non vede tracce né contaminazioni", () => {
  expect(ALLERGEN_CHECK_NOTICE).toMatch(/non sostituisce la lettura dell'etichetta/);
  expect(ALLERGEN_CHECK_NOTICE).toMatch(/tracce/);
  expect(ALLERGEN_CHECK_NOTICE).toMatch(/contaminazioni/);
});
