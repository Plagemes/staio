// Esito del controllo di allergeni ed esclusioni per una ricetta, a parole. Logica pura sopra il motore unico
// (`@/core/allergens`) e i motivi di `@/core/recipes`: l'elenco e la scheda leggono la stessa cosa.
import { assessRecipe, type FindingOrigin, type IngredientHit, type ItemSubject } from "@/core/allergens";
import { exclusionReasons, type ExclusionReason, type Filterable, type IngredientLink } from "@/core/recipes";
import { fold } from "./common";

export type SafetyKind = "contains" | "uncertain" | "other" | "none";

/**
 * Perché una ricetta è esclusa, in ordine di gravità: contiene (allergene o alimento escluso), non verificabile,
 * altro (tempo, attrezzatura), nessun motivo.
 */
export function safetyKind(reasons: readonly ExclusionReason[]): SafetyKind {
  if (reasons.some((r) => r.code === "allergen" || r.code === "excluded_food")) return "contains";
  if (reasons.some((r) => r.code === "allergen_uncertain")) return "uncertain";
  return reasons.length > 0 ? "other" : "none";
}

export interface SafetyCriteria {
  allergens: readonly string[];
  excludedFoods: readonly string[];
  linkOf?: (ingredient: { name: string; foodId?: string }) => IngredientLink | undefined;
}

export interface RecipeSafety {
  /** `clear` vuol dire solo «nessuna corrispondenza trovata nei nomi»: mai «sicura». */
  verdict: "contains" | "uncertain" | "clear";
  contains: string[];
  uncertain: string[];
}

/** Unione senza doppioni (a meno di maiuscole e accenti) di ciò che il ricettario e il piano dichiarano. */
export function unionDeclared(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const text = item.trim();
      const key = fold(text);
      if (text === "" || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

export const hasDeclared = (c: Pick<SafetyCriteria, "allergens" | "excludedFoods">): boolean =>
  c.allergens.some((a) => a.trim() !== "") || c.excludedFoods.some((a) => a.trim() !== "");

function originNote(hit: IngredientHit | undefined): string {
  if (!hit) return "";
  const where: Partial<Record<FindingOrigin, string>> = {
    note: " (nella nota)",
    linked: ` (in dispensa hai «${hit.text}»)`,
    product: ` (il prodotto in dispensa è «${hit.text}»)`,
    label: " (allergene dichiarato in etichetta sul prodotto in dispensa)",
  };
  return (hit.reason === "typo" && hit.note ? ` (${hit.note})` : "") + (where[hit.origin] ?? "");
}

interface Doubt {
  hit: IngredientHit;
  allergens: string[];
}

const MAX_NAMED = 4;

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMED).map((n) => `«${n}»`).join(", ");
  return names.length > MAX_NAMED ? `${shown} e altri ${names.length - MAX_NAMED}` : shown;
}

const sourceNote = (h: IngredientHit): string => (h.origin === "linked" || h.origin === "product" ? ` (in dispensa: «${h.text}»)` : "");

/**
 * Le righe degli ingredienti incerti, una per motivo e non una per ingrediente: con un motore severo gli incerti sono
 * molti. Ogni riga nomina gli ingredienti, il motivo vero e gli allergeni per cui c'è il dubbio.
 */
function doubtLines(doubts: ReadonlyMap<string, Doubt>): string[] {
  const byReason = new Map<string, Doubt[]>();
  for (const d of doubts.values()) {
    const key = d.hit.reason ?? "unrecognized";
    byReason.set(key, [...(byReason.get(key) ?? []), d]);
  }
  const lines: string[] = [];
  const allergensOf = (ds: readonly Doubt[]) => [...new Set(ds.flatMap((d) => d.allergens))].join(", ");
  const named = (ds: readonly Doubt[]) => nameList(ds.map((d) => d.hit.name)) + (ds.length === 1 ? sourceNote((ds[0] as Doubt).hit) : "");
  for (const [reason, ds] of byReason) {
    const many = ds.length > 1;
    if (reason === "generic") {
      lines.push(`${named(ds)} ${many ? "sono ingredienti generici o composti" : "è un ingrediente generico o composto"}: potrebbe${many ? "ro" : ""} contenere ${allergensOf(ds)}. Controlla l'etichetta.`);
    } else if (reason === "gluten_free_claim") {
      lines.push(`${named(ds)}: ${many ? "dichiarati" : "dichiarato"} senza glutine, ma va verificato in etichetta.`);
    } else if (reason === "typo") {
      for (const d of ds) lines.push(`«${d.hit.name}»: ${d.hit.note ?? "possibile refuso"} Potrebbe contenere ${d.allergens.join(", ")}. Controlla l'etichetta.`);
    } else {
      lines.push(`Non so cosa ${many ? "contengono" : "contiene"} ${named(ds)}: potrebbe${many ? "ro" : ""} contenere ${allergensOf(ds)}. Controlla l'etichetta.`);
    }
  }
  return lines;
}

function ingredientList(names: readonly string[], hits: ReadonlyMap<string, IngredientHit>): string {
  return names.map((n) => `«${n}»${originNote(hits.get(n))}`).join(", ");
}

function subjectsOf(recipe: Filterable, criteria: SafetyCriteria): ItemSubject[] {
  return recipe.ingredients.map((ing) => {
    const link = criteria.linkOf?.(ing);
    return {
      name: ing.name,
      ...(ing.note ? { note: ing.note } : {}),
      ...(ing.foodId ? { foodId: ing.foodId } : {}),
      ...(link?.names && link.names.length > 0 ? { linkedNames: link.names } : {}),
      ...(link?.productName ? { productName: link.productName } : {}),
      ...(link?.allergens && link.allergens.length > 0 ? { labelAllergens: link.allergens } : {}),
    };
  });
}

const firstByName = (hits: readonly IngredientHit[]): Map<string, IngredientHit> => {
  const m = new Map<string, IngredientHit>();
  for (const h of hits) if (!m.has(h.name)) m.set(h.name, h);
  return m;
};

/** Le frasi per una lista di motivi, con l'origine del sospetto dove il motore la conosce. */
export function reasonLines(reasons: readonly ExclusionReason[], recipe: Filterable, criteria: SafetyCriteria): RecipeSafety {
  const assessment = assessRecipe(
    { ...(recipe.title !== undefined ? { title: recipe.title } : {}), ingredients: subjectsOf(recipe, criteria), steps: (recipe.steps ?? []).map((s) => s.text) },
    { allergens: criteria.allergens, excludedFoods: criteria.excludedFoods },
  );
  const contains: string[] = [];
  const uncertain: string[] = [];
  const doubts = new Map<string, Doubt>();
  for (const r of reasons) {
    if (r.code === "excluded_food") {
      const hits = firstByName(assessment.exclusions.flatMap((e) => e.ingredients));
      const parts: string[] = [];
      if (r.ingredients.length > 0) parts.push(ingredientList(r.ingredients, hits));
      if (r.steps && r.steps.length > 0) parts.push(`nel passo «${r.steps[0]}»`);
      if (r.inTitle) parts.push("nel titolo");
      contains.push(`Alimento escluso: ${parts.join("; ")}.`);
    } else if (r.code === "allergen") {
      const hits = firstByName(assessment.allergens.filter((a) => a.allergen === r.allergen).flatMap((a) => a.ingredients));
      const parts: string[] = [];
      if (r.ingredients.length > 0) parts.push(ingredientList(r.ingredients, hits));
      if (r.steps && r.steps.length > 0) parts.push(`nel passo «${r.steps[0]}»`);
      if (r.inTitle) parts.push("nel titolo");
      contains.push(`Contiene ${r.allergen}: ${parts.join("; ")}.`);
    } else if (r.code === "allergen_uncertain") {
      for (const h of assessment.allergens.filter((x) => x.allergen === r.allergen && x.verdict === "uncertain").flatMap((x) => x.ingredients)) {
        const cur = doubts.get(h.name) ?? { hit: h, allergens: [] };
        if (!cur.allergens.includes(r.allergen)) cur.allergens.push(r.allergen);
        doubts.set(h.name, cur);
      }
    }
  }
  uncertain.push(...doubtLines(doubts));
  return { verdict: contains.length > 0 ? "contains" : uncertain.length > 0 ? "uncertain" : "clear", contains, uncertain };
}

/** Il controllo per una ricetta sola: solo allergeni ed esclusioni, senza tempo né attrezzatura. */
export function recipeSafety(recipe: Filterable, criteria: SafetyCriteria): RecipeSafety {
  const reasons = exclusionReasons(recipe, {
    allergens: criteria.allergens,
    excludedFoods: criteria.excludedFoods,
    ...(criteria.linkOf ? { linkOf: criteria.linkOf } : {}),
  });
  return reasonLines(reasons, recipe, criteria);
}

/** Che cosa dice il controllo quando non trova niente: mai «sicura». */
export function clearText(criteria: Pick<SafetyCriteria, "allergens" | "excludedFoods">): string {
  const declared = unionDeclared(criteria.allergens, criteria.excludedFoods);
  return `Nessuna corrispondenza trovata nei nomi per: ${declared.join(", ")}. Non vuol dire che sia sicura.`;
}

export interface IngredientFlag {
  verdict: "contains" | "uncertain";
  /** Breve, da mettere accanto all'ingrediente: «contiene latte», «non so cosa contiene: controlla l'etichetta». */
  text: string;
}

/** Per indice di ingrediente, ciò che il controllo ha trovato. Un ingrediente con un allergene sicuro vince sull'incerto. */
export function ingredientFlags(recipe: Filterable, criteria: SafetyCriteria): Map<number, IngredientFlag> {
  const assessment = assessRecipe(
    { ingredients: subjectsOf(recipe, criteria) },
    { allergens: criteria.allergens, excludedFoods: criteria.excludedFoods },
  );
  const sure = new Map<number, string[]>();
  const unsure = new Map<number, string>();
  const add = (index: number, label: string) => sure.set(index, [...(sure.get(index) ?? []), label]);
  for (const a of assessment.allergens) {
    for (const h of a.ingredients) {
      if (a.verdict === "contains") add(h.index, a.allergen);
      else if (!unsure.has(h.index) || h.reason === "generic") unsure.set(h.index, h.reason ?? "unrecognized");
    }
  }
  for (const e of assessment.exclusions) for (const h of e.ingredients) add(h.index, `${e.excluded} (escluso)`);
  const out = new Map<number, IngredientFlag>();
  const unsureText: Record<string, string> = {
    generic: "ingrediente generico o composto: controlla l'etichetta",
    gluten_free_claim: "dichiarato senza glutine: verifica in etichetta",
    typo: "forse un refuso: controlla l'etichetta",
  };
  for (const [idx, reason] of unsure) out.set(idx, { verdict: "uncertain", text: unsureText[reason] ?? "non so cosa contiene: controlla l'etichetta" });
  for (const [idx, labels] of sure) out.set(idx, { verdict: "contains", text: `contiene ${[...new Set(labels)].join(", ")}` });
  return out;
}
