// Il controllo di allergeni ed esclusioni sul piano, con tutto ciò che si sa degli ingredienti: nomi degli alimenti di
// dispensa collegati, nomi dei prodotti e allergeni in etichetta. Logica pura sopra `checkConstraints`.
import { checkConstraints, type ConstraintsResult, type ExpandRef, type PlanStructureState, type PlanWeekState } from "@/core/plan";
import { allergensOfIngredient } from "@/core/recipes";
import type { LinkOf } from "../recipes/allergenLinks";

export function checkWeekConstraints(
  structure: PlanStructureState | undefined,
  week: PlanWeekState | undefined,
  ctx: { expandForChecks: ExpandRef; linkOf: LinkOf },
): ConstraintsResult {
  return checkConstraints(structure, week, {
    expand: ctx.expandForChecks,
    allergensOf: (item) => allergensOfIngredient({ name: item.name }),
    linkOf: (item) => ctx.linkOf(item),
  });
}
