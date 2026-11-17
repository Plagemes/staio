// «Cosa cucinare» partendo da un alimento (`/app/ricette/idee?alimento=Nome`): l'alimento è il punto di partenza.
// Prima le ricette salvate che lo usano (senza intelligenza artificiale), poi le idee del modello. Logica pura.
import type { CheckedIdea } from "@/core/ai/recipeIdeasCheck";
import { fold } from "../recipes/common";
import type { RecipeRow } from "../recipes/list";

export const FOOD_PARAM = "alimento";
const MAX_FOOD = 80;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Dall'indirizzo: un nome non vuoto, senza caratteri di controllo, di lunghezza ragionevole; altrimenti nessun alimento. */
export function parseFood(raw: string | null | undefined): string | undefined {
  const name = (raw ?? "").trim().slice(0, MAX_FOOD).trim();
  return name === "" || CONTROL_RE.test(name) ? undefined : name;
}

/** L'indirizzo delle idee di ricette con quell'alimento come partenza. */
export const ideasHref = (food: string): string => `/app/ricette/idee?${FOOD_PARAM}=${encodeURIComponent(food)}`;

// Il singolare e il plurale si toccano per l'ultima vocale («uova»/«uovo», «pomodori»/«pomodoro»).
function stem(word: string): string {
  return word.length > 3 && /[aeio]$/.test(word) ? word.slice(0, -1) : word;
}

function wordsOf(name: string): string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .map(stem);
}

/**
 * Il nome di un ingrediente (o di un alimento) è l'alimento cercato se le parole dell'uno stanno tutte nell'altro:
 * «Latte intero» e «Latte» sì, «Latte» e «Latte di mandorla» sì, «Burro» e «Burro di arachidi» sì (è una scelta prudente:
 * meglio una ricetta in più da guardare che una in meno).
 */
export function sameFood(a: string, b: string): boolean {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.length === 0 || wb.length === 0) return false;
  return wa.every((w) => wb.includes(w)) || wb.every((w) => wa.includes(w));
}

/** Le righe del ricettario che usano l'alimento: prima quelle che si fanno con più cose già in casa. */
export function rowsUsing(rows: readonly RecipeRow[], food: string): RecipeRow[] {
  return rows
    .filter((r) => r.recipe.ingredients.some((i) => sameFood(i.name, food)))
    .sort((a, b) => b.coverage - a.coverage || a.recipe.title.localeCompare(b.recipe.title, "it"));
}

/** I lotti che sono l'alimento passano in testa all'elenco mandato al modello (restano nell'ordine «da mangiare prima»). */
export function foodFirst<T extends { lot: { productRef: string } }>(entries: readonly T[], food: string): T[] {
  const is = (e: T) => sameFood(e.lot.productRef, food);
  return [...entries.filter(is), ...entries.filter((e) => !is(e))];
}

export function ideaUsesFood(checked: Pick<CheckedIdea, "usedFromPantry" | "idea">, food: string): boolean {
  return checked.usedFromPantry.some((p) => sameFood(p.name, food)) || checked.idea.ingredients.some((i) => sameFood(i.name, food));
}

/** Le idee che usano l'alimento vengono prima; l'ordine tra pari resta quello del modello. */
export function ideasFoodFirst<T extends Pick<CheckedIdea, "usedFromPantry" | "idea">>(accepted: readonly T[], food: string): T[] {
  const uses = (c: T) => ideaUsesFood(c, food);
  return [...accepted.filter(uses), ...accepted.filter((c) => !uses(c))];
}
