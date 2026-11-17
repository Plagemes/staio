// Costo di una preparazione: il prezzo dei lotti consumati, in proporzione alla quantità usata.
// Un ingrediente senza prezzo ha costo sconosciuto (non zero): il costo è allora un minimo e lo si dichiara.

import { worseCertainty, type Certainty, type Lot, type Quantity } from "../ledger";

export interface CostInput {
  lot: Pick<Lot, "lotId" | "initial" | "priceCents" | "priceCertainty" | "initialCertainty">;
  /** Quantità consumata, nell'unità del lotto. */
  quantity: Quantity;
}

export interface IngredientCost {
  lotId: string;
  /** Centesimi interi; assente se il costo è sconosciuto. */
  costCents?: number;
}

export interface PrepCost {
  ingredients: IngredientCost[];
  /** Somma dei costi noti (centesimi interi). Assente se nessun ingrediente ha un costo. */
  totalCents?: number;
  /** Costo per porzione, arrotondato al centesimo. Assente se `totalCents` lo è. */
  perPortionCents?: number;
  /** Vero se almeno un ingrediente ha costo sconosciuto: i totali sono minimi. */
  partial: boolean;
  /** Lotti degli ingredienti senza costo noto, senza duplicati. */
  unknownLotIds: string[];
  /** Quota di ingredienti senza costo, da 0 a 1 (per numero di ingredienti). */
  missingShare: number;
  /** La peggiore certezza tra i prezzi noti; `estimated` se il costo è parziale. Assente senza costi. */
  certainty?: Certainty;
}

function ingredientCents(input: CostInput): number | undefined {
  const { lot, quantity } = input;
  const price = lot.priceCents;
  if (price === undefined || !Number.isFinite(price) || price < 0) return undefined;
  if (!Number.isFinite(lot.initial) || lot.initial <= 0) return undefined;
  if (!Number.isFinite(quantity.value) || quantity.value < 0) return undefined;
  // Non si può usare più del lotto: oltre l'iniziale il prezzo non cresce.
  const share = Math.min(1, quantity.value / lot.initial);
  return Math.round(price * share);
}

/**
 * Costo di una preparazione e per porzione. Ogni ingrediente costa `prezzo del lotto × quantità /
 * quantità iniziale`, arrotondato al centesimo; il totale è la somma degli arrotondati, così le
 * voci tornano col totale. `portions` deve essere un intero positivo, altrimenti non c'è costo per porzione.
 */
export function prepCost(inputs: readonly CostInput[], portions: number): PrepCost {
  const ingredients: IngredientCost[] = [];
  const unknown = new Set<string>();
  let total = 0;
  let known = 0;
  let certainty: Certainty | undefined;
  for (const input of inputs) {
    const cents = ingredientCents(input);
    if (cents === undefined) {
      unknown.add(input.lot.lotId);
      ingredients.push({ lotId: input.lot.lotId });
      continue;
    }
    known++;
    total += cents;
    ingredients.push({ lotId: input.lot.lotId, costCents: cents });
    const c = input.lot.priceCertainty ?? input.lot.initialCertainty;
    certainty = certainty === undefined ? c : worseCertainty(certainty, c);
  }
  const partial = known < inputs.length;
  const hasTotal = known > 0;
  const validPortions = Number.isInteger(portions) && portions > 0;
  return {
    ingredients,
    ...(hasTotal ? { totalCents: total } : {}),
    ...(hasTotal && validPortions ? { perPortionCents: Math.round(total / portions) } : {}),
    partial,
    unknownLotIds: [...unknown].sort(),
    missingShare: inputs.length === 0 ? 0 : Math.round(((inputs.length - known) / inputs.length) * 1e6) / 1e6,
    ...(certainty !== undefined ? { certainty: partial ? "estimated" : certainty } : {}),
  };
}
