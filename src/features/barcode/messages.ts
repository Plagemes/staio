import { isLocalCode, type BarcodeProblem } from "@/core/catalog";
import type { LookupFailure } from "./offClient";

export const BARCODE_PROBLEM_MESSAGES: Record<BarcodeProblem, string> = {
  empty: "Scrivi le cifre sotto il codice a barre.",
  not_digits: "Il codice è fatto solo di cifre: controlla di non aver scritto altro.",
  bad_length: "Servono 8, 12 o 13 cifre. Controlla di non averne saltata o aggiunta una.",
  bad_checksum: "Le cifre non tornano: l'ultima è di controllo e qui non corrisponde. Ricontrolla.",
};

export const LOOKUP_FAILURE_MESSAGES: Record<LookupFailure, string> = {
  offline: "Il telefono non ha rete e questo prodotto non è tra quelli già letti. Riprova con la rete, o aggiungilo alla dispensa.",
  network: "Non riesco a raggiungere Open Food Facts. Controlla la connessione e riprova, o aggiungilo alla dispensa.",
  timeout: "Open Food Facts non ha risposto in tempo. Riprova, o aggiungilo alla dispensa.",
  service: "Open Food Facts ha avuto un problema nel rispondere. Riprova più tardi, o aggiungilo alla dispensa.",
  invalid_code: "Il codice non è valido.",
  aborted: "Ricerca interrotta.",
};

export const ALLERGEN_LABELS: Record<string, string> = {
  gluten: "glutine",
  milk: "latte",
  eggs: "uova",
  nuts: "frutta a guscio",
  peanuts: "arachidi",
  soybeans: "soia",
  fish: "pesce",
  crustaceans: "crostacei",
  molluscs: "molluschi",
  celery: "sedano",
  mustard: "senape",
  "sesame-seeds": "sesamo",
  "sulphur-dioxide-and-sulphites": "solfiti",
  lupin: "lupini",
};

export const NUTRIENT_ROWS = [
  ["energyKcal", "Energia", "kcal"],
  ["fat", "Grassi", "g"],
  ["saturatedFat", "di cui saturi", "g"],
  ["carbohydrates", "Carboidrati", "g"],
  ["sugars", "di cui zuccheri", "g"],
  ["fiber", "Fibre", "g"],
  ["proteins", "Proteine", "g"],
  ["salt", "Sale", "g"],
] as const;

export const NOVA_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "non trasformato",
  2: "ingrediente culinario",
  3: "trasformato",
  4: "ultra-trasformato",
};

export function allergenLabel(id: string): string {
  return ALLERGEN_LABELS[id] ?? id.replace(/-/g, " ");
}

/** Come si mostra il codice di una scheda salvata: è la scheda a dire se il codice è locale. */
export function displayProductCode(product: { barcode: string; localFromName?: true }): string {
  return product.localFromName ? "Scheda tua, senza codice a barre" : product.barcode;
}

/** Solo dal codice, senza la scheda: si basa sulla forma e può sbagliare per un codice 299 di un negozio. Meglio `displayProductCode`. */
export function displayCode(code: string): string {
  return isLocalCode(code) ? "Scheda tua, senza codice a barre" : code;
}

export function formatNumber(value: number): string {
  return String(value).replace(".", ",");
}
