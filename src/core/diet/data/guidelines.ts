// Indicazioni delle linee guida per ogni riga di confronto, e porzioni standard.
// Nessun numero è scritto a memoria: ogni valore viene da FONTI-LINEE-GUIDA (riletta nei documenti originali)
// e rimanda al punto della fonte nel campo `where`. Le letture di celle unite sono marcate `interpretation`.
// Convenzioni, dettagli e scelte dell'app: `../FONTI.md`.
//
// Come leggere `byLevel` e `textRange`:
// - `perDay` / `perWeek`: la Tab. 9.1 dà la frequenza suggerita per livello energetico. Si scrive come `min`;
//   un tetto (`max`) c'è solo dove la fonte lo scrive.
// - `maxPerDay` / `maxPerWeek`: la fonte dà un massimo (`max`), oppure un asterisco di «frequenza eventualmente
//   inferiore», letto come massimo (interpretazione).
// - `occasional` / `notAdvised`: nessun numero.
// - Righe di misura: valori uguali per ogni livello; la percentuale dell'energia è scritta in punti percentuali
//   (10 = 10%), la quota è una frazione 0..1.

import {
  ENERGY_LEVELS,
  type EnergyLevel,
  type GuidelineRow,
  type GuidelineRowId,
  type PortionStandard,
  type PortionTable,
  type TargetView,
} from "../types";

/** Scelta dell'app: la fonte presenta 1500, 2000 e 2500 kcal come «esempi ipotetici», non come livelli da assegnare. */
export const DEFAULT_LEVEL: EnergyLevel = 2000;

type Bound = { min?: number; max?: number } | null;
type ByLevel = NonNullable<GuidelineRow["byLevel"]>;

function atLeast(a: number | null, b: number | null, c: number | null): ByLevel {
  const f = (v: number | null): Bound => (v === null ? null : { min: v });
  return { 1500: f(a), 2000: f(b), 2500: f(c) };
}

function atMost(a: number | null, b: number | null, c: number | null): ByLevel {
  const f = (v: number | null): Bound => (v === null ? null : { max: v });
  return { 1500: f(a), 2000: f(b), 2500: f(c) };
}

function sameAtEveryLevel(bound: { min?: number; max?: number }): ByLevel {
  return { 1500: { ...bound }, 2000: { ...bound }, 2500: { ...bound } };
}

const CREA = "crea-lg-2018" as const;
const TAB91_CEREALS = "Tab. 9.1, p. 130";
const TAB91_VEG_FISH = "Tab. 9.1, p. 131";
const TAB91_LEGUMES_DAIRY = "Tab. 9.1, p. 132";

export const GUIDELINE_ROWS: readonly GuidelineRow[] = [
  // --- Verdura e frutta -----------------------------------------------------------------------------------------
  {
    id: "vegetables",
    groups: ["vegetables"],
    portionKeys: ["vegetables", "leafySalad"],
    kind: "perDay",
    byLevel: atLeast(2.5, 2.5, 3),
    quote: "Verdura fresca e insalate (cella unica): 2 ½ / 2 ½ / 3 porzioni al giorno",
    source: CREA,
    where: `${TAB91_VEG_FISH}, righe «Verdura fresca» e «Insalate»`,
    reading: "interpretation",
    note: "La cella è unica per verdura e insalate: le porzioni dei due sottogruppi si sommano (lettura dell'app).",
  },
  {
    id: "fruit",
    groups: ["fruit"],
    portionKeys: ["fruit", "driedFruit"],
    kind: "perDay",
    byLevel: atLeast(2, 3, 3),
    quote: "Frutta fresca: 2 / 3 / 3 porzioni al giorno",
    source: CREA,
    where: `${TAB91_VEG_FISH}, righe «Frutta fresca» e «Frutta essiccata»`,
    reading: "interpretation",
    note: "La frutta essiccata non zuccherata divide la cella con la fresca: è un'alternativa, non si aggiunge (lettura dell'app). Succhi e centrifughe non contano (cap. 2, p. 46).",
  },
  {
    id: "vegFruitTotal",
    groups: [],
    kind: "gramsPerDayMin",
    byLevel: sameAtEveryLevel({ min: 400 }),
    quote: "raccomandazione minima di 400g/die",
    source: CREA,
    where: "cap. 2, p. 48; stesso valore in OMS, fact sheet «Healthy diet»",
    reading: "read",
    note: "Frutta e verdura insieme, in grammi al giorno. Anche l'OMS scrive almeno 400 g per chi ha più di 10 anni.",
  },
  // --- Cereali e tuberi -----------------------------------------------------------------------------------------
  {
    id: "bread",
    groups: ["refinedGrains", "wholeGrains"],
    portionKeys: ["bread"],
    kind: "perDay",
    byLevel: atLeast(2.5, 3.5, 4.5),
    quote: "Pane: 2 ½ / 3 ½ / 4 ½ porzioni al giorno",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Pane»`,
    reading: "read",
  },
  {
    id: "grains",
    groups: ["refinedGrains", "wholeGrains"],
    portionKeys: ["grains", "freshEggPasta"],
    kind: "perDay",
    byLevel: atLeast(1, 1.5, 1.5),
    quote: "Pasta, riso, mais, farro, orzo ecc.: 1 / 1 ½ / 1 ½ porzioni al giorno",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Pasta, riso, mais, farro, orzo ecc.»`,
    reading: "read",
  },
  {
    id: "breadSubstitutes",
    groups: ["refinedGrains", "wholeGrains"],
    portionKeys: ["breadSubstitutes"],
    kind: "maxPerWeek",
    byLevel: atMost(1, 1, 1),
    quote: "Sostituti del pane*: 1 / 1 / 1 a settimana",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Sostituti del pane»`,
    reading: "interpretation",
    note: "L'asterisco indica una possibile frequenza inferiore, sostituendo con altri alimenti dello stesso gruppo: letto come massimo (lettura dell'app).",
  },
  {
    id: "sweetBakery",
    groups: ["refinedGrains", "wholeGrains", "sweets"],
    portionKeys: ["sweetBakery"],
    kind: "maxPerWeek",
    byLevel: atMost(0.5, 2, 2),
    quote: "Prodotti da forno dolci*: ½ / 2 / 2 a settimana",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Prodotti da forno dolci»`,
    reading: "interpretation",
    note: "Asterisco letto come massimo (lettura dell'app). La riga ha due porzioni (50 g brioche e simili, 30 g biscotti): la tabella dell'app usa 50 g.",
  },
  {
    id: "breakfastCereals",
    groups: ["refinedGrains", "wholeGrains"],
    portionKeys: ["breakfastCereals"],
    kind: "maxPerWeek",
    byLevel: atMost(0.5, 2, 3),
    quote: "Cereali per la prima colazione*: ½ / 2 / 3 a settimana",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Cereali per la prima colazione»`,
    reading: "interpretation",
    note: "Asterisco letto come massimo (lettura dell'app).",
  },
  {
    id: "potatoes",
    groups: ["potatoes"],
    portionKeys: ["potatoes"],
    kind: "perWeek",
    byLevel: atLeast(1, 2, 2),
    quote: "Patate: 1 / 2 / 2 a settimana",
    source: CREA,
    where: `${TAB91_CEREALS}, riga «Patate» (nota 4)`,
    reading: "read",
    note: "La riga «Tuberi» ha gli stessi valori.",
  },
  {
    id: "wholeGrainShare",
    groups: [],
    kind: "shareMin",
    byLevel: sameAtEveryLevel({ min: 0.5 }),
    quote: "quotidianamente almeno metà delle porzioni di cereali consumati sia del tipo integrale",
    source: CREA,
    where: "cap. 3, p. 55",
    reading: "read",
    note: "Quota 0..1 sulle porzioni di cereali. Per riconoscere l'integrale il testo avverte che «con crusca» è un'aggiunta e che la farina integrale deve comparire fra gli ingredienti (p. 53).",
  },
  // --- Carne, pesce, uova, legumi -------------------------------------------------------------------------------
  {
    id: "legumes",
    groups: ["legumes"],
    portionKeys: ["legumes", "legumesDry", "soy"],
    kind: "perWeek",
    byLevel: atLeast(3, 3, 3),
    textRange: { min: 2, where: "cap. 3, p. 59" },
    quote: "è bene includere 2-4 porzioni a settimana di legumi, anche se nulla vieta un consumo maggiore",
    source: CREA,
    where: `${TAB91_LEGUMES_DAIRY}, riga «Legumi»`,
    reading: "interpretation",
    note: "Il testo (p. 59) dà 2-4 porzioni, la Tab. 9.1 dà 3 a ogni livello. Vince il testo; si tiene solo l'estremo basso perché il testo dice che un consumo maggiore non è vietato (lettura dell'app). I derivati della soia (tofu, tempeh) contano come legumi (nota 6).",
  },
  {
    id: "fish",
    groups: ["fish"],
    portionKeys: ["fish"],
    kind: "perWeek",
    byLevel: atLeast(2, 2, 3),
    quote: "Pesce e prodotti della pesca: 2 / 2 / 3 a settimana; testo: almeno 2-3 volte a settimana",
    source: CREA,
    where: `${TAB91_VEG_FISH}, riga «Pesce e prodotti della pesca»; cap. 5, p. 75`,
    reading: "read",
  },
  {
    id: "fishPreserved",
    groups: ["fish"],
    portionKeys: ["fishPreserved"],
    kind: "maxPerWeek",
    byLevel: atMost(0, 1, 1),
    quote: "Pesce conservato*: 0 / 1 / 1 a settimana",
    source: CREA,
    where: `${TAB91_VEG_FISH}, riga «Pesce conservato»`,
    reading: "interpretation",
    note: "Asterisco letto come massimo (lettura dell'app). Lo 0 a 1500 kcal è il valore scritto in tabella.",
  },
  {
    id: "whiteMeat",
    groups: ["whiteMeat"],
    portionKeys: ["whiteMeat"],
    kind: "perWeek",
    byLevel: atLeast(1, 2, 3),
    quote: "Carne bianca: 1 / 2 / 3 a settimana",
    source: CREA,
    where: `${TAB91_VEG_FISH}, riga «Carne bianca»`,
    reading: "read",
  },
  {
    id: "redMeat",
    groups: ["redMeat"],
    portionKeys: ["redMeat"],
    kind: "maxPerWeek",
    byLevel: atMost(1, 1, 1),
    quote: "Carne rossa*: 1 / 1 / 1 a settimana",
    source: CREA,
    where: `${TAB91_VEG_FISH}, riga «Carne rossa»; testo p. 127`,
    reading: "interpretation",
    note: "Asterisco letto come massimo (lettura dell'app). Il testo (p. 127) associa un consumo eccessivo a un maggior rischio per alcune malattie croniche. Le classificazioni IARC non entrano nei testi dell'app, solo in FONTI.md.",
  },
  {
    id: "processedMeat",
    groups: ["processedMeat"],
    portionKeys: ["processedMeat"],
    kind: "occasional",
    quote: "CONSUMO OCCASIONALE, se lo si desidera, limitarlo a piccole quantità, saltuariamente",
    source: CREA,
    where: "Tab. 9.3, p. 140, riga «Carni trasformate e conservate»",
    reading: "read",
    note: "Nessuna frequenza numerica nella fonte: l'eventuale soglia dell'app è una scelta dichiarata in FONTI.md.",
  },
  {
    id: "eggs",
    groups: ["eggs"],
    portionKeys: ["eggs"],
    kind: "perWeek",
    byLevel: atLeast(2, 3, 4),
    textRange: { min: 2, max: 4, where: "testo, p. 127" },
    quote: "un consumo appropriato [...] è di 2-4 uova a settimana",
    source: CREA,
    where: `${TAB91_LEGUMES_DAIRY}, riga «Uova»; testo pp. 87 e 127`,
    reading: "read",
    note: "Contano anche le uova contenute come ingrediente in pasta all'uovo, biscotti e torte (p. 127). Il testo (p. 87) dice anche che non c'è ragione di porre limiti netti.",
  },
  // --- Latte e derivati, grassi, frutta a guscio ----------------------------------------------------------------
  {
    id: "milkYogurt",
    groups: ["milkYogurt"],
    portionKeys: ["milk", "yogurt"],
    kind: "perDay",
    byLevel: atLeast(3, 3, 3),
    quote: "Latte e yogurt (cella unica): 3 / 3 / 3 porzioni al giorno",
    source: CREA,
    where: `${TAB91_LEGUMES_DAIRY}, righe «Latte» e «Yogurt»`,
    reading: "interpretation",
    note: "Cella unica: 3 porzioni in totale tra latte e yogurt (lettura dell'app). Il cap. 5 (p. 75) scrive invece «una tazza di latte o yogurt» al giorno: l'app usa la Tab. 9.1 e la mostra solo come descrizione, senza consigli.",
  },
  {
    id: "cheese",
    groups: ["cheese"],
    portionKeys: ["cheeseFresh", "cheeseAged"],
    kind: "perWeek",
    byLevel: atLeast(3, 3, 3),
    quote: "Formaggi, due sottogruppi (cella unica): 3 / 3 / 3 a settimana",
    source: CREA,
    where: `${TAB91_LEGUMES_DAIRY}, righe «Formaggi fino al 25% di grassi» e «Formaggi con più del 25% di grassi»`,
    reading: "interpretation",
    note: "Cella unica per i due sottogruppi: 3 porzioni in totale (lettura dell'app, la fonte non lo scrive). I formaggi sono una fonte importante di sale e grassi (p. 127).",
  },
  {
    id: "oilsFats",
    groups: ["oilsFats"],
    portionKeys: ["oil", "butter"],
    kind: "perDay",
    byLevel: atLeast(2, 3, 4),
    quote: "Oli e grassi da condimento (cella unica): 2 / 3 / 4 porzioni al giorno",
    source: CREA,
    where: `${TAB91_LEGUMES_DAIRY}, riga «Oli e grassi da condimento»`,
    reading: "read",
    note: "Cella unica per olio, burro e altri grassi: le porzioni si sommano. Tra i grassi da condimento la fonte indica di preferire l'olio extravergine di oliva.",
  },
  {
    id: "nutsSeeds",
    groups: ["nutsSeeds"],
    portionKeys: ["nutsSeeds"],
    kind: "perWeek",
    byLevel: atLeast(1, 2, 2.5),
    quote: "Frutta secca a guscio e semi oleosi: 1 / 2 / 2 ½ a settimana",
    source: CREA,
    where: "Tab. 9.1, p. 133, riga «Frutta secca a guscio e semi oleosi»",
    reading: "read",
  },
  // --- Alimenti voluttuari (Tab. 9.3) ---------------------------------------------------------------------------
  {
    id: "cakesIceCream",
    groups: ["sweets"],
    portionKeys: ["cakes"],
    kind: "occasional",
    quote: "Torte, dolci al cucchiaio, gelati: OCCASIONALE",
    source: CREA,
    where: "Tab. 9.3, p. 139, riga «Torte, dolci al cucchiaio, gelati»",
    reading: "read",
    note: "Nessuna frequenza numerica nella fonte.",
  },
  {
    id: "snacksChocolate",
    groups: ["sweets", "saltySnacks"],
    portionKeys: ["snacks", "spreads"],
    kind: "occasional",
    quote: "Snack, patatine, barrette, cioccolato, creme spalmabili: OCCASIONALE",
    source: CREA,
    where: "Tab. 9.3, p. 139, riga «Snack, patatine, barrette, cioccolato, creme spalmabili»",
    reading: "read",
    note: "Nessuna frequenza numerica nella fonte. Il PDF mette sotto la stessa cella anche la frutta essiccata con zucchero, candita o sciroppata (30 g): lettura dell'app, è un dolce.",
  },
  {
    id: "sugaryDrinks",
    groups: ["sugaryDrinks"],
    portionKeys: ["sugaryDrinks"],
    kind: "occasional",
    quote: "Bevande zuccherate: succhi di frutta, tè freddo, bibite: OCCASIONALE",
    source: CREA,
    where: "Tab. 9.3, p. 139, riga «Bevande zuccherate»",
    reading: "read",
    note: "Nessun limite in ml a settimana nella fonte. Il testo (cap. 6, p. 91) invita a ridurre gli zuccheri liberi senza ridurre frutta e latte.",
  },
  {
    id: "sugar",
    groups: ["sugars"],
    portionKeys: ["sugar"],
    kind: "maxPerDay",
    byLevel: atMost(1, 1.5, 2),
    quote: "Zucchero: massimo 1 / 1 ½ / 2 al giorno",
    source: CREA,
    where: "Tab. 9.3, p. 140, riga «Zucchero»",
    reading: "read",
  },
  {
    id: "honeyJam",
    groups: ["sugars"],
    portionKeys: ["honeyJam"],
    kind: "maxPerWeek",
    byLevel: atMost(1, 2, 2),
    quote: "Miele, marmellata: massimo 1 / 2 / 2 alla settimana",
    source: CREA,
    where: "Tab. 9.3, p. 140, riga «Miele, marmellata»",
    reading: "read",
  },
  {
    id: "alcohol",
    groups: ["alcohol"],
    kind: "notAdvised",
    quote: "CONSUMO NON CONSIGLIATO. Se non si beve, meglio continuare a non farlo",
    source: CREA,
    where: "Tab. 9.3, p. 139, riga «Bevande alcoliche»; cap. 8",
    reading: "read",
    note: "L'app non dà consigli sull'alcol in questa versione.",
  },
  // --- Misure: sale, zuccheri liberi, fibre ---------------------------------------------------------------------
  {
    id: "salt",
    groups: [],
    kind: "gramsPerDayMax",
    byLevel: sameAtEveryLevel({ max: 5 }),
    quote: "Il consumo di sale per la popolazione adulta deve essere inferiore a 5g al giorno",
    source: CREA,
    where: "cap. 7, p. 101; stesso valore in OMS, fact sheet «Healthy diet»",
    reading: "read",
    note: "Per gli anziani il testo indica non oltre 4 g al giorno: non applicato (l'app non conosce l'età). Il valore non si applica a chi ha patologie particolari (p. 101).",
  },
  {
    id: "freeSugars",
    groups: [],
    kind: "percentEnergyMax",
    byLevel: sameAtEveryLevel({ max: 10 }),
    quote:
      "WHO recommends reducing the intake of free sugars to less than 10% of total energy intake (strong recommendation)",
    source: "who-sugars-2015",
    where: "Recommendations, pp. 4 e 16",
    reading: "read",
    note: "Raccomandazione forte. L'ulteriore riduzione sotto il 5% è condizionale (evidenza di qualità molto bassa) e non è usata come soglia. Il 15% degli zuccheri semplici totali citato dal CREA (cap. 6, p. 92) riguarda altre quantità e non è usato.",
  },
  {
    id: "fiber",
    groups: [],
    kind: "gramsPerDayMin",
    byLevel: sameAtEveryLevel({ min: 25 }),
    quote: "Assunzione adeguata per la fibra alimentare, adulti: 25 g al giorno",
    source: "efsa-drv",
    where: "DRV Finder, «Dietary Fibre», adulti (core/nutrition/data/reference.ts, voce fiberG)",
    reading: "read",
    note: "Valore ripreso dal modulo core/nutrition, non riletto in questo lavoro.",
  },
];

const ROW_BY_ID: ReadonlyMap<GuidelineRowId, GuidelineRow> = new Map(
  GUIDELINE_ROWS.map((row) => [row.id, row]),
);

export function guidelineRow(id: GuidelineRowId): GuidelineRow | undefined {
  return ROW_BY_ID.get(id);
}

// --- Porzioni standard (Tab. 9.1 e 9.3, riprese dal CREA dai LARN IV, che non sono stati verificati) ------------
// `basis`: la nota 1 (p. 133) dice che le porzioni sono riferite al crudo al netto degli scarti o, in alcuni casi,
// al prodotto pronto (latte e derivati, pane, alcuni dolciumi). Le righe «ready» fuori da quell'elenco sono
// lettura dell'app: peso sgocciolato, conservato o bevanda.

function portion(
  key: PortionStandard["key"],
  amount: number,
  unit: PortionStandard["unit"],
  basis: PortionStandard["basis"],
  where: string,
): PortionStandard {
  return { key, amount, unit, basis, source: CREA, where };
}

export const PORTIONS: PortionTable = Object.freeze({
  vegetables: portion("vegetables", 200, "g", "raw", "Tab. 9.1, p. 131, riga «Verdura fresca»"),
  leafySalad: portion("leafySalad", 80, "g", "raw", "Tab. 9.1, p. 131, riga «Insalate»"),
  fruit: portion("fruit", 150, "g", "raw", "Tab. 9.1, p. 131, riga «Frutta fresca»"),
  driedFruit: portion("driedFruit", 30, "g", "raw", "Tab. 9.1, p. 131, riga «Frutta essiccata»"),
  bread: portion("bread", 50, "g", "ready", "Tab. 9.1, p. 130, riga «Pane»"),
  grains: portion("grains", 80, "g", "raw", "Tab. 9.1, p. 130, riga «Pasta, riso, mais, farro, orzo ecc.»"),
  freshEggPasta: portion(
    "freshEggPasta",
    100,
    "g",
    "raw",
    "Tab. 9.1, p. 130, riga «Pasta, riso…», nota 2 (pasta fresca all'uovo)",
  ),
  breadSubstitutes: portion("breadSubstitutes", 30, "g", "ready", "Tab. 9.1, p. 130, riga «Sostituti del pane»"),
  sweetBakery: portion(
    "sweetBakery",
    50,
    "g",
    "ready",
    "Tab. 9.1, p. 130, riga «Prodotti da forno dolci» (50 g; i biscotti hanno 30 g, non rappresentati)",
  ),
  breakfastCereals: portion(
    "breakfastCereals",
    30,
    "g",
    "ready",
    "Tab. 9.1, p. 130, riga «Cereali per la prima colazione»",
  ),
  potatoes: portion("potatoes", 200, "g", "raw", "Tab. 9.1, p. 130, riga «Patate»"),
  legumes: portion(
    "legumes",
    150,
    "g",
    "ready",
    "Tab. 9.1, p. 132, riga «Legumi» (freschi, surgelati, ammollati, in scatola; peso sgocciolato)",
  ),
  legumesDry: portion("legumesDry", 50, "g", "raw", "Tab. 9.1, p. 132, riga «Legumi» (secchi)"),
  soy: portion("soy", 100, "g", "ready", "Tab. 9.1, p. 132, riga «Legumi», nota 6 (tofu, tempeh)"),
  fish: portion("fish", 150, "g", "raw", "Tab. 9.1, p. 131, riga «Pesce e prodotti della pesca»"),
  fishPreserved: portion(
    "fishPreserved",
    50,
    "g",
    "ready",
    "Tab. 9.1, p. 131, riga «Pesce conservato» (peso sgocciolato)",
  ),
  whiteMeat: portion("whiteMeat", 100, "g", "raw", "Tab. 9.1, p. 131, riga «Carne bianca»"),
  redMeat: portion("redMeat", 100, "g", "raw", "Tab. 9.1, p. 131, riga «Carne rossa»"),
  processedMeat: portion(
    "processedMeat",
    50,
    "g",
    "ready",
    "Tab. 9.3, p. 140, riga «Carni trasformate e conservate»",
  ),
  eggs: portion("eggs", 50, "g", "raw", "Tab. 9.1, p. 132, riga «Uova» (1 uovo medio)"),
  milk: portion("milk", 125, "ml", "ready", "Tab. 9.1, p. 132, riga «Latte»"),
  yogurt: portion("yogurt", 125, "g", "ready", "Tab. 9.1, p. 132, riga «Yogurt»"),
  cheeseFresh: portion(
    "cheeseFresh",
    100,
    "g",
    "ready",
    "Tab. 9.1, p. 132, riga «Formaggi fino al 25% di grassi»",
  ),
  cheeseAged: portion(
    "cheeseAged",
    50,
    "g",
    "ready",
    "Tab. 9.1, p. 132, riga «Formaggi con più del 25% di grassi»",
  ),
  oil: portion("oil", 10, "ml", "raw", "Tab. 9.1, p. 132, riga «Oli e grassi da condimento» (1 cucchiaio)"),
  butter: portion("butter", 10, "g", "raw", "Tab. 9.1, p. 132, riga «Oli e grassi da condimento» (burro, grassi)"),
  nutsSeeds: portion(
    "nutsSeeds",
    30,
    "g",
    "raw",
    "Tab. 9.1, p. 133, riga «Frutta secca a guscio e semi oleosi»",
  ),
  cakes: portion("cakes", 100, "g", "ready", "Tab. 9.3, p. 139, riga «Torte, dolci al cucchiaio, gelati»"),
  snacks: portion(
    "snacks",
    30,
    "g",
    "ready",
    "Tab. 9.3, p. 139, riga «Snack, patatine, barrette, cioccolato» (30 g)",
  ),
  spreads: portion(
    "spreads",
    15,
    "g",
    "ready",
    "Tab. 9.3, p. 139, stessa riga degli snack (creme spalmabili, 1 cucchiaino colmo)",
  ),
  sugaryDrinks: portion(
    "sugaryDrinks",
    200,
    "ml",
    "ready",
    "Tab. 9.3, p. 139, riga «Bevande zuccherate» (200 ml; la lattina è 330 ml)",
  ),
  sugar: portion("sugar", 5, "g", "ready", "Tab. 9.3, p. 140, riga «Zucchero» (1 cucchiaino raso)"),
  honeyJam: portion("honeyJam", 20, "g", "ready", "Tab. 9.3, p. 140, riga «Miele, marmellata»"),
});

/**
 * Indicazione risolta per un livello energetico: `textRange` se c'è, altrimenti `byLevel[level]`.
 * `undefined` per i tipi qualitativi (`occasional`, `notAdvised`) e quando la fonte non dà un numero a quel livello.
 */
export function targetFor(row: GuidelineRowId, level: EnergyLevel): TargetView | undefined {
  const r = ROW_BY_ID.get(row);
  if (!r || r.kind === "occasional" || r.kind === "notAdvised") return undefined;
  if (!ENERGY_LEVELS.includes(level)) return undefined;
  const range = r.textRange;
  if (range) {
    return {
      kind: r.kind,
      row: r.id,
      source: r.source,
      where: range.where,
      ...(range.min !== undefined ? { min: range.min } : {}),
      ...(range.max !== undefined ? { max: range.max } : {}),
    };
  }
  const bound = r.byLevel?.[level];
  if (!bound) return undefined;
  return {
    kind: r.kind,
    row: r.id,
    source: r.source,
    where: r.where,
    ...(bound.min !== undefined ? { min: bound.min } : {}),
    ...(bound.max !== undefined ? { max: bound.max } : {}),
  };
}
