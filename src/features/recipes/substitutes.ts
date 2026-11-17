// Sostituzione degli ingredienti che mancano: dal nucleo (`@/core/recipes`, famiglie e vicinanza di gusto) alla scheda e
// alla modalità cucina. Qui sta il controllo di allergeni ed esclusioni, lo stesso delle ricette (`./safety`), e la scelta
// che viaggia da una schermata all'altra nell'indirizzo. Logica pura.
import type { ConfirmationMap } from "@/core/allergens";
import { createFoodMatcher, type FoodComposition } from "@/core/nutrition";
import type { PantryComparison, Substitute, Substitution, SubstituteVerdict, HomeFood } from "@/core/recipes";
import { screenFood } from "@/core/taste";
import { doubtText, homeSubjects, type FoodIdOf } from "../taste/logic";
import { makeLinkOf, type PantryFood } from "./allergenLinks";
import { effectiveStatus, type Answers } from "./list";
import { hasDeclared, recipeSafety } from "./safety";

/** Detto accanto a ogni proposta: è un cambio di ricetta, non un equivalente. */
export const SUBSTITUTE_NOTICE = "È una sostituzione: il risultato può cambiare.";

/** Detto una volta nella scheda: da dove vengono le proposte (i dati di gusto hanno una licenza che chiede l'attribuzione). */
export const SUBSTITUTE_BASIS =
  "Le sostituzioni sono scelte tra ciò che hai in casa, nella stessa famiglia di alimenti e vicine nei dati di gusto (FlavorGraph, Park e altri, 2021, CC BY-NC-SA 3.0, solo uso non commerciale). Non sono equivalenti: il risultato può cambiare.";

export const SUBSTITUTION_PARAM = "sost";

/** Dal nome scritto all'identificativo della tabella nutrizionale, a parole uguali (come negli abbinamenti). */
export function makeFoodIdOf(foods: readonly FoodComposition[] | undefined): FoodIdOf {
  const matcher = foods ? createFoodMatcher(foods) : undefined;
  return (name) => {
    const m = matcher?.match(name);
    return m && m.confidence >= 0.95 ? m.food.id : undefined;
  };
}

/** Gli alimenti in casa come candidati. */
export function homeFoodsOf(foods: readonly PantryFood[], foodIdOf: FoodIdOf): HomeFood[] {
  const subjects = homeSubjects(foods, foodIdOf);
  return foods.map((f, i) => ({ name: f.name, subject: subjects[i] ?? { name: f.name } }));
}

/** Gli ingredienti che non sono in dispensa, per indice: quelli per cui ha senso proporre un sostituto. */
export function missingIndices(comparison: PantryComparison, answers: Answers = {}): number[] {
  return comparison.items.filter((item) => effectiveStatus(item, answers[item.index]) === "missing").map((item) => item.index);
}

export interface ScreenCriteria {
  allergens: readonly string[];
  excludedFoods: readonly string[];
  confirmations?: ConfirmationMap | undefined;
}

/**
 * Il controllo di un sostituto, con lo stesso motore delle ricette: il nome passa da `recipeSafety` come una riga di
 * ricetta, collegato a TUTTI i lotti della dispensa che gli corrispondono (come alla cottura, quando se ne scala
 * più d'uno): vale il caso peggiore, un «contiene» su uno qualunque lo esclude e un incerto su uno qualunque porta
 * l'avviso. L'alimento riconosciuto passa da `screenFood`. Una conferma dell'utente vale come per le ricette (e si dice).
 * Senza allergeni né esclusioni dichiarati non c'è nulla da controllare.
 */
export function makeSubstituteScreen(criteria: ScreenCriteria, pantry: readonly PantryFood[]) {
  const linkOf = makeLinkOf(pantry);
  return ({ name, food }: { name: string; food: Parameters<typeof screenFood>[0] }): SubstituteVerdict => {
    if (!hasDeclared(criteria)) return { status: "clear" };
    const declared = { allergens: criteria.allergens, excludedFoods: criteria.excludedFoods };

    const byFood = screenFood(food, declared);
    if (byFood.status === "excluded") return { status: "excluded" };

    const safety = recipeSafety(
      { ingredients: [{ name }] },
      { ...declared, linkOf, ...(criteria.confirmations ? { confirmations: criteria.confirmations } : {}) },
    );
    if (safety.verdict === "contains") return { status: "excluded" };

    const notes = [...safety.uncertain];
    if (byFood.status === "uncertain" && notes.length === 0) notes.push(`«${name}»: ${doubtText(byFood.doubt)}`);
    if (safety.verdict === "uncertain" || notes.length > 0) return { status: "uncertain", notes };
    const confirmed = safety.confirmed[0];
    return confirmed ? { status: "clear", note: `«${confirmed.name}»: ${confirmed.text} per ${confirmed.allergens.join(", ")}.` } : { status: "clear" };
  };
}

const MAX_NAME = 120;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const PARAM_RE = /^(\d{1,3}):([\s\S]+)$/;

/** Le scelte lette dall'indirizzo, con prudenza: indici dentro la ricetta, nomi non vuoti, una per ingrediente. */
export function parseSubstitutions(values: readonly string[], ingredientCount: number): Substitution[] {
  const byIndex = new Map<number, Substitution>();
  for (const v of values) {
    const m = PARAM_RE.exec(v);
    if (!m) continue;
    const index = Number(m[1]);
    const name = (m[2] as string).trim().slice(0, MAX_NAME);
    if (index < ingredientCount && name !== "" && !CONTROL_RE.test(name)) byIndex.set(index, { index, name });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Un indirizzo di una pagina della cottura (`/app/ricette/cucina`…) con id, porzioni e sostituzioni. */
export function recipeHref(path: string, recipeId: string, substitutions: readonly Substitution[], servings?: number): string {
  const q = new URLSearchParams({ id: recipeId });
  if (servings !== undefined) q.set("porzioni", String(servings));
  for (const s of substitutions) q.append(SUBSTITUTION_PARAM, `${s.index}:${s.name}`);
  return `${path}?${q.toString()}`;
}

/** Cambia la scelta di un ingrediente: `name` nullo la toglie. */
export function withSubstitution(subs: readonly Substitution[], index: number, name: string | null): Substitution[] {
  const rest = subs.filter((s) => s.index !== index);
  return name === null ? rest : [...rest, { index, name }].sort((a, b) => a.index - b.index);
}

/** «Margarina» al posto di «Burro»: per dire cosa si è scelto. */
export const chosenText = (original: string, substitute: string): string => `«${substitute}» al posto di «${original}»`;

/** Il nome scelto per l'ingrediente, se c'è. */
export const chosenFor = (subs: readonly Substitution[], index: number): string | undefined => subs.find((s) => s.index === index)?.name;

/**
 * Delle scelte lette dall'indirizzo o fatte a mano tiene solo quelle che sono tra le proposte già controllate per quell'ingrediente:
 * un nome scritto nell'indirizzo non entra mai, il resto si scarta in silenzio.
 */
export function validSubstitutions(subs: readonly Substitution[], options: ReadonlyMap<number, readonly Substitute[]>): Substitution[] {
  return subs.filter((s) => options.get(s.index)?.some((o) => o.name === s.name) ?? false);
}

/**
 * Una riga per le scelte dell'indirizzo che non si sono potute applicare, con il motivo in parole semplici; `undefined` se
 * tutte valgono. Il motivo non nomina l'originale tra i passi: parla solo della scelta.
 */
export function unappliedNote(
  chosen: readonly Substitution[],
  valid: readonly Substitution[],
  context: { missing: readonly number[]; failed: boolean; originalName: (index: number) => string },
): string | undefined {
  const dropped = chosen.filter((c) => !valid.some((v) => v.index === c.index && v.name === c.name));
  if (dropped.length === 0) return undefined;
  const parts = dropped.map((d) => {
    const reason = !context.missing.includes(d.index)
      ? "l'ingrediente ora è in dispensa o non serve più"
      : context.failed
        ? "non sono riuscito a caricare i dati per controllare i sostituti: controlla la connessione"
        : "non è più tra i sostituti che puoi usare";
    return `${chosenText(context.originalName(d.index), d.name)}: ${reason}`;
  });
  return `${dropped.length === 1 ? "Sostituzione non applicata" : "Sostituzioni non applicate"}: ${parts.join("; ")}. Vale la ricetta scritta.`;
}
