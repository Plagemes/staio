// Composizione degli eventi di una preparazione a partire da ingredienti scelti.

import {
  SCHEMA_VERSION,
  generateId,
  isIsoInstant,
  type Certainty,
  type ConsumeEvent,
  type DeclareEvent,
  type IdGenerator,
  type LedgerEvent,
  type Location,
  type Lot,
  type Quantity,
  type Source,
  type UpdateLotEvent,
} from "../ledger";
import { DEFAULT_TIME_ZONE, toCalendarDate } from "../expiry";
import { prepCost, type PrepCost } from "./cost";
import { prepNutrients, type IngredientNutrients, type NutrientIngredient, type PrepNutrients } from "./nutrients";
import { DEFAULT_PREP_CATEGORY, portionsExpiry, type PrepCategory } from "./shelf";
import { PREP_LIMITS, type PrepEvent, type PrepIngredient } from "./types";
import { validatePrepEvent } from "./validate";

export interface PrepIngredientChoice {
  /** Lotto della dispensa calcolata (`derivePantry`). */
  lot: Lot;
  /** Quantità da consumare, nell'unità del lotto. */
  quantity: Quantity;
}

export interface ComposePrepInput {
  /** Identificativo della preparazione. Default: uno nuovo. */
  prepId?: string;
  /** Nome del piatto: diventa il prodotto del lotto di porzioni. */
  title: string;
  recipeId?: string;
  ingredients: readonly PrepIngredientChoice[];
  /** Porzioni prodotte, intero positivo. */
  portions: number;
  /** Dove si ripongono le porzioni. */
  location: Location;
  /** Categoria per la scadenza: avanzi cucinati (default) o piatti pronti. */
  category?: PrepCategory;
  /** Durata in giorni scelta dall'utente: prevale sulla stima del motore delle scadenze. */
  shelfDays?: number;
  /** Peso cotto diviso peso crudo, se noto. */
  cookedPerRaw?: number;
  /** Nutrienti di un ingrediente; se manca, la composizione non calcola i nutrienti. */
  nutrientsOf?: (ingredient: NutrientIngredient) => IngredientNutrients;
}

export interface PrepEventOptions {
  deviceId: string;
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  /** Quando si è cucinato (ISO UTC). Default: adesso. */
  at?: string;
  /** Fuso per il giorno di cottura. Default `Europe/Rome`. */
  timeZone?: string;
  /** Certezza di quantità e porzioni. Default `measured`: le ha contate l'utente. */
  certainty?: Certainty;
  source?: Source;
  note?: string;
}

export type ComposeErrorCode =
  | "no_ingredients"
  | "invalid_portions"
  | "invalid_title"
  | "invalid_prep_id"
  | "invalid_quantity"
  | "unit_mismatch"
  | "insufficient_quantity"
  | "lot_finished"
  | "invalid_instant"
  | "invalid_shelf_days"
  | "invalid_yield";

export interface ComposeError {
  code: ComposeErrorCode;
  lotId?: string;
  /** Per `insufficient_quantity`: richiesto e disponibile. */
  requested?: number;
  available?: number;
}

export type PrepComposedEvent = LedgerEvent | PrepEvent;

export interface ComposedPrep {
  ok: true;
  prepId: string;
  batchLotId: string;
  /** In ordine: i `consume`, il `declare`, l'eventuale `updateLot` del costo, il `prep`. */
  events: PrepComposedEvent[];
  cost: PrepCost;
  /** Presente solo se `nutrientsOf` è stata passata. */
  nutrients?: PrepNutrients;
  expiry: { date: string; kind: "estimated" };
}

export type ComposePrepResult = ComposedPrep | { ok: false; errors: ComposeError[] };

const EPS = 1e-9;

/**
 * Compone gli eventi di una preparazione, pronti da scrivere nel registro. Non scrive nulla e non
 * lancia per input sbagliati: restituisce gli errori. Per annullarla in blocco vedi `voidPrep`.
 */
export function composePrep(
  input: ComposePrepInput,
  options: PrepEventOptions,
): ComposePrepResult {
  const errors: ComposeError[] = [];
  const now = (options.now ?? (() => new Date().toISOString()))();
  const at = options.at ?? now;
  if (!isIsoInstant(at)) errors.push({ code: "invalid_instant" });
  if (typeof input.title !== "string" || input.title.trim() === "") {
    errors.push({ code: "invalid_title" });
  }
  if (input.prepId !== undefined && input.prepId.trim() === "") errors.push({ code: "invalid_prep_id" });
  if (
    !Number.isInteger(input.portions) ||
    input.portions <= 0 ||
    input.portions > PREP_LIMITS.maxPortions
  ) {
    errors.push({ code: "invalid_portions" });
  }
  if (input.ingredients.length === 0) errors.push({ code: "no_ingredients" });
  if (input.shelfDays !== undefined && (!Number.isInteger(input.shelfDays) || input.shelfDays < 0)) {
    errors.push({ code: "invalid_shelf_days" });
  }
  if (
    input.cookedPerRaw !== undefined &&
    !(Number.isFinite(input.cookedPerRaw) && input.cookedPerRaw > 0)
  ) {
    errors.push({ code: "invalid_yield" });
  }

  const used = new Map<string, number>();
  for (const { lot, quantity } of input.ingredients) {
    if (!Number.isFinite(quantity.value) || quantity.value <= 0) {
      errors.push({ code: "invalid_quantity", lotId: lot.lotId });
      continue;
    }
    if (quantity.unit !== lot.unit) {
      errors.push({ code: "unit_mismatch", lotId: lot.lotId });
      continue;
    }
    if (lot.status === "finished") {
      errors.push({ code: "lot_finished", lotId: lot.lotId });
      continue;
    }
    const total = (used.get(lot.lotId) ?? 0) + quantity.value;
    used.set(lot.lotId, total);
    if (total - lot.remaining > EPS) {
      errors.push({
        code: "insufficient_quantity",
        lotId: lot.lotId,
        requested: total,
        available: lot.remaining,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  let cookedOn: string;
  let expiry: { date: string; kind: "estimated" };
  try {
    cookedOn = toCalendarDate(at, timeZone);
    expiry = portionsExpiry({
      category: input.category ?? DEFAULT_PREP_CATEGORY,
      location: input.location,
      cookedOn,
      ...(input.shelfDays !== undefined ? { shelfDays: input.shelfDays } : {}),
    }) as { date: string; kind: "estimated" };
  } catch {
    return { ok: false, errors: [{ code: "invalid_instant" }] };
  }

  const nextId = options.idGenerator ?? generateId;
  const certainty = options.certainty ?? "measured";
  const source = options.source ?? "manual";
  const base = {
    at,
    recordedAt: now,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    source,
  };

  const cost = prepCost(
    input.ingredients.map(({ lot, quantity }) => ({ lot, quantity })),
    input.portions,
  );

  const events: PrepComposedEvent[] = [];
  const ingredients: PrepIngredient[] = input.ingredients.map(({ lot, quantity }, i) => {
    const consume: ConsumeEvent = {
      id: nextId(),
      type: "consume",
      ...base,
      certainty,
      lotId: lot.lotId,
      quantity: { value: quantity.value, unit: quantity.unit },
    };
    events.push(consume);
    const costCents = cost.ingredients[i].costCents;
    return {
      lotId: lot.lotId,
      productRef: lot.productRef,
      quantity: { value: quantity.value, unit: quantity.unit },
      consumeEventId: consume.id,
      ...(costCents !== undefined ? { costCents } : {}),
    };
  });

  const prepId = input.prepId ?? nextId();
  const batchLotId = nextId();
  const category = input.category ?? DEFAULT_PREP_CATEGORY;
  const declare: DeclareEvent = {
    id: nextId(),
    type: "declare",
    ...base,
    certainty,
    lotId: batchLotId,
    productRef: input.title.trim(),
    category,
    quantity: { value: input.portions, unit: "pz" },
    location: input.location,
    expiry,
  };
  events.push(declare);

  let priceEventId: string | undefined;
  if (cost.totalCents !== undefined) {
    const price: UpdateLotEvent = {
      id: nextId(),
      type: "updateLot",
      ...base,
      certainty: cost.certainty ?? "estimated",
      lotId: batchLotId,
      patch: { priceCents: cost.totalCents },
    };
    priceEventId = price.id;
    events.push(price);
  }

  const prep: PrepEvent = {
    id: nextId(),
    type: "prep",
    ...base,
    certainty,
    ...(options.note !== undefined ? { note: options.note } : {}),
    prepId,
    title: input.title.trim(),
    ...(input.recipeId !== undefined ? { recipeId: input.recipeId } : {}),
    portions: input.portions,
    batchLotId,
    batchEventId: declare.id,
    ...(priceEventId !== undefined ? { priceEventId } : {}),
    location: input.location,
    ingredients,
    ...(cost.totalCents !== undefined ? { costCents: cost.totalCents } : {}),
    ...(cost.partial ? { costPartial: true } : {}),
    ...(input.cookedPerRaw !== undefined ? { cookedPerRaw: input.cookedPerRaw } : {}),
  };
  if (validatePrepEvent(prep).length > 0) {
    return { ok: false, errors: [{ code: "invalid_prep_id" }] };
  }
  events.push(prep);

  const nutrients = input.nutrientsOf
    ? prepNutrients(
        input.ingredients.map(({ lot, quantity }) => ({
          lotId: lot.lotId,
          productRef: lot.productRef,
          quantity,
        })),
        input.portions,
        input.nutrientsOf,
        input.cookedPerRaw !== undefined ? { cookedPerRaw: input.cookedPerRaw } : {},
      )
    : undefined;

  return {
    ok: true,
    prepId,
    batchLotId,
    events,
    cost,
    ...(nutrients ? { nutrients } : {}),
    expiry,
  };
}
