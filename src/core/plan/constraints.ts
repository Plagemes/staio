// Vincoli del piano: alimenti esclusi e allergeni dichiarati dall'utente.

import { allergenLabels, assessItem, itemMatchesExclusion, type FindingOrigin, type FindingReason, type ItemSubject } from "../allergens";
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
  /**
   * Ciò che si sa di un alimento oltre al nome: alimenti di dispensa collegati, prodotto, allergeni in etichetta. Un
   * alimento collegato incerto rende incerto l'ingrediente; uno che contiene l'allergene è una violazione.
   */
  linkOf?: (item: ConstraintItem) => ConstraintLink | undefined;
}

/** Un alimento di dispensa collegato a una voce del piano. */
export interface ConstraintLink {
  names?: readonly string[];
  productName?: string;
  /** Allergeni dichiarati in etichetta. La loro assenza non prova nulla. */
  allergens?: readonly string[];
}

/** Da dove viene il sospetto: il nome, la dispensa (alimento collegato o prodotto), l'etichetta. */
export interface ConstraintEvidence {
  origin: FindingOrigin;
  /** Il testo in cui si è trovato (il nome, il nome dell'alimento collegato, la voce dell'etichetta). */
  text: string;
  /** La voce delle tabelle, o le parole non riconosciute. */
  term: string;
  reason: FindingReason;
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
  /** Per gli allergeni: dove si è trovato (nome, dispensa, etichetta). */
  evidence?: ConstraintEvidence;
}

export interface UnverifiedItem {
  /**
   * `unknown_allergens`: nessuna informazione sugli allergeni; `unresolved_ref`: ricetta o preparazione non espandibile;
   * `uncertain_allergens`: ingrediente generico o composto («dado», «crema»), o dal nome non riconosciuto, che può
   * contenere un allergene dichiarato.
   */
  code: "unknown_allergens" | "unresolved_ref" | "uncertain_allergens";
  date: string;
  meal: MealKind;
  item?: ConstraintItem;
  via?: ItemRef;
  /** Con `uncertain_allergens`: gli allergeni dichiarati di cui non si può dire. */
  terms?: string[];
  /** Con `uncertain_allergens`: da dove viene il dubbio, un elemento per allergene nell'ordine di `terms`. */
  evidence?: ConstraintEvidence[];
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

const subjectOf = (item: ConstraintItem): ItemSubject => ({
  name: item.name,
  ...(item.foodId !== undefined && item.foodId.trim() !== "" ? { foodId: item.foodId } : {}),
});

/**
 * Un alimento escluso corrisponde se i suoi termini compaiono tutti nel nome dell'alimento
 * (per esempio "latte" corrisponde a "latte intero"), se coincide con l'identificativo, o se il motore degli
 * allergeni lo riconosce (plurali, accenti, iponimi: «maiale» → «salsiccia»).
 */
function excludedMatches(term: string, item: ConstraintItem): boolean {
  if (item.foodId !== undefined && item.foodId.trim().toLowerCase() === term.trim().toLowerCase()) {
    return true;
  }
  return tokenSubset(nameTokens(term), nameTokens(item.name)) || itemMatchesExclusion(subjectOf(item), term) !== undefined;
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
      const link = options.linkOf?.(item);
      // stesso motore del ricettario e delle idee: nome, identificativo, alimento collegato, prodotto e ciò che dicono
      // `allergensOf` e l'etichetta, letti con gli alias
      const subject: ItemSubject = {
        ...subjectOf(item),
        ...(link?.names && link.names.length > 0 ? { linkedNames: link.names } : {}),
        ...(link?.productName ? { productName: link.productName } : {}),
        labelAllergens: [...(found ?? []), ...(link?.allergens ?? [])],
      };
      const foundNorm = new Set((found ?? []).map((a) => normalizeName(a)));
      const assessed = assessItem(subject, declared.map((a) => a.term));
      const uncertainTerms: string[] = [];
      const uncertainEvidence: ConstraintEvidence[] = [];
      for (const a of declared) {
        const labels = allergenLabels([a.term]);
        const mine = assessed.findings.filter((f) => labels.includes(f.allergen));
        const hit = mine.find((f) => f.verdict === "contains");
        if (foundNorm.has(a.norm) || hit) {
          const evidence: ConstraintEvidence = hit
            ? { origin: hit.origin, text: hit.text, term: hit.term, reason: hit.reason }
            : { origin: "label", text: a.term, term: a.term, reason: "label" };
          violations.push({ code: "allergen", ...where, term: a.term, item, ...extra, evidence });
        } else if (found === undefined && !link) {
          // senza dati sull'alimento il dubbio è già detto, una volta sola, con `unknown_allergens`
        } else if (mine.length > 0) {
          const f = mine[0] as (typeof mine)[number];
          uncertainTerms.push(a.term);
          uncertainEvidence.push({ origin: f.origin, text: f.text, term: f.term, reason: f.reason });
        }
      }
      if (found === undefined && !link) {
        unverified.push({ code: "unknown_allergens", ...where, item, ...extra });
      } else if (uncertainTerms.length > 0) {
        unverified.push({ code: "uncertain_allergens", ...where, item, ...extra, terms: uncertainTerms, evidence: uncertainEvidence });
      }
    }
  }

  return { ok: violations.length === 0, verified: unverified.length === 0, violations, unverified };
}
