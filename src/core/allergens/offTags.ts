// Come i tag di Open Food Facts (scritti da volontari, in più lingue) indicano i gruppi di allergeni dell'app.
// Il motore riconosce i nomi italiani e molti inglesi; qui si aggiungono i singoli cereali e le singole noci, e i nomi
// francesi, tedeschi e spagnoli più comuni. Le parole sono già senza accenti e in minuscolo; il plurale in «s» si prova da sé.
import { allergensInText, canonicalAllergens } from "./engine";
import { STOPWORDS, foldText, stemWord } from "./normalize";
import { ALLERGEN_TABLES, type AllergenKey } from "./tables";

const GROUPS: Readonly<Record<AllergenKey, readonly string[]>> = {
  glutine: [
    "gluten", "weizen", "getreide", "ble", "trigo", "cereales", "cereales con gluten", "cereals containing gluten", "cereali",
    "barley", "oats", "oat", "rye", "spelt", "kamut", "khorasan", "triticale", "dinkel", "gerste", "hafer", "roggen", "orge",
    "avoine", "seigle", "epeautre", "cebada", "avena", "centeno", "espelta", "wheat",
  ],
  latte: ["milk", "lait", "milch", "leche", "lactose", "laktose", "lactosa", "dairy", "lacteos", "fromage", "kase", "queso", "sahne", "nata"],
  uova: ["egg", "oeuf", "ei", "eier", "huevo"],
  pesce: ["fish", "poisson", "fisch", "pescado"],
  crostacei: ["crustaceans", "crustaces", "crustace", "krebstiere", "krebstier", "crustaceos", "crustaceo", "shrimp", "prawn", "crab", "lobster"],
  molluschi: ["molluscs", "mollusks", "mollusques", "mollusque", "weichtiere", "weichtier", "moluscos", "molusco"],
  arachidi: ["peanut", "arachides", "arachide", "erdnuss", "erdnusse", "cacahuetes", "cacahuete"],
  "frutta a guscio": [
    "nuts", "nut", "tree nuts", "fruits a coque", "fruit a coque", "schalenfruchte", "frutos de cascara", "frutos secos",
    "almond", "amandes", "amande", "mandeln", "mandel", "almendras", "almendra", "hazelnut", "noisettes", "noisette", "haselnusse",
    "haselnuss", "avellanas", "avellana", "walnut", "noix", "walnuss", "walnusse", "nueces", "nuez", "pistachio", "pistaches",
    "pistache", "pistazien", "pistachos", "cashew", "cashew nuts", "cajou", "noix de cajou", "cashewnusse", "anacardos", "pecan",
    "macadamia", "brazil nuts", "brazil nut", "noix du bresil", "paranusse", "pistachio nuts",
  ],
  soia: ["soy", "soya", "soja", "sojabohnen", "soybean", "soybeans"],
  sedano: ["celery", "celeri", "sellerie", "apio"],
  senape: ["mustard", "moutarde", "senf", "mostaza"],
  sesamo: ["sesame", "sesam", "sesame seeds", "sesamsamen", "ajonjoli"],
  lupini: ["lupin", "lupine", "lupines", "altramuces", "altramuz"],
  solfiti: [
    "sulfites", "sulfite", "sulphites", "sulphite", "sulfitos", "sulfito", "anhydride sulfureux", "schwefeldioxid",
    "dioxido de azufre", "sulphur dioxide", "sulfur dioxide", "dioxyde de soufre", "sulphur dioxide and sulphites",
  ],
};

/** Nomi collettivi di un gruppo intero («frutta secca», «cereali», «shellfish»): non una singola voce del gruppo. */
const COLLECTIVE: Readonly<Partial<Record<AllergenKey, readonly string[]>>> = {
  glutine: ["cereali", "cereali contenenti glutine", "cereali con glutine", "cereals", "cereals containing gluten", "cereales", "getreide"],
  latte: ["latticini", "formaggi", "formaggio", "latte e derivati", "dairy", "dairy products", "milk products", "produits laitiers", "milchprodukte", "lacteos"],
  uova: ["uova e derivati", "ovoprodotti", "egg products"],
  pesce: ["pesce", "pesci", "pesce e derivati", "fish", "poisson", "poissons", "fisch", "pescado"],
  crostacei: ["crostacei", "crostaceo", "crustaceans", "shellfish", "crustaces", "krebstiere", "crustaceos", "frutti di mare", "seafood"],
  molluschi: ["molluschi", "mollusco", "molluscs", "mollusks", "mollusques", "weichtiere", "moluscos", "frutti di mare", "seafood"],
  "frutta a guscio": [
    "frutta a guscio", "frutta secca", "frutta secca a guscio", "noci", "noci miste", "mix di noci", "mix di frutta secca", "nuts", "tree nuts", "fruits a coque", "schalenfruchte", "frutos secos",
    "frutos de cascara",
  ],
};

/** Cose che somigliano a una noce o a un latte ma non lo sono («nuez moscada», «noix de coco»): si tolgono prima di leggere. */
const LOOKALIKES = [
  "nuez moscada", "noce moscata", "noix de muscade", "muscade", "muskatnuss", "nutmeg", "noix de coco", "nuez de coco",
  "kokosnuss", "coconut", "noce di cocco", "cocco", "coco",
];

/** Parole che dicono «senza»: un tag «milk free» non è un allergene presente. */
const NEGATIONS: ReadonlySet<string> = new Set(["free", "sans", "senza", "sin", "ohne", "frei", "no", "non", "without"]);
const EXTRA_STOPWORDS: ReadonlySet<string> = new Set(["des", "du", "le", "les", "und", "et", "y", "en", "el", "de"]);

const SYNONYMS: readonly (readonly [string, AllergenKey])[] = [
  ...(Object.entries(GROUPS) as [AllergenKey, readonly string[]][]).flatMap(([key, phrases]) => [key, ...phrases].map((p) => [foldText(p), key] as const)),
  ...(Object.entries(COLLECTIVE) as [AllergenKey, readonly string[]][]).flatMap(([key, phrases]) => phrases.map((p) => [foldText(p), key] as const)),
  ...ALLERGEN_TABLES.flatMap((t) => [t.key, ...t.aliases].map((a) => [foldText(a), t.key] as const)),
].filter(([phrase]) => phrase !== "");

const pad = (folded: string): string => ` ${folded} `;
const has = (padded: string, phrase: string): boolean => padded.includes(` ${phrase} `) || padded.includes(` ${phrase}s `);

export interface TagAnalysis {
  /** I gruppi nominati (nomi, singole voci e sinonimi): chi li nomina lo dice in modo esplicito. */
  named: AllergenKey[];
  /** I gruppi nominati più quelli di cui il motore riconosce una voce nel testo. */
  groups: AllergenKey[];
  /** Il tag ha parole che nessun sinonimo spiega (o un sosia, o una negazione): non si può dire che parli solo dei gruppi trovati. */
  residue: boolean;
  /** Dice «senza»: non indica la presenza. */
  negated: boolean;
}

/** Legge un tag o un breve testo: quali gruppi nomina e se resta qualcosa che non si capisce. */
export function analyzeTag(text: string, ignore?: ReadonlySet<string>): TagAnalysis {
  let folded = pad(foldText(text));
  let masked = false;
  for (const l of LOOKALIKES) {
    if (folded.includes(` ${l} `)) {
      folded = folded.split(` ${l} `).join(" ");
      masked = true;
    }
  }
  const trimmed = foldText(folded);
  if (trimmed === "") return { named: [], groups: [], residue: masked, negated: false };
  const padded = pad(trimmed);
  const named = new Set<AllergenKey>(canonicalAllergens(trimmed));
  let rest = padded;
  for (const [phrase, key] of SYNONYMS) {
    if (!has(padded, phrase)) continue;
    named.add(key);
    rest = rest.split(` ${phrase}s `).join(" ").split(` ${phrase} `).join(" ");
  }
  const groups = new Set<AllergenKey>([...named, ...allergensInText(trimmed)]);
  const words = foldText(rest).split(" ").filter((w) => w !== "");
  const unexplained = words.some(
    (w) => !STOPWORDS.has(w) && !EXTRA_STOPWORDS.has(w) && !ignore?.has(w) && !/\d/.test(w) && !NEGATIONS.has(w) && canonicalAllergens(w).length === 0 && allergensInText(w).length === 0,
  );
  return {
    named: [...named],
    groups: [...groups],
    residue: masked || unexplained,
    negated: trimmed.split(" ").some((w) => NEGATIONS.has(w)),
  };
}

/** I gruppi che un tag o un nome indica. Vuoto se non lo riconosce. */
export function groupsOfTag(text: string): AllergenKey[] {
  return analyzeTag(text).groups;
}

/** I nomi collettivi di gruppo («frutta secca», «cereali») scritti in un testo: ogni frammento tra virgole e parentesi. */
export function collectiveGroups(text: string): { key: AllergenKey; phrase: string }[] {
  const out: { key: AllergenKey; phrase: string }[] = [];
  for (const piece of text.split(/[.,;:()[\]\n\r]+/)) {
    const padded = pad(foldText(piece.replace(/[\d%]+/g, " ")));
    for (const [key, phrases] of Object.entries(COLLECTIVE) as [AllergenKey, readonly string[]][]) {
      const phrase = phrases.find((p) => has(padded, p));
      if (phrase !== undefined) out.push({ key, phrase });
    }
  }
  return out;
}

/** Le parole che il tag e il dichiarato hanno in comune (a meno di singolare e plurale): indicano la stessa cosa. */
export function sharesWord(a: string, b: string): boolean {
  const stems = (s: string) => foldText(s).split(" ").filter((w) => w.length >= 4).map(stemWord);
  const sb = new Set(stems(b));
  return stems(a).some((s) => sb.has(s));
}
