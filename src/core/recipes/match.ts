// Confronto tra nomi di ingredienti e di alimenti. Principio: meglio nessuna corrispondenza che una
// sbagliata. Si confrontano insiemi di parole normalizzate (articoli, plurali, marche tolti).

import { nameTokens } from "../nutrition";

export interface FoodRef {
  name?: string;
  foodId?: string;
}

export const MIN_MATCH_SCORE = 0.6;

/**
 * Somiglianza da 0 a 1 tra un ingrediente e un alimento. Stesso `foodId`: 1. `foodId` diversi: 0.
 * Stesse parole: 0,95. Le parole di uno contenute nell'altro ("olio" in "olio extravergine"): da 0,6
 * a 0,9 secondo quanto i due nomi si somigliano.
 */
export function matchScore(a: FoodRef, b: FoodRef): number {
  if (a.foodId && b.foodId) return a.foodId === b.foodId ? 1 : 0;
  const ta = new Set(nameTokens(a.name ?? ""));
  const tb = new Set(nameTokens(b.name ?? ""));
  if (ta.size === 0 || tb.size === 0) return 0;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  if (shared !== small.size) return 0;
  if (small.size === large.size) return 0.95;
  return 0.6 + 0.3 * (small.size / large.size);
}

/**
 * `exact`: stesso `foodId` o stesse parole. `partial`: le parole di uno sono solo un sottoinsieme di
 * quelle dell'altro ("uova" in "pasta all'uovo", "latte" in "latte di cocco", "burro" in "burro di
 * arachidi"): potrebbe essere un alimento diverso, quindi non basta per dire che c'è.
 */
export type MatchKind = "exact" | "partial" | "none";

export function matchKind(a: FoodRef, b: FoodRef): MatchKind {
  const s = matchScore(a, b);
  if (s >= 0.95 - 1e-9) return "exact";
  return s >= MIN_MATCH_SCORE ? "partial" : "none";
}

/**
 * Se c'è almeno una corrispondenza esatta vale solo quella; altrimenti la migliore tra le parziali
 * (`kind: "partial"`, da confermare); altrimenti nessuna.
 */
export function classifyMatches<T>(
  target: FoodRef,
  candidates: readonly T[],
  refOf: (c: T) => FoodRef,
): { kind: MatchKind; matches: T[] } {
  const exact = candidates.filter((c) => matchKind(target, refOf(c)) === "exact");
  if (exact.length > 0) return { kind: "exact", matches: exact };
  const partial = bestMatches(target, candidates, refOf);
  return partial.length > 0 ? { kind: "partial", matches: partial } : { kind: "none", matches: [] };
}

/** I candidati con il punteggio migliore (almeno `MIN_MATCH_SCORE`), tutti se a pari merito. */
export function bestMatches<T>(
  target: FoodRef,
  candidates: readonly T[],
  refOf: (c: T) => FoodRef,
): T[] {
  let top = 0;
  let out: T[] = [];
  for (const c of candidates) {
    const s = matchScore(target, refOf(c));
    if (s < MIN_MATCH_SCORE) continue;
    if (s > top + 1e-9) {
      top = s;
      out = [c];
    } else if (Math.abs(s - top) <= 1e-9) out.push(c);
  }
  return out;
}
