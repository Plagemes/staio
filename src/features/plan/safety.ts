// Il controllo di allergeni ed esclusioni sul piano, con tutto ciò che si sa degli ingredienti: nomi degli alimenti di
// dispensa collegati, nomi dei prodotti e allergeni in etichetta. Logica pura sopra `checkConstraints`.
import type { ConfirmationMap } from "@/core/allergens";
import { checkConstraints, type ConstraintsResult, type ExpandRef, type PlanWeekState } from "@/core/plan";
import { allergensOfIngredient } from "@/core/recipes";
import type { LinkOf } from "../recipes/allergenLinks";

/**
 * `declared`: allergeni ed esclusioni dalla lettura unica (`declaredLists` di `features/allergens`), mai i soli campi
 * della struttura del piano.
 */
export function checkWeekConstraints(
  declared: { readonly allergens: readonly string[]; readonly excludedFoods: readonly string[] },
  week: PlanWeekState | undefined,
  ctx: { expandForChecks: ExpandRef; linkOf: LinkOf; confirmations?: ConfirmationMap },
): ConstraintsResult {
  // `checkConstraints` legge dalla struttura solo allergeni ed esclusioni
  const structure = { meals: [], allergens: [...declared.allergens], excludedFoods: [...declared.excludedFoods], eventId: "", recordedAt: "" };
  return checkConstraints(structure, week, {
    expand: ctx.expandForChecks,
    allergensOf: (item) => allergensOfIngredient({ name: item.name }),
    linkOf: (item) => ctx.linkOf(item),
    ...(ctx.confirmations ? { confirmations: ctx.confirmations } : {}),
  });
}
