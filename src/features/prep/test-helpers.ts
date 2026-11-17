// Dati di prova per i test delle schermate: dispensa e ricette costruite dagli eventi.
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Location, type Lot } from "@/core/ledger";
import { purchase, q } from "@/core/ledger/test-helpers";
import { deriveRecipes, type Recipe } from "@/core/recipes";
import { recipeEvent } from "@/core/recipes/test-helpers";

export const NOW = "2026-11-16T09:00:00.000Z";

export interface Stock {
  id: string;
  name: string;
  value: number;
  unit?: "g" | "ml" | "pz";
  expiry?: string;
  location?: Location;
  priceCents?: number;
}

export function lotsOf(items: readonly Stock[]): { events: AnyEvent[]; lots: Lot[] } {
  const events: AnyEvent[] = items.map((s, i) =>
    purchase(`p-${i}`, `2026-11-1${i % 9}T08:00:00.000Z`, {
      lotId: s.id,
      productRef: s.name,
      quantity: q(s.value, s.unit ?? "g"),
      location: s.location ?? "dispensa",
      ...(s.expiry ? { expiry: { date: s.expiry, kind: "best_before" as const } } : {}),
      ...(s.priceCents !== undefined ? { priceCents: s.priceCents } : {}),
    }),
  );
  return { events, lots: derivePantry(events).lots };
}

type Fields = Parameters<typeof recipeEvent>[2];

export function recipeOf(recipeId: string, fields: Fields = {}, recordedAt = "2026-11-10T10:00:00.000Z"): Recipe {
  const state = deriveRecipes([recipeEvent(`e-${recipeId}`, recordedAt, { recipeId, ...fields })]);
  const r = state.recipes[0];
  if (!r) throw new Error("ricetta di prova non valida");
  return r;
}
