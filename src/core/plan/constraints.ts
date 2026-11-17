// Vincoli del piano: alimenti esclusi e allergeni dichiarati dall'utente.

import type { MealKind } from "../diary";
import { nameTokens, normalizeName } from "../nutrition";
import type { PlanStructureState, PlanWeekState } from "./derive";
import { refOf, type ExpandRef, type ItemRef } from "./refs";

export interface ConstraintItem {
  name: string;
  foodId?: string;
}

export interface ConstraintsOptions {
  /** Espande ricette e preparazioni: serve a vedere gli ingredienti. */
  expand?: ExpandRef;
  /**
   * Allergeni di un alimento. `undefined` = non si sa: l'alimento resta "non verificato", mai
   * dichiarato sicuro.
   */
  allergensOf?: (item: ConstraintItem) => readonly string[] | undefined;
}

export interface ConstraintViolation {
  code: "excluded_food" | "allergen";
  date: string;
  meal: MealKind;
  /** Alimento escluso o allergene dichiarato che corrisponde. */
  term: string;
  item: ConstraintItem;
  /** Ricetta o preparazione da cui viene l'ingrediente. */
  via?: ItemRef;
}

export interface UnverifiedItem {
  code: "unknown_allergens" | "unresolved_ref";
  date: string;
  meal: MealKind;
  item?: ConstraintItem;
  via?: ItemRef;
}

export interface ConstraintsResult {
  /** Nessuna violazione trovata. */
  ok: boolean;
  /** Tutte le voci sono state verificate: `ok && verified` è l'unico caso di piano senza dubbi. */
  verified: boolean;
  violations: ConstraintViolation[];
  unverified: UnverifiedItem[];
}

const tokenSubset = (small: readonly string[], big: readonly string[]): boolean =>
  small.length > 0 && small.every((t) => big.includes(t));

/**
 * Un alimento escluso corrisponde se i suoi termini compaiono tutti nel nome dell'alimento
 * (per esempio "latte" corrisponde a "latte intero") oppure se coincide con l'identificativo.
 */
function excludedMatches(term: string, item: ConstraintItem): boolean {
  if (item.foodId !== undefined && item.foodId.trim().toLowerCase() === term.trim().toLowerCase()) {
    return true;
  }
  return tokenSubset(nameTokens(term), nameTokens(item.name));
}

export function checkConstraints(
  structure: PlanStructureState | undefined,
  week: PlanWeekState | undefined,
  options: ConstraintsOptions = {},
): ConstraintsResult {
  const violations: ConstraintViolation[] = [];
  const unverified: UnverifiedItem[] = [];
  const excluded = structure?.excludedFoods ?? [];
  const allergens = structure?.allergens ?? [];
  const declared = allergens.map((a) => ({ term: a, norm: normalizeName(a) })).filter((a) => a.norm !== "");

  for (const entry of week?.entries ?? []) {
    const where = { date: entry.date, meal: entry.meal };
    const ref = refOf(entry.item);
    let items: { item: ConstraintItem; via?: ItemRef }[];
    if (entry.item.kind === "food") {
      items = [
        {
          item: {
            name: entry.item.name,
            ...(entry.item.foodId !== undefined ? { foodId: entry.item.foodId } : {}),
          },
        },
      ];
    } else {
      const ingredients = options.expand?.(ref!, entry.item.servings);
      if (!ingredients) {
        if (excluded.length > 0 || declared.length > 0) {
          unverified.push({ code: "unresolved_ref", ...where, via: ref! });
        }
        continue;
      }
      items = ingredients.map((ing) => ({
        item: { name: ing.name, ...(ing.foodId !== undefined ? { foodId: ing.foodId } : {}) },
        via: ref!,
      }));
    }

    for (const { item, via } of items) {
      const extra = via ? { via } : {};
      for (const term of excluded) {
        if (excludedMatches(term, item)) {
          violations.push({ code: "excluded_food", ...where, term, item, ...extra });
        }
      }
      if (declared.length === 0) continue;
      const found = options.allergensOf?.(item);
      if (found === undefined) {
        unverified.push({ code: "unknown_allergens", ...where, item, ...extra });
        continue;
      }
      const foundNorm = new Set(found.map((a) => normalizeName(a)));
      for (const a of declared) {
        if (foundNorm.has(a.norm)) {
          violations.push({ code: "allergen", ...where, term: a.term, item, ...extra });
        }
      }
    }
  }

  return { ok: violations.length === 0, verified: unverified.length === 0, violations, unverified };
}
