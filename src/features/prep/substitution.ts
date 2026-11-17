// Le sostituzioni scelte nella scheda della ricetta arrivano alla preparazione di più porzioni nell'indirizzo
// (`sost=indice:nome`, lo stesso della cottura). Valgono con le stesse regole: solo tra le proposte già controllate per
// allergeni ed esclusioni. Logica pura.
import { applySubstitutions, type Recipe, type Substitute, type Substitution } from "@/core/recipes";
import { SUBSTITUTION_PARAM, unappliedNote, validSubstitutions } from "../recipes/substitutes";

/** `/app/preparazioni/nuova` da una ricetta, con le porzioni e le sostituzioni scelte. */
export function prepHref(recipeId: string, servings: number, substitutions: readonly Substitution[]): string {
  const q = new URLSearchParams({ ricetta: recipeId, porzioni: String(servings) });
  for (const s of substitutions) q.append(SUBSTITUTION_PARAM, `${s.index}:${s.name}`);
  return `/app/preparazioni/nuova?${q.toString()}`;
}

export interface PrepSubstitution {
  /** La ricetta come verrà preparata: l'ingrediente scelto prende il nome del sostituto. */
  recipe: Recipe;
  /** Le scelte che valgono. */
  applied: Substitution[];
  /** «Sostituzione non applicata: …», se qualcuna non si è potuta applicare. */
  unapplied: string | undefined;
}

export function resolvePrepSubstitutions(
  written: Recipe,
  chosen: readonly Substitution[],
  options: ReadonlyMap<number, readonly Substitute[]>,
  context: { missing: readonly number[]; failed: boolean },
): PrepSubstitution {
  const applied = validSubstitutions(chosen, options);
  return {
    recipe: applySubstitutions(written, applied),
    applied,
    unapplied: unappliedNote(chosen, applied, { ...context, originalName: (i) => written.ingredients[i]?.name ?? "" }),
  };
}
