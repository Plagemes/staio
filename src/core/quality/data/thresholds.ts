// Soglie per la classificazione "a semaforo" di grassi, grassi saturi, zuccheri e sale.
// Ogni numero qui sotto è ricopiato dalla fonte indicata (consultata il 2026-11-17), non da memoria.
// Se la fonte cambia, si aggiorna questo file e FONTI.md insieme.

import type { NutrientDimensionId, SourceRef } from "../types";

export interface Cutoff {
  /** Verde (basso): valore minore o uguale a questo. */
  lowMax: number;
  /** Rosso (alto): valore strettamente maggiore di questo. In mezzo: ambra. */
  highAbove: number;
}

export interface TrafficLightTable {
  id: "food" | "drink";
  per: "100g" | "100ml";
  /** Dove sta nella fonte. */
  location: string;
  cutoffs: Readonly<Record<NutrientDimensionId, Cutoff>>;
}

export const TRAFFIC_LIGHT_SOURCE: SourceRef = {
  body: "Department of Health, Food Standards Agency e amministrazioni decentrate del Regno Unito, con il British Retail Consortium",
  document:
    "Guide to creating a front of pack (FoP) nutrition label for pre-packed products sold through retail outlets, aggiornata a novembre 2016, Annex 3",
  url: "https://assets.publishing.service.gov.uk/media/5a80cd03ed915d74e33fc7c5/FoP_Nutrition_labelling_UK_guidance.pdf",
};

/** Pagina di pubblicazione del documento (data di pubblicazione 19 giugno 2013, ultimo aggiornamento 8 novembre 2016). */
export const TRAFFIC_LIGHT_PAGE = "https://www.gov.uk/government/publications/front-of-pack-nutrition-labelling-guidance";

export const TRAFFIC_LIGHT_FOOD: TrafficLightTable = {
  id: "food",
  per: "100g",
  location: "Annex 3, Table 2: criteri per 100 g di alimento (venduto o no a volume)",
  cutoffs: {
    fat: { lowMax: 3.0, highAbove: 17.5 },
    saturatedFat: { lowMax: 1.5, highAbove: 5.0 },
    sugars: { lowMax: 5.0, highAbove: 22.5 },
    salt: { lowMax: 0.3, highAbove: 1.5 },
  },
};

export const TRAFFIC_LIGHT_DRINK: TrafficLightTable = {
  id: "drink",
  per: "100ml",
  location: "Annex 3, Table 3: criteri per 100 ml di bevanda",
  cutoffs: {
    fat: { lowMax: 1.5, highAbove: 8.75 },
    saturatedFat: { lowMax: 0.75, highAbove: 2.5 },
    sugars: { lowMax: 2.5, highAbove: 11.25 },
    salt: { lowMax: 0.3, highAbove: 0.75 },
  },
};

export const TRAFFIC_LIGHT_TABLES = { food: TRAFFIC_LIGHT_FOOD, drink: TRAFFIC_LIGHT_DRINK } as const;

/**
 * Non usate: i criteri "per porzione" della fonte (rosso oltre una quota dell'assunzione di
 * riferimento, per porzioni sopra 100 g o 150 ml) richiedono la porzione, che il prodotto non porta.
 */
export const TRAFFIC_LIGHT_PORTION_NOTE =
  "La fonte prevede anche criteri per porzione (alimenti oltre 100 g, bevande oltre 150 ml): non applicati, perché il prodotto non porta la porzione.";
