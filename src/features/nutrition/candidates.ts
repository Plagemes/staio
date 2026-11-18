// Scelta dell'alimento della tabella per una voce libera. Il nome scritto non si tocca: la scelta si salva
// come `foodId` e il calcolo usa quell'alimento. Per gli alimenti che la tabella ha in più stati (pasta
// secca e cotta, uova crude e cotte) le voci gemelle stanno affiancate e non c'è un predefinito.
import { createFoodMatcher, type FoodCandidate, type FoodComposition, type FoodState } from "@/core/nutrition";

export interface FoodOption {
  id: string;
  name: string;
  state?: FoodState;
  /** Gruppo alimentare della tabella, per esempio "cereali". */
  group: string;
  food: FoodComposition;
}

export interface OptionGroup {
  key: string;
  /** Lo stesso alimento in stati diversi, con almeno un cotto e un non cotto: la scelta pesa molto. */
  twins: boolean;
  options: FoodOption[];
}

const optionOf = (c: FoodCandidate): FoodOption => ({
  id: c.food.id,
  name: c.food.name,
  ...(c.state !== undefined ? { state: c.state } : {}),
  group: c.food.group,
  food: c.food,
});

function isTwins(options: readonly FoodOption[]): boolean {
  const states = new Set(options.map((o) => o.state));
  return options.length >= 2 && states.has("cooked") && (states.has("dried") || states.has("raw"));
}

/** Per proporre candidati basta una somiglianza più bassa di quella per riconoscere da soli: l'utente sceglie. */
const SUGGEST_MIN_CONFIDENCE = 0.5;

/** Con questa somiglianza un alimento si propone anche se le parole scritte non sono inizi di parole del suo nome. */
const PROPOSE_ANYWAY_CONFIDENCE = 0.8;

/** Parole di legame che non dicono che cosa si è mangiato: non servono a proporre un alimento. */
const LINK_WORDS = new Set(["a", "al", "alla", "alle", "allo", "ai", "agli", "all", "con", "da", "dal", "dalla", "de", "del", "della", "delle", "dello", "dei", "degli", "di", "e", "ed", "il", "in", "la", "le", "lo", "gli", "i", "per", "su", "un", "una", "uno"]);

/** Minuscole e senza accenti, divise in parole. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
}

/**
 * Ogni parola scritta è l'inizio di una parola del nome dell'alimento, fuori dalle parentesi: «pizza» non porta a
 * «Mozzarella a bassa umidità (tipo per pizza)», «mozzarella» sì. Le parole di legame non contano.
 */
export function nameStartsWith(foodName: string, query: string): boolean {
  const asked = words(query).filter((w) => !LINK_WORDS.has(w));
  if (asked.length === 0) return false;
  const own = words(foodName.replace(/\([^)]*\)/g, " "));
  return asked.every((w) => own.some((o) => o.startsWith(w)));
}

/** Un candidato si propone se il nome comincia con le parole scritte, oppure se la somiglianza è alta. */
const proposable = (c: FoodCandidate, query: string) => c.confidence >= PROPOSE_ANYWAY_CONFIDENCE || nameStartsWith(c.food.name, query);

export interface FoodSearch {
  /** Candidati per il testo scritto, ordinati; le voci dello stesso gruppo `variantOf` sono vicine. */
  /**
   * Proposte per il testo scritto: solo gli alimenti il cui nome (fuori dalle parentesi) ha una parola che comincia con
   * ogni parola scritta, oppure molto simili (`nameStartsWith`).
   */
  groups(query: string, limit?: number): OptionGroup[];
  byId(id: string | undefined): FoodComposition | undefined;
  /** Dove di un alimento la tabella ha solo la voce secca: l'alimento secco (o crudo) che corrisponde al nome. */
  uncookedFor(name: string): FoodOption | undefined;
}

/** Prepara l'indice una volta sola: non va rifatto a ogni tasto. */
export function createFoodSearch(foods: readonly FoodComposition[]): FoodSearch {
  const matcher = createFoodMatcher(foods);
  const byId = new Map(foods.map((f) => [f.id, f]));
  return {
    groups(query, limit = 8) {
      if (query.trim().length < 2) return [];
      const out: (OptionGroup & { proposable: boolean })[] = [];
      for (const candidate of matcher.search(query, { limit, minConfidence: SUGGEST_MIN_CONFIDENCE })) {
        const option = optionOf(candidate);
        const last = out[out.length - 1];
        const key = candidate.variantOf ?? candidate.food.id;
        const ok = proposable(candidate, query);
        if (last && last.key === key) {
          last.options.push(option);
          last.proposable ||= ok;
        } else out.push({ key, twins: false, options: [option], proposable: ok });
      }
      // un gruppo di gemelli (cotto e crudo) resta intero se una sua voce si propone
      return out.filter((g) => g.proposable).map(({ key, options }) => ({ key, options, twins: isTwins(options) }));
    },
    byId: (id) => (id === undefined ? undefined : byId.get(id)),
    uncookedFor(name) {
      const out = matcher.find(name.trim(), { preferStates: ["cooked"] });
      if (out.status !== "state_unavailable") return undefined;
      const foodsOf = out.candidates.map((c) => c.food);
      const food = foodsOf.find((f) => f.state === "dried") ?? foodsOf.find((f) => f.state === "raw");
      return food ? { id: food.id, name: food.name, ...(food.state ? { state: food.state } : {}), group: food.group, food } : undefined;
    },
  };
}

export interface FreeRowInput {
  name: string;
  quantityText: string;
  /** L'alimento scelto dall'elenco. */
  foodId?: string;
  /** «Nessuno di questi»: la voce si salva senza alimento scelto. */
  none?: boolean;
}

/**
 * Voci libere pronte da salvare. Il nome resta quello scritto; se c'è la scelta, entra come `foodId`.
 * Quando il candidato migliore è un alimento con gemelli cotto/secco, la voce non si aggiunge finché
 * non si sceglie una delle voci o «Nessuno di questi»: dare per scontato lo stato sbaglia i conti.
 */
export function resolveFreeItems(
  rows: readonly FreeRowInput[],
  search: Pick<FoodSearch, "groups">,
): { items: { name: string; quantityText: string; foodId?: string }[]; errors: Record<number, string> } {
  const errors: Record<number, string> = {};
  const items = rows.map((row, index) => {
    const base = { name: row.name, quantityText: row.quantityText };
    if (row.name.trim() === "") return base;
    if (row.foodId) return { ...base, foodId: row.foodId };
    if (!row.none && search.groups(row.name)[0]?.twins) {
      errors[index] = "Scegli l'alimento giusto (cotto o crudo cambia molto i conti), oppure «Nessuno di questi».";
    }
    return base;
  });
  return { items, errors };
}
