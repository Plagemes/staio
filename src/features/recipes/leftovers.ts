// Dopo la cottura: di N porzioni ne mangio K adesso, le altre N-K vanno in frigo o in freezer. Una sola lista di eventi:
// ogni ingrediente confermato si divide in due parti (K/N al pasto, il resto alle porzioni), così niente si consuma due volte
// e la somma delle due parti è esattamente la quantità confermata. Logica pura.
import type { MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { IdGenerator, Location, Lot, Quantity, Unit } from "@/core/ledger";
import { composePrep } from "@/core/prep";
import { formatQuantity } from "@/core/units";
import { parseAmountForLot } from "../actions";
import { readQuantity } from "../capture";
import { MEAL_KIND_LABELS, buildMealEvents, type FreeItemInput, type MealErrors } from "../meals";
import { mapComposeErrors } from "../prep/compose";
import { dayMonth } from "../plan/dates";
import { dishRatingEvent, type DishVote } from "./dishRating";

/** Dove si mettono le porzioni che avanzano. */
export type LeftoverPlace = Extract<Location, "frigo" | "freezer">;

export const LEFTOVER_PLACES: readonly { id: LeftoverPlace; label: string }[] = [
  { id: "frigo", label: "Frigo" },
  { id: "freezer", label: "Freezer" },
];

export const NEEDS_PANTRY_ITEM = "Per mettere da parte le porzioni serve almeno un ingrediente dalla dispensa.";

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Il passo con cui si arrotonda la parte che si mangia: come i tasti di `QuantityPicker`, ma a mezzo pezzo per i pezzi. */
const SPLIT_STEP: Record<Unit, number> = { g: 1, ml: 1, pz: 0.5 };

/**
 * Divide una quantità tra il pasto (`eaten` porzioni su `servings`) e le porzioni che avanzano. La parte del pasto si
 * arrotonda; il resto è la differenza, quindi `meal + rest` è sempre `total` e nessuna delle due supera il totale.
 */
export function splitQuantity(total: number, unit: Unit, eaten: number, servings: number): { meal: number; rest: number } {
  const step = SPLIT_STEP[unit];
  const raw = (total * eaten) / servings;
  const meal = Math.min(total, Math.max(0, round(Math.round(raw / step) * step, 6)));
  return { meal, rest: round(total - meal, 6) };
}

/** «Ne restano solo 200 g.» diventa «Ne restano solo 200 g: correggi la quantità.» */
export function shortageText(error: string): string {
  return error.startsWith("Ne restano solo") ? `${error.replace(/\.$/, "")}: correggi la quantità.` : error;
}

/** La quantità di una voce scritta a mano, scalata a K/N. Se non si legge resta com'è: la rifiuta chi costruisce il pasto. */
function scaleFree(item: FreeItemInput, eaten: number, servings: number): FreeItemInput {
  const read = readQuantity(item.quantityText);
  if (!read.ok) return item;
  const value = round((read.quantity.value * eaten) / servings, 2);
  return { ...item, quantityText: formatQuantity({ value: value > 0 ? value : read.quantity.value, unit: read.quantity.unit }) };
}

export interface LeftoverInput {
  kind: MealKind;
  recipeId: string;
  title: string;
  /** Le porzioni cotte (N, intero da 2 in su). */
  servings: number;
  /** Quelle che si mangiano adesso (K, da 1 a N-1). */
  eaten: number;
  place: LeftoverPlace;
  /** I lotti come sono adesso in archivio, con la quantità scritta per ognuno (già per tutte le N porzioni). */
  picks: readonly { lot: Lot; quantityText: string }[];
  freeItems: readonly FreeItemInput[];
  vote: DishVote;
}

export interface LeftoverContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type LeftoverResult =
  | { ok: true; events: AnyEvent[]; mealId: string; prepId: string; expiry: string; kept: number; message: string }
  | { ok: false; errors: MealErrors };

const portionsText = (n: number): string => (n === 1 ? "1 porzione" : `${n} porzioni`);

/** «Registrato: pranzo con Pasta al forno. 3 porzioni in frigo, fino al 20 nov.» */
export function leftoverMessage(kind: MealKind, title: string, kept: number, place: LeftoverPlace, expiry: string): string {
  return `Registrato: ${MEAL_KIND_LABELS[kind].toLowerCase()} con ${title}. ${portionsText(kept)} in ${place}, fino al ${dayMonth(expiry)}.`;
}

/**
 * Pasto, porzioni e voto in una sola lista. Il pasto prende K/N di ogni ingrediente (e delle voci a mano), le porzioni
 * il resto (`composePrep`, che consuma senza `mealId` e dichiara il lotto con la scadenza stimata). I nutrienti del pasto
 * sono quelli delle parti mangiate.
 */
export function leftoverEvents(input: LeftoverInput, ctx: LeftoverContext): LeftoverResult {
  const kept = input.servings - input.eaten;
  const fail = (errors: Partial<MealErrors>): LeftoverResult => ({ ok: false, errors: { picks: {}, free: {}, ...errors } });
  if (!Number.isInteger(input.servings) || !Number.isInteger(input.eaten) || input.eaten < 1 || kept < 1) {
    return fail({ general: "Le porzioni mangiate vanno da 1 a una meno di quelle cotte." });
  }

  const picksErrors: Record<string, string> = {};
  const mealPicks: { lot: Lot; choice: { kind: "value"; value: number } }[] = [];
  const prepIngredients: { lot: Lot; quantity: Quantity }[] = [];
  for (const pick of input.picks) {
    const amount = parseAmountForLot(pick.quantityText, pick.lot);
    if (!amount.ok) {
      picksErrors[pick.lot.lotId] = shortageText(amount.error);
      continue;
    }
    const { meal, rest } = splitQuantity(amount.quantity.value, pick.lot.unit, input.eaten, input.servings);
    if (meal > 0) mealPicks.push({ lot: pick.lot, choice: { kind: "value", value: meal } });
    if (rest > 0) prepIngredients.push({ lot: pick.lot, quantity: { value: rest, unit: pick.lot.unit } });
  }
  if (Object.keys(picksErrors).length > 0) return fail({ picks: picksErrors });
  if (prepIngredients.length === 0) return fail({ general: NEEDS_PANTRY_ITEM });

  const meal = buildMealEvents(
    {
      kind: input.kind,
      title: input.title,
      picks: mealPicks,
      freeItems: input.freeItems.map((f) => scaleFree(f, input.eaten, input.servings)),
    },
    { now: ctx.now, deviceId: ctx.deviceId, ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}) },
  );
  if (!meal.ok) return { ok: false, errors: meal.errors };

  const prep = composePrep(
    { title: input.title, recipeId: input.recipeId, ingredients: prepIngredients, portions: kept, location: input.place },
    { deviceId: ctx.deviceId, now: () => ctx.now, ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}) },
  );
  if (!prep.ok) {
    const mapped = mapComposeErrors(prep.errors);
    return fail({ picks: mapped.picks, ...(mapped.general ? { general: mapped.general } : {}) });
  }

  const rated = dishRatingEvent(meal.mealId, input.recipeId, input.vote, { now: ctx.now, deviceId: ctx.deviceId, ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}) });
  return {
    ok: true,
    events: [...meal.events, ...prep.events, ...(rated.ok ? [rated.event] : [])],
    mealId: meal.mealId,
    prepId: prep.prepId,
    expiry: prep.expiry.date,
    kept,
    message: leftoverMessage(input.kind, input.title, kept, input.place, prep.expiry.date),
  };
}

/** Il riassunto della riga richiusa: «No» oppure «Sì, 3 porzioni in frigo». */
export function leftoverSummary(open: boolean, kept: number, place: LeftoverPlace): string {
  return open && kept > 0 ? `Sì, ${portionsText(kept)} in ${place}` : "No";
}
