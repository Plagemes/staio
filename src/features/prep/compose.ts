// Dal modulo «Nuova preparazione» agli eventi, e dalle porzioni al pasto. Logica pura.
import type { AnyEvent } from "@/core/events";
import type { Location, Lot } from "@/core/ledger";
import {
  DEFAULT_STATE_PREFERENCE,
  nutrientsOfQuantity,
  type CompositionResolver,
} from "@/core/nutrition";
import {
  composePrep,
  type ComposeError,
  type ComposedPrep,
  type IngredientNutrients,
  type NutrientIngredient,
  type PrepCategory,
  type PrepRecord,
} from "@/core/prep";
import { formatQuantity } from "@/core/units";
import { parseAmountForLot } from "../actions";
import { buildMealEvents, type MealContext } from "../meals";
import type { MealKind } from "@/core/diary";

export interface PrepPickInput {
  lot: Lot;
  /** "200 g", "200", "2 pz". Un numero senza unità vale come l'unità del lotto. */
  quantityText: string;
}

export interface PrepInput {
  title: string;
  recipeId?: string;
  portionsText: string;
  location: Location;
  /** Durata in giorni scelta dall'utente; vuoto = la stima del motore delle scadenze. */
  shelfDaysText: string;
  category?: PrepCategory;
  picks: readonly PrepPickInput[];
}

export interface PrepErrors {
  title?: string;
  portions?: string;
  shelfDays?: string;
  /** Per `lotId`. */
  picks: Record<string, string>;
  general?: string;
}

export interface PrepContext {
  now: string;
  deviceId: string;
  nutrientsOf?: (ingredient: NutrientIngredient) => IngredientNutrients;
}

export type PrepComposeResult = { ok: true; composed: ComposedPrep } | { ok: false; errors: PrepErrors };

/** Composizione di una preparazione dai campi del modulo: serve sia all'anteprima sia al salvataggio. */
export function composeFromInput(input: PrepInput, ctx: PrepContext): PrepComposeResult {
  const errors: PrepErrors = { picks: {} };

  const title = input.title.replace(/\s+/g, " ").trim();
  if (title === "") errors.title = "Dai un nome alla preparazione.";

  const portionsText = input.portionsText.trim();
  const portions = Number(portionsText.replace(",", "."));
  if (portionsText === "") errors.portions = "Scrivi quante porzioni ottieni.";
  else if (!Number.isInteger(portions) || portions <= 0) errors.portions = "Le porzioni sono un numero intero, da 1 in su.";
  else if (portions > 1000) errors.portions = "Sono troppe porzioni.";

  let shelfDays: number | undefined;
  if (input.shelfDaysText.trim() !== "") {
    const n = Number(input.shelfDaysText.trim());
    if (!Number.isInteger(n) || n < 0 || n > 365) errors.shelfDays = "Scrivi i giorni, da 0 a 365.";
    else shelfDays = n;
  }

  if (input.picks.length === 0) errors.general = "Scegli almeno un ingrediente dalla dispensa.";

  const choices: { lot: Lot; quantity: { value: number; unit: Lot["unit"] } }[] = [];
  for (const pick of input.picks) {
    const q = parseAmountForLot(pick.quantityText, pick.lot);
    if (!q.ok) {
      errors.picks[pick.lot.lotId] = q.error;
      continue;
    }
    choices.push({ lot: pick.lot, quantity: { value: q.quantity.value, unit: pick.lot.unit } });
  }

  if (errors.title || errors.portions || errors.shelfDays || errors.general || Object.keys(errors.picks).length > 0) {
    return { ok: false, errors };
  }

  const result = composePrep(
    {
      title,
      ...(input.recipeId ? { recipeId: input.recipeId } : {}),
      ingredients: choices,
      portions,
      location: input.location,
      ...(input.category ? { category: input.category } : {}),
      ...(shelfDays !== undefined ? { shelfDays } : {}),
      ...(ctx.nutrientsOf ? { nutrientsOf: ctx.nutrientsOf } : {}),
    },
    { deviceId: ctx.deviceId, now: () => ctx.now },
  );
  if (result.ok) return { ok: true, composed: result };
  return { ok: false, errors: mapComposeErrors(result.errors) };
}

export function mapComposeErrors(list: readonly ComposeError[]): PrepErrors {
  const errors: PrepErrors = { picks: {} };
  for (const e of list) {
    switch (e.code) {
      case "insufficient_quantity":
        if (e.lotId) errors.picks[e.lotId] = "Ne restano meno: scrivi una quantità minore.";
        break;
      case "lot_finished":
        if (e.lotId) errors.picks[e.lotId] = "Questo alimento è finito.";
        break;
      case "unit_mismatch":
      case "invalid_quantity":
        if (e.lotId) errors.picks[e.lotId] = "La quantità non è valida.";
        break;
      case "invalid_portions":
        errors.portions = "Le porzioni sono un numero intero, da 1 in su.";
        break;
      case "invalid_title":
        errors.title = "Dai un nome alla preparazione.";
        break;
      case "invalid_shelf_days":
        errors.shelfDays = "Scrivi i giorni, da 0 a 365.";
        break;
      case "no_ingredients":
        errors.general = "Scegli almeno un ingrediente dalla dispensa.";
        break;
      default:
        errors.general = "Non riesco a scrivere questa preparazione: controlla i campi.";
    }
  }
  return errors;
}

/** Nutrienti di un ingrediente della preparazione, dalla composizione che il risolutore trova per il lotto. */
export function nutrientsOfFrom(resolver: CompositionResolver): (i: NutrientIngredient) => IngredientNutrients {
  return (ing) => {
    const r = resolver({ kind: "pantry", productRef: ing.productRef, lotId: ing.lotId, preferStates: DEFAULT_STATE_PREFERENCE.pantry });
    if (!r || "failure" in r) return { ok: false, reason: "no_composition" };
    const n = nutrientsOfQuantity(r, ing.quantity, "measured");
    if (!n.ok) return { ok: false, reason: n.reason };
    return { ok: true, nutrients: n.value.nutrients, certainty: n.value.certainty, weight: n.value.amount };
  };
}

/** Testo del riepilogo di conferma: «Preparato: Ragù, 6 porzioni in freezer.». */
export function prepMessage(title: string, portions: number, location: Location): string {
  const where = { frigo: "in frigo", freezer: "in freezer", dispensa: "in credenza" }[location];
  return `Preparato: ${title.trim()}, ${portions === 1 ? "1 porzione" : `${portions} porzioni`} ${where}.`;
}

/** Una porzione mangiata dentro un pasto: scala il lotto di porzioni e registra il pasto. */
export function eatPortionInMeal(
  prep: Pick<PrepRecord, "title">,
  lot: Lot,
  kind: MealKind,
  ctx: MealContext,
): { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string } {
  if (lot.remaining < 1 - 1e-9) return { ok: false, error: "Le porzioni sono finite." };
  const result = buildMealEvents(
    { kind, title: prep.title, picks: [{ lot, choice: { kind: "text", text: "1" } }], freeItems: [] },
    ctx,
  );
  if (!result.ok) {
    const first = Object.values(result.errors.picks)[0] ?? result.errors.general ?? "Non riesco a registrare il pasto.";
    return { ok: false, error: first };
  }
  return { ok: true, events: result.events, message: `Mangiato: una porzione di ${prep.title}. Restano ${formatQuantity({ value: lot.remaining - 1, unit: "pz" })}.` };
}
