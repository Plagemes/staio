// Modello delle preparazioni (meal prep), schemaVersion 1.
//
// Una preparazione consuma ingredienti dalla dispensa e produce porzioni che diventano un lotto
// di dispensa. Si rappresenta con eventi del libro mastro già esistenti:
//   - un `consume` per ogni lotto di ingrediente (senza `mealId`: non è un pasto);
//   - un `declare` che crea il lotto di porzioni (unità `pz`, luogo, scadenza stimata);
//   - un `updateLot` con il costo del lotto (`priceCents`), se almeno un ingrediente ha un prezzo;
// più un evento proprio `prep` che LEGA tutto: elenca gli id dei `consume` e del `declare`.
// Senza `prep` non c'è modo affidabile di sapere quali consumi appartengono a quale lotto.
// Annullare la preparazione = annullare (`void`) tutti questi eventi.

import type { EventBase, Location, Quantity } from "../ledger";

export const PREP_EVENT_TYPES = ["prep"] as const;
export type PrepEventType = (typeof PREP_EVENT_TYPES)[number];

export interface PrepIngredient {
  lotId: string;
  /** Prodotto del lotto al momento della preparazione. */
  productRef: string;
  /** Quantità consumata, nell'unità del lotto. */
  quantity: Quantity;
  /** Id dell'evento `consume` che scala il lotto. */
  consumeEventId: string;
  /**
   * Costo della quota consumata, in centesimi interi: prezzo del lotto in proporzione.
   * Assente se il lotto non ha un prezzo noto (costo sconosciuto, non zero).
   */
  costCents?: number;
}

export interface PrepEvent extends EventBase {
  type: "prep";
  prepId: string;
  title: string;
  recipeId?: string;
  /** Porzioni prodotte (numero intero). */
  portions: number;
  /** Lotto di porzioni, in `pz`. */
  batchLotId: string;
  /** Id dell'evento `declare` che crea il lotto. */
  batchEventId: string;
  /** Id dell'evento `updateLot` che imposta il costo del lotto, se c'è. */
  priceEventId?: string;
  /** Luogo in cui le porzioni sono state riposte. */
  location: Location;
  ingredients: PrepIngredient[];
  /** Somma dei costi noti degli ingredienti, in centesimi. Assente se nessuno ha un costo. */
  costCents?: number;
  /** Vero se almeno un ingrediente ha costo sconosciuto: `costCents` è un minimo. */
  costPartial?: boolean;
  /** Peso cotto diviso peso crudo, se dichiarato. */
  cookedPerRaw?: number;
}

export const PREP_LIMITS = { maxPortions: 1000 } as const;
