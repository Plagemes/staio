// Sostituti di un ingrediente che manca, scelti tra ciò che c'è in casa. Logica pura: i dati di gusto (`@/core/taste`,
// solo in lettura) e il controllo degli allergeni arrivano come parametri.
//
// Perché una proposta esca servono DUE cose, e una sola non basta:
//  1. la stessa famiglia di cucina (tabella qui sotto: raffina i gruppi della tabella nutrizionale, che sono troppo larghi,
//     «latticini» tiene insieme latte e gorgonzola, «verdura» tiene insieme spinaci e cipolla);
//  2. la vicinanza nei dati di gusto, che da sola NON basta: i dati danno punteggi alti a molti alimenti molto diversi
//     (il pollo è «vicino» al manzo, alla pasta e ai broccoli), per questo decide soltanto dentro la famiglia.
// Meglio nessuna proposta che una sostituzione assurda.
import { resolveTasteFood, type TasteFood, type TasteIndex, type TasteSubject } from "../taste";
import type { Recipe, RecipeIngredient } from "./types";

/** Quante proposte al massimo per ingrediente. */
export const MAX_SUBSTITUTES = 2;

/**
 * Famiglie «larghe» (`loose`): servono dati di gusto vicini, cioè somiglianza (coseno) almeno 0,30 e valore d'ordine,
 * già corretto per l'effetto hub, non peggiore di -0,10. Con 0,30 restano burro→strutto (0,30) e mozzarella→provolone
 * (0,69); cadono kefir (0,25) e olio di colza (0,17) per il burro. Il valore d'ordine toglie gli alimenti che
 * somigliano a tutto per via dell'effetto hub.
 */
export const MIN_LOOSE_SCORE = 0.3;
export const MIN_LOOSE_RANK = -0.1;
/**
 * Famiglie «strette» (`tight`): alimenti che in cucina si scambiano per ruolo. I dati, quando ci sono, possono solo
 * ordinare, salvo una somiglianza davvero bassa (sotto 0,15) che toglie la proposta. Se i dati non li mettono tra i primi
 * venti vicini (spinaci e bietola non lo sono) la famiglia basta, ma la proposta resta dopo quelle con i dati.
 */
export const MIN_TIGHT_SCORE = 0.15;

export interface SubstituteFamily {
  id: string;
  /** Il ruolo in cucina, in italiano. */
  label: string;
  closeness: "tight" | "loose";
  /** Chiavi degli alimenti dell'elenco di gusto (`TasteFood.key`). */
  from: readonly string[];
  /** Se c'è, la sostituzione vale solo da `from` verso `to` (burro → olio sì, olio → burro no). Altrimenti è reciproca. */
  to?: readonly string[];
}

export const SUBSTITUTE_FAMILIES: readonly SubstituteFamily[] = [
  // grassi
  { id: "spalmabili", label: "burro e margarina", closeness: "tight", from: ["butter", "margarine"] },
  { id: "oli", label: "oli da cucina", closeness: "tight", from: ["olive_oil", "sunflower_oil", "corn_oil", "canola_oil"] },
  {
    id: "burro-in-olio",
    label: "grasso per cuocere",
    closeness: "tight",
    from: ["butter", "margarine"],
    to: ["olive_oil", "sunflower_oil", "corn_oil", "canola_oil"],
  },
  { id: "grassi-solidi", label: "grassi solidi", closeness: "loose", from: ["butter", "margarine", "lard", "coconut_oil"] },
  // latte, panna, yogurt, formaggi: mai latte contro formaggio
  { id: "latte", label: "latte e bevande vegetali", closeness: "tight", from: ["milk", "skim_milk", "soymilk", "rice_milk", "almond_milk"] },
  { id: "panna-yogurt", label: "panna e yogurt", closeness: "tight", from: ["heavy_cream", "sour_cream", "yogurt", "greek_yogurt"] },
  { id: "yogurt", label: "yogurt", closeness: "tight", from: ["yogurt", "greek_yogurt", "kefir"] },
  { id: "formaggi-freschi", label: "formaggi freschi", closeness: "tight", from: ["ricotta_cheese", "cottage_cheese", "cream_cheese"] },
  { id: "formaggi-duri", label: "formaggi da grattugiare", closeness: "tight", from: ["parmesan_cheese", "romano_cheese"] },
  {
    id: "formaggi-filanti",
    label: "formaggi da cuocere",
    closeness: "loose",
    from: ["mozzarella_cheese", "provolone_cheese", "fontina_cheese", "swiss_cheese", "cheddar_cheese", "gouda_cheese"],
  },
  { id: "formaggi-erborinati", label: "formaggi dal sapore deciso", closeness: "loose", from: ["gorgonzola", "brie_cheese", "feta_cheese", "goat_cheese"] },
  // verdure
  { id: "foglia-cotta", label: "verdure a foglia da cuocere", closeness: "tight", from: ["spinach", "swiss_chard", "kale"] },
  { id: "lattughe", label: "lattughe", closeness: "tight", from: ["iceberg_lettuce", "romaine_lettuce", "leaf_lettuce"] },
  { id: "insalate", label: "insalate", closeness: "loose", from: ["iceberg_lettuce", "romaine_lettuce", "leaf_lettuce", "endive", "radicchio", "arugula"] },
  { id: "cavoli", label: "cavoli", closeness: "tight", from: ["cabbage", "savoy_cabbage"] },
  { id: "cavolfiori", label: "broccoli e cavolfiore", closeness: "tight", from: ["broccoli", "cauliflower"] },
  { id: "cipolle", label: "cipolle", closeness: "tight", from: ["onion", "red_onion"] },
  { id: "peperoni", label: "peperoni", closeness: "tight", from: ["red_bell_pepper", "yellow_bell_pepper", "green_bell_pepper"] },
  { id: "zucchine", label: "zucchine e melanzane", closeness: "loose", from: ["zucchini", "eggplant"] },
  { id: "pomodoro", label: "pomodoro da cuocere", closeness: "tight", from: ["tomato_puree", "tomato_sauce"] },
  // frutta
  { id: "agrumi-aspri", label: "agrumi aspri", closeness: "tight", from: ["lemon", "lime"] },
  { id: "agrumi-dolci", label: "agrumi dolci", closeness: "tight", from: ["orange", "tangerine"] },
  { id: "bacche", label: "frutti di bosco", closeness: "tight", from: ["strawberry", "raspberry", "blueberry", "blackberry"] },
  { id: "pesche", label: "pesche", closeness: "tight", from: ["peach", "nectarine"] },
  { id: "drupacee", label: "frutta a nocciolo", closeness: "loose", from: ["peach", "nectarine", "apricot", "plum", "cherry"] },
  { id: "pomacee", label: "mele e pere", closeness: "tight", from: ["apple", "pear"] },
  { id: "frutta-secca", label: "frutta secca", closeness: "loose", from: ["almond", "hazelnut", "walnut", "pistachio", "cashew"] },
  // carne e pesce
  { id: "pollame", label: "pollo e tacchino", closeness: "tight", from: ["chicken", "chicken_breast", "turkey_breast"] },
  // il macinato ha una famiglia sua: una tagliata non diventa macinato, né il contrario
  { id: "manzo-vitello", label: "manzo e vitello", closeness: "tight", from: ["beef", "veal"] },
  { id: "macinati", label: "carne macinata", closeness: "tight", from: ["ground_beef", "ground_pork"] },
  { id: "carni-rosse", label: "carni rosse", closeness: "loose", from: ["beef", "veal", "lamb"] },
  { id: "pancetta", label: "pancetta", closeness: "tight", from: ["bacon", "pork_belly"] },
  { id: "pesce-azzurro", label: "salmone e trota", closeness: "tight", from: ["salmon", "trout"] },
  { id: "pesce-bianco", label: "pesce da cuocere", closeness: "loose", from: ["cod", "sea_bass", "swordfish", "trout", "tuna", "salmon"] },
  { id: "molluschi", label: "calamari e seppie", closeness: "tight", from: ["squid", "cuttlefish", "octopus"] },
  // ostriche, vongole, cozze e capesante non hanno sostituti: si mangiano crude o cotte in modi che non si scambiano
  { id: "crostacei", label: "crostacei", closeness: "loose", from: ["shrimp", "lobster"] },
  // legumi, cereali, altro
  { id: "fagioli", label: "fagioli", closeness: "tight", from: ["cannellini", "kidney_bean"] },
  { id: "legumi", label: "legumi", closeness: "loose", from: ["chickpea", "cannellini", "kidney_bean", "lentil", "broad_bean"] },
  { id: "soia", label: "tofu e tempeh", closeness: "tight", from: ["tofu", "tempeh"] },
  { id: "riso", label: "riso", closeness: "tight", from: ["rice", "brown_rice"] },
  { id: "cereali-in-chicco", label: "cereali in chicco", closeness: "loose", from: ["spelt", "barley", "bulgur", "couscous", "quinoa", "millet"] },
  { id: "farine", label: "farine", closeness: "tight", from: ["flour", "whole_wheat_flour"] },
  { id: "pane", label: "pane", closeness: "tight", from: ["white_bread", "whole_wheat_bread"] },
  { id: "erbe-legnose", label: "erbe aromatiche", closeness: "loose", from: ["rosemary", "thyme", "oregano"] },
  { id: "aceti", label: "aceti", closeness: "tight", from: ["red_wine_vinegar", "balsamic_vinegar"] },
  { id: "brodi", label: "brodi", closeness: "tight", from: ["chicken_broth", "beef_broth", "vegetable_broth"] },
  { id: "zuccheri", label: "zucchero", closeness: "tight", from: ["sugar", "brown_sugar"] },
  { id: "cioccolato", label: "cioccolato", closeness: "tight", from: ["dark_chocolate", "milk_chocolate"] },
];

const closenessOrder = { tight: 0, loose: 1 } as const;

/** Un alimento che c'è in casa, con il nome com'è scritto in dispensa. */
export interface HomeFood {
  /** Nome sul lotto: è ciò che finisce al posto dell'ingrediente. */
  name: string;
  /** Per riconoscerlo nell'elenco di gusto: identificativo della tabella nutrizionale e altri nomi. */
  subject: TasteSubject;
}

export type SubstituteVerdict =
  | { status: "excluded" }
  /** Non si può escludere un allergene dichiarato: si propone, con il suo avviso (frasi già in italiano). */
  | { status: "uncertain"; notes: string[] }
  | { status: "clear"; /** Frase da mostrare anche se non c'è dubbio, per esempio «confermato da te». */ note?: string };

export interface Substitute {
  /** Nome in dispensa, da usare al posto dell'ingrediente. */
  name: string;
  /** L'alimento dell'elenco di gusto a cui corrisponde. */
  food: TasteFood;
  family: string;
  closeness: "tight" | "loose";
  /** Dati di gusto, se la coppia è tra i primi vicini. */
  score?: number;
  rank?: number;
  /** Presente se un allergene dichiarato non si può escludere: mai da leggere come compatibile. */
  doubt?: string[];
  /** Una frase da mostrare anche senza dubbio. */
  note?: string;
}

export interface SubstituteOptions {
  /**
   * Il controllo di allergeni ed esclusioni. OBBLIGATORIO: non esiste una proposta che non lo abbia passato, e chi è
   * escluso non occupa nessuno dei posti.
   */
  screen: (candidate: { name: string; food: TasteFood }) => SubstituteVerdict;
  max?: number;
}

/** Le famiglie in cui l'ingrediente può essere sostituito da `candidate`. */
function familiesBetween(ingredientKey: string, candidateKey: string): SubstituteFamily[] {
  return SUBSTITUTE_FAMILIES.filter((f) => {
    if (f.to) return f.from.includes(ingredientKey) && f.to.includes(candidateKey);
    return f.from.includes(ingredientKey) && f.from.includes(candidateKey);
  });
}

/**
 * Cosa si può usare al posto di `ingredient` tra `home`: stessa famiglia e vicinanza sufficiente (vedi in cima),
 * poi il controllo allergeni. Mai più di `MAX_SUBSTITUTES`. Se l'ingrediente non è nell'elenco di gusto, o non ha
 * famiglia, la risposta è vuota: non si inventa nulla.
 */
export function substitutesFor(
  index: TasteIndex,
  ingredient: TasteSubject,
  home: readonly HomeFood[],
  options: SubstituteOptions,
): Substitute[] {
  const target = resolveTasteFood(index, ingredient);
  if (!target) return [];
  const links = index.links.get(target.key);

  const byKey = new Map<string, Substitute>();
  for (const h of home) {
    const food = resolveTasteFood(index, h.subject);
    if (!food || food.key === target.key) continue;
    const families = familiesBetween(target.key, food.key);
    if (families.length === 0) continue;

    const link = links?.get(food.key);
    // la famiglia più stretta tra quelle che ammettono la coppia e i dati: le larghe esigono i dati
    const admitted = families
      .filter((f) =>
        f.closeness === "tight"
          ? link === undefined || link.score >= MIN_TIGHT_SCORE
          : link !== undefined && link.score >= MIN_LOOSE_SCORE && link.rank >= MIN_LOOSE_RANK,
      )
      .sort((a, b) => closenessOrder[a.closeness] - closenessOrder[b.closeness]);
    const family = admitted[0];
    if (!family) continue;

    const verdict = options.screen({ name: h.name, food });
    if (verdict.status === "excluded") continue;
    const candidate: Substitute = {
      name: h.name,
      food,
      family: family.label,
      closeness: family.closeness,
      ...(link ? { score: link.score, rank: link.rank } : {}),
      ...(verdict.status === "uncertain" ? { doubt: verdict.notes } : {}),
      ...(verdict.status === "clear" && verdict.note ? { note: verdict.note } : {}),
    };
    // due lotti dello stesso alimento: vale quello senza dubbi
    const prev = byKey.get(food.key);
    if (!prev || (prev.doubt && !candidate.doubt)) byKey.set(food.key, candidate);
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        closenessOrder[a.closeness] - closenessOrder[b.closeness] ||
        Number(b.rank !== undefined) - Number(a.rank !== undefined) ||
        (b.rank ?? 0) - (a.rank ?? 0) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        a.name.localeCompare(b.name, "it"),
    )
    .slice(0, options.max ?? MAX_SUBSTITUTES);
}

/** Una scelta dell'utente: l'ingrediente alla posizione `index` si fa con `name`, per questa cottura. */
export interface Substitution {
  index: number;
  name: string;
}

const FOOD_ID_RE = /^[a-z0-9-]+$/;

/**
 * La ricetta come verrà cucinata: l'ingrediente scelto prende il nome del sostituto, stessa quantità. Così il confronto
 * con la dispensa, il controllo allergeni e il consumo dei lotti leggono il sostituto e non l'originale. Il nome
 * dell'originale non resta nella nota, che il controllo allergeni legge. Indici fuori dalla ricetta e nomi vuoti si
 * ignorano; per un indice ripetuto vale l'ultimo.
 */
export function applySubstitutions<R extends { ingredients: readonly RecipeIngredient[] }>(recipe: R, substitutions: readonly Substitution[]): R {
  const byIndex = new Map<number, string>();
  for (const s of substitutions) {
    const name = s.name.trim();
    if (Number.isInteger(s.index) && s.index >= 0 && s.index < recipe.ingredients.length && name !== "") byIndex.set(s.index, name);
  }
  if (byIndex.size === 0) return recipe;
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ing, i) => {
      const name = byIndex.get(i);
      if (name === undefined) return ing;
      const { foodId: _foodId, ...rest } = ing;
      void _foodId;
      return { ...rest, name, ...(FOOD_ID_RE.test(name) ? { foodId: name } : {}) };
    }),
  };
}

/** Gli indici degli ingredienti sostituiti che esistono davvero in questa ricetta. */
export const substitutedIndices = (recipe: Pick<Recipe, "ingredients">, substitutions: readonly Substitution[]): number[] =>
  [...new Set(substitutions.map((s) => s.index))].filter((i) => Number.isInteger(i) && i >= 0 && i < recipe.ingredients.length);
