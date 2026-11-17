// Prodotti di prova. Tutti i valori sono FINTI, scelti per far tornare i conti a mente: non sono
// dati nutrizionali reali e non vanno usati altrove.

import type { Nutrients, Product } from "../catalog";

export function product(barcode: string, extra: Partial<Product> = {}): Product {
  return { barcode, fetchedAt: "2026-11-17T08:00:00.000Z", source: "openfoodfacts", ...extra };
}

export function withNutrients(
  barcode: string,
  nutrients: Partial<Omit<Nutrients, "per" | "certainty">>,
  extra: Partial<Product> & { per?: "100g" | "100ml" } = {},
): Product {
  const { per, ...rest } = extra;
  return product(barcode, { ...rest, nutrients: { per: per ?? "100g", certainty: "label", ...nutrients } });
}
