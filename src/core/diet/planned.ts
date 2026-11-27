// Porzioni per gruppo già messe nel piano di una settimana: ricette, preparazioni e alimenti scritti a mano.

import type { PlannedEntry } from "../plan/types";
import { groupServings, servingsOfQuantity } from "./recipes";
import {
  DIET_GROUPS,
  type Classifier,
  type DietGroup,
  type PlannedDiet,
  type PortionTable,
  type PrepForDiet,
  type RecipeDietFacts,
} from "./types";

export interface PlannedDietContext {
  recipes: ReadonlyMap<string, RecipeDietFacts>;
  /** Per `batchLotId`, come in `ClassifierSources`. */
  preps: ReadonlyMap<string, PrepForDiet>;
  classifier: Pick<Classifier, "name">;
  portions: PortionTable;
  /** Lunedì della settimana; se manca, quello della prima voce. */
  weekStart?: string;
}

const isDietGroup = (g: string): g is DietGroup => (DIET_GROUPS as readonly string[]).includes(g);

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Porzioni e voci per gruppo del piano. Una ricetta porta i gruppi delle sue porzioni (`recipeDietFacts`) per le
 * porzioni pianificate; una preparazione si legge dagli ingredienti; un alimento conta con la sua quantità.
 * Le voci senza gruppo riconosciuto (ricetta o preparazione sconosciuta, nome ignoto) vanno in `unresolved`.
 */
export function plannedDiet(entries: readonly PlannedEntry[], ctx: PlannedDietContext): PlannedDiet {
  const servingsByGroup: Partial<Record<DietGroup, number>> = {};
  const entriesByGroup: Partial<Record<DietGroup, number>> = {};
  let unresolved = 0;
  const prepFacts = new Map<string, ReturnType<typeof groupServings> | undefined>();
  let prepById: Map<string, PrepForDiet> | undefined;

  const add = (group: DietGroup, servings: number | undefined) => {
    entriesByGroup[group] = (entriesByGroup[group] ?? 0) + 1;
    if (servings !== undefined && servings > 0) servingsByGroup[group] = round2((servingsByGroup[group] ?? 0) + servings);
  };

  const factsOfPrep = (prepId: string) => {
    if (prepFacts.has(prepId)) return prepFacts.get(prepId);
    if (!prepById) {
      prepById = new Map();
      for (const p of ctx.preps.values()) prepById.set(p.prepId, p);
    }
    const prep = prepById.get(prepId);
    const facts = prep
      ? groupServings(
          prep.ingredients.map((i) => ({ part: ctx.classifier.name(i.productRef), quantity: i.quantity })),
          prep.portions,
          ctx.portions,
        )
      : undefined;
    prepFacts.set(prepId, facts);
    return facts;
  };

  for (const entry of entries) {
    const item = entry.item;
    if (item.kind === "recipe" || item.kind === "prep") {
      const facts = item.kind === "recipe" ? ctx.recipes.get(item.recipeId) : factsOfPrep(item.prepId);
      if (!facts || facts.groups.length === 0) {
        unresolved += 1;
        continue;
      }
      for (const g of facts.groups) {
        const per = facts.servingsByGroup[g];
        add(g, per !== undefined ? per * item.servings : undefined);
      }
      continue;
    }
    const part = ctx.classifier.name(item.name, item.foodId !== undefined && item.foodId !== "" ? item.foodId : undefined);
    if (!isDietGroup(part.group)) {
      unresolved += 1;
      continue;
    }
    add(part.group, servingsOfQuantity(item.quantity, part, ctx.portions)?.servings);
  }

  const first = entries.reduce<string | undefined>((min, e) => (min === undefined || e.date < min ? e.date : min), undefined);
  return {
    weekStart: ctx.weekStart ?? (first !== undefined ? mondayOf(first) : ""),
    servingsByGroup,
    entriesByGroup,
    unresolved,
  };
}
