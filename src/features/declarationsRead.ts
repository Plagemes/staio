// Allergeni ed esclusioni: le parti pure della lettura (posti di prima, che cosa può mostrare una schermata).
import { declaredTexts, legacyPlanStructure, type DeclaredState, type LegacyDeclarations, type LegacyLists } from "@/core/allergens";

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Le dichiarazioni nell'impostazione del ricettario, lette senza indulgenza: le voci leggibili valgono, e una parte
 * inattesa rende il controllo incompleto (`partial`), mai «nessuna dichiarazione». Niente da leggere: `"unreadable"`.
 * Niente valore: `undefined`.
 */
export function readPrefsDeclarations(raw: unknown): LegacyLists | "unreadable" | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return "unreadable";
  const out: { allergens: string[]; excludedFoods: string[]; partial?: boolean } = { allergens: [], excludedFoods: [] };
  for (const list of ["allergens", "excludedFoods"] as const) {
    const v = raw[list];
    if (v === undefined) continue;
    if (typeof v === "string") {
      out[list] = [v];
      out.partial = true;
    } else if (!Array.isArray(v)) {
      out.partial = true;
    } else {
      for (const x of v) {
        if (typeof x === "string") out[list].push(x);
        else out.partial = true;
      }
    }
  }
  return out;
}

/** I due posti di prima, dal registro e dal valore grezzo dell'impostazione del ricettario. */
export function legacyOf(events: readonly unknown[], rawPrefs: unknown, prefsFailed = false): LegacyDeclarations {
  return {
    recipePrefs: prefsFailed ? "unreadable" : readPrefsDeclarations(rawPrefs),
    planStructure: legacyPlanStructure(events),
  };
}

/**
 * Che cosa può mostrare una schermata che filtra con allergeni ed esclusioni: niente esito finché non sono letti; letti,
 * le liste e se il controllo è incompleto (allora l'avviso va mostrato accanto all'elenco).
 */
export function declarationsView(
  state: DeclaredState | undefined,
): { status: "loading" } | { status: "ready"; lists: { allergens: string[]; excludedFoods: string[] }; incomplete: boolean } {
  if (state === undefined) return { status: "loading" };
  return { status: "ready", lists: declaredTexts(state), incomplete: !state.complete };
}
