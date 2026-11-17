// Materiali e forme della confezione: Open Food Facts li dà quasi sempre in inglese.

/** Termini più comuni, in inglese, verso l'italiano. Le chiavi sono minuscole e senza trattini. */
const TERMS: Readonly<Record<string, string>> = {
  cardboard: "cartone",
  carton: "cartone",
  paperboard: "cartoncino",
  paper: "carta",
  plastic: "plastica",
  pet: "plastica",
  pp: "plastica",
  hdpe: "plastica",
  pe: "plastica",
  glass: "vetro",
  metal: "metallo",
  aluminium: "alluminio",
  aluminum: "alluminio",
  steel: "acciaio",
  tin: "latta",
  can: "lattina",
  bottle: "bottiglia",
  jar: "barattolo",
  box: "scatola",
  bag: "sacchetto",
  tray: "vaschetta",
  tub: "vaschetta",
  film: "pellicola",
  foil: "lamina",
  lid: "coperchio",
  cap: "tappo",
  pot: "vasetto",
  cup: "bicchiere",
  tube: "tubetto",
  sachet: "bustina",
  pouch: "bustina",
  wrapper: "involucro",
  wrapping: "involucro",
  net: "rete",
  wood: "legno",
  cork: "sughero",
  "tetra pak": "brick",
  tetrapak: "brick",
  "tetra brik": "brick",
  brick: "brick",
  "plastic film": "pellicola di plastica",
  "tin can": "latta",
  "aluminium foil": "lamina di alluminio",
};

/** Parole già italiane che si possono mostrare così come arrivano. */
const ITALIAN = new Set([
  ...Object.values(TERMS),
  "astuccio",
  "scatola",
  "sacchetto",
  "vaschetta",
  "bottiglia",
  "barattolo",
  "lattina",
  "latta",
  "tappo",
  "coperchio",
  "carta",
  "cartone",
  "cartoncino",
  "plastica",
  "vetro",
  "metallo",
  "alluminio",
  "acciaio",
  "pellicola",
  "vasetto",
  "involucro",
  "bustina",
  "tubetto",
  "flacone",
  "sacco",
  "rete",
  "legno",
  "sughero",
]);

const clean = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/^[a-z]{2}:/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function translateTerm(term: string): string[] {
  const whole = TERMS[term];
  if (whole) return [whole];
  if (ITALIAN.has(term)) return [term];
  // un'espressione fatta di parole note: ognuna per conto suo
  return term
    .split(" ")
    .map((w) => TERMS[w] ?? (ITALIAN.has(w) ? w : undefined))
    .filter((w): w is string => w !== undefined);
}

/**
 * Confezione in italiano: traduce ciò che è in tabella, tiene ciò che è già italiano, scarta il resto, senza doppioni.
 * Restituisce un elenco vuoto se non resta niente: allora la riga non si mostra.
 */
export function translatePackaging(terms: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of terms ?? []) {
    for (const word of translateTerm(clean(raw))) if (!out.includes(word)) out.push(word);
  }
  return out;
}
