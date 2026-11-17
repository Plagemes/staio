// Iponimi delle esclusioni scritte a mano più comuni: chi esclude «maiale» esclude anche salsiccia e prosciutto.
// Stessa sintassi delle tabelle degli allergeni. Compilazione prudente e non esaustiva (vedi SOURCES.md).

export interface HyponymGroup {
  /** Come l'utente può scrivere l'esclusione. */
  names: readonly string[];
  /** Alimenti che ricadono nell'esclusione. */
  members: readonly string[];
}

const PORK = [
  "maiale", "suino", "porco", "pancetta", "guanciale", "lardo", "strutto", "prosciutto", "prosciutto crudo",
  "prosciutto cotto", "speck", "salame", "salsiccia", "salamella", "luganega", "mortadella", "coppa", "capocollo",
  "culatello", "lonza", "lonzino", "arista", "porchetta", "cotechino", "zampone", "wurstel", "nduja", "ciccioli",
  "cotenna", "costine", "stinco", "bacon", "chorizo", "finocchiona", "soppressata", "sopressa", "ventricina",
  "jamon", "pork", "ham",
];

const BEEF = [
  "manzo", "bovino", "vitello", "vitellone", "=bue", "bresaola", "carpaccio", "roast beef", "bistecca", "fiorentina",
  "costata", "ossobuco", "hamburger", "carne salada", "trippa", "beef", "veal",
];

const POULTRY = [
  "pollo", "gallina", "cappone", "tacchino", "anatra", "=oca", "=oche", "faraona", "quaglia", "piccione", "fagiano",
  "chicken", "turkey", "duck",
];

const LAMB = ["agnello", "abbacchio", "capretto", "montone", "=pecora", "castrato", "lamb", "mutton"];

const GAME = ["cinghiale", "cervo", "capriolo", "camoscio", "lepre", "selvaggina", "coniglio", "cavallo", "equino", "asino"];

const OFFAL = [
  "fegato", "fegatini", "fegatelli", "foie gras", "pate", "rognone", "rognoni", "trippa",
  "lampredotto", "animelle", "cervello", "=lingua", "milza", "polmone", "coratella", "rigaglie", "durelli", "ventrigli",
  "busecca", "pajata", "pagliata", "nervetti", "zampetto", "musetto", "frattaglie", "interiora",
];

const MEAT = [
  ...PORK, ...BEEF, ...POULTRY, ...LAMB, ...GAME, ...OFFAL, "carne", "macinato", "carne macinata", "ragu", "polpette",
  "polpettone", "spezzatino", "arrosto", "brasato", "bollito", "cotoletta", "scaloppine", "involtini", "salumi",
  "insaccati", "brodo di carne", "dado di carne", "estratto di carne", "gelatina animale", "meat",
];

const MUSHROOMS = [
  "funghi", "fungo", "porcini", "champignon", "prataioli", "finferli", "gallinacci", "chiodini", "pioppini", "shiitake",
  "cardoncelli", "ovoli", "spugnole", "morchelle", "enoki", "maitake", "pleurotus", "tartufo", "mushroom",
];

const ALCOHOL = [
  "alcol", "alcool", "alcolici", "vino*", "=vino", "=vini", "birra", "liquore", "=rum", "brandy", "cognac", "grappa",
  "vodka", "whisky", "whiskey", "=gin", "marsala", "=porto", "sherry", "vermut", "vermouth", "spumante", "prosecco",
  "champagne", "sidro", "=amaretto", "limoncello", "maraschino", "sake", "mirin", "vin santo", "vinsanto", "alchermes",
  "kirsch", "calvados", "cointreau", "grand marnier", "triple sec", "sambuca", "nocino", "distillato", "bourbon",
  "wine", "beer",
];

const CURED = [
  "salumi", "insaccati", "prosciutto", "salame", "speck", "mortadella", "bresaola", "coppa", "pancetta", "lardo",
  "culatello", "nduja", "wurstel", "cotechino", "salsiccia", "finocchiona", "soppressata",
];

export const HYPONYM_GROUPS: readonly HyponymGroup[] = [
  { names: ["carne", "carni", "carne rossa", "carni rosse", "meat"], members: MEAT },
  { names: ["maiale", "suino", "carne di maiale", "carne suina", "porco", "pork"], members: PORK },
  { names: ["manzo", "bovino", "carne bovina", "carne di manzo", "vitello", "beef"], members: BEEF },
  { names: ["pollo", "pollame", "carne bianca", "carni bianche", "volatili", "chicken"], members: POULTRY },
  { names: ["agnello", "ovino", "carne ovina", "lamb"], members: LAMB },
  { names: ["selvaggina", "cacciagione"], members: GAME },
  { names: ["frattaglie", "interiora", "quinto quarto", "offal"], members: OFFAL },
  { names: ["fegato", "fegatini"], members: ["fegato", "fegatini", "fegatelli", "foie gras", "pate", "coratella"] },
  { names: ["salumi", "insaccati", "affettati", "cold cuts"], members: CURED },
  { names: ["funghi", "fungo", "mushrooms"], members: MUSHROOMS },
  { names: ["alcol", "alcool", "alcolici", "bevande alcoliche", "alcohol"], members: ALCOHOL },
  { names: ["vino", "wine"], members: ["vino*", "=vino", "=vini", "marsala", "=porto", "sherry", "vermut", "vermouth", "spumante", "prosecco", "champagne", "vin santo", "vinsanto", "wine"] },
  {
    names: ["peperoncino", "piccante", "cibi piccanti", "chili"],
    members: ["peperoncino", "chili", "nduja", "harissa", "tabasco", "salsa piccante", "sriracha", "paprika piccante", "olio piccante", "arrabbiata", "jalapeno", "habanero"],
  },
  {
    names: ["pomodoro", "pomodori", "tomato"],
    members: ["pomodoro", "pomodorini", "passata", "pelati", "concentrato di pomodoro", "ketchup", "datterini", "ciliegini", "pachino", "san marzano", "gazpacho", "tomato"],
  },
  { names: ["cipolla", "cipolle", "onion"], members: ["cipolla", "cipollotto", "cipollina", "scalogno", "onion"] },
  { names: ["aglio", "garlic"], members: ["aglio", "aioli", "agliata", "garlic"] },
  { names: ["coriandolo", "cilantro"], members: ["coriandolo", "cilantro"] },
];
