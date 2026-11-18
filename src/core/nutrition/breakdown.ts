// «Da cosa è fatto»: le parti di un numero già calcolato da `computeIntake`. Qui non si ricalcola niente: si leggono
// le righe del giorno (voci dei pasti, consumi senza pasto, bevande) e i totali così come sono.

import type { MealKind } from "../diary";
import { addDays } from "../diary";
import type { Certainty, Quantity } from "../ledger";
import { roundValue } from "./amounts";
import type { DayIntake, DrinkIntake, IntakeLine } from "./intake";
import type { NutrientKey } from "./types";

export interface BreakdownPart {
  /** Nome della voce: alimento, voce libera, bevanda. */
  label: string;
  /** Quanto porta di questo nutriente; undefined = la voce non ha il dato (non vale zero). */
  value: number | undefined;
  /** Certezza della voce (`measured`, `label`, `estimated`); assente se la voce non ha il dato. */
  certainty?: Certainty;
  /** Dove sta: l'evento (il `consume`, il `meal` di una voce libera, il `drink`) e, per le voci libere, la posizione. */
  eventId: string;
  itemIndex?: number;
  date: string;
  /** Il momento del pasto, se la voce sta in un pasto. */
  mealKind?: MealKind;
  /** Stima «fuori casa»: porta la sola energia. */
  outOfHome?: true;
  /** Quanto è stato mangiato o bevuto (una bevanda in ml). */
  quantity?: Quantity;
  /** Che cosa è: voce libera di un pasto, consumo di dispensa, bevanda. */
  kind: "mealItem" | "pantry" | "drink";
  /** L'alimento o il prodotto a cui è stata associata la voce (per esempio una porzione di preparazione), se c'è. */
  ref?: string;
}

export interface DayBreakdown {
  nutrient: NutrientKey;
  date: string;
  /** Il totale che la schermata mostra per quel giorno: lo stesso numero di `day.totals`. */
  total: number | undefined;
  /** Le voci con il dato, dalla più grande. */
  parts: BreakdownPart[];
  /** Le voci senza il dato per questo nutriente (non riconosciute, o riconosciute ma senza quel valore). */
  missing: BreakdownPart[];
  /** Somma di `parts`: deve coincidere con `total` (a meno dell'arrotondamento). */
  sum: number;
}

/** La stessa regola di `sumNutrients`: un valore conta se è un numero finito e non negativo. */
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function lineValue(line: IntakeLine, nutrient: NutrientKey): number | undefined {
  if (line.status !== "ok") return undefined;
  const v = line.nutrients[nutrient];
  return isAmount(v) ? v : undefined;
}

function partOfLine(line: IntakeLine, nutrient: NutrientKey, date: string, mealKind: MealKind | undefined): BreakdownPart {
  const value = lineValue(line, nutrient);
  const ref = line.status === "ok" ? line.composition.ref : undefined;
  return {
    label: line.label,
    value,
    ...(value !== undefined && line.status === "ok" ? { certainty: line.certainty } : {}),
    eventId: line.eventId,
    ...(line.itemIndex !== undefined ? { itemIndex: line.itemIndex } : {}),
    date,
    ...(mealKind !== undefined ? { mealKind } : {}),
    ...(line.status === "ok" && line.outOfHome === true ? { outOfHome: true as const } : {}),
    quantity: line.quantity,
    kind: line.kind,
    ...(ref !== undefined ? { ref } : {}),
  };
}

/** Il valore che una bevanda dichiara per questo nutriente. Le bevande parlano solo di ciò che dichiarano (`scope`). */
function drinkValue(d: DrinkIntake, nutrient: NutrientKey): number | undefined {
  const v =
    nutrient === "caffeineMg" ? d.caffeineMg : nutrient === "alcoholG" ? d.alcoholG : nutrient === "energyKcal" ? d.energyKcal : nutrient === "sugarsG" ? d.sugarsG : undefined;
  return isAmount(v) ? v : undefined;
}

const byValue = (a: BreakdownPart, b: BreakdownPart) => (b.value ?? 0) - (a.value ?? 0);

/**
 * Le voci che fanno il totale di un nutriente in un giorno, e quelle che non contano perché non ne hanno il dato.
 * Le bevande stanno tra le parti solo se dichiarano quel nutriente: una bevanda che non lo dichiara non è un dato
 * mancante (come nella somma del giorno), quindi non compare.
 */
export function dayBreakdown(day: DayIntake, nutrient: NutrientKey): DayBreakdown {
  const all: BreakdownPart[] = [];
  for (const meal of day.meals) for (const line of meal.lines) all.push(partOfLine(line, nutrient, day.date, meal.kind));
  for (const line of day.standalone) all.push(partOfLine(line, nutrient, day.date, undefined));
  const parts = all.filter((p) => p.value !== undefined);
  const missing = all.filter((p) => p.value === undefined);
  for (const d of day.drinks) {
    const value = drinkValue(d, nutrient);
    if (value === undefined) continue;
    parts.push({ label: d.name, value, certainty: d.certainty, eventId: d.eventId, date: day.date, quantity: { value: d.ml, unit: "ml" }, kind: "drink" });
  }
  // `sort` è stabile: a parità resta l'ordine del giorno
  parts.sort(byValue);
  return {
    nutrient,
    date: day.date,
    total: day.totals[nutrient]?.value,
    parts,
    missing,
    sum: roundValue(parts.reduce((s, p) => s + (p.value ?? 0), 0)),
  };
}

export type DayCount =
  | {
      date: string;
      counted: true;
      value: number | undefined;
      outOfHome: boolean;
      /** Certezza del totale del giorno, se c'è il dato. */
      certainty?: Certainty;
      /** Il totale del giorno è un minimo: una parte delle voci non ha il dato. */
      partial?: boolean;
    }
  | { date: string; counted: false; why: "nothing" | "missing_meals" | "untracked_meals" | "empty_meals"; missingKinds?: MealKind[] };

export interface PeriodBreakdown {
  nutrient: NutrientKey;
  /** Un elemento per **ogni** giorno del periodo, anche quelli senza niente, dal più recente. */
  days: DayCount[];
  /** Giorni che entrano nella media di questo nutriente: completi e con il dato (gli stessi di `averageIntake`). */
  counted: number;
  /** Giorni completi del periodo, con o senza il dato di questo nutriente: «Giorni contati». */
  complete: number;
  /** La media sui giorni contati: lo stesso numero che la schermata mostra. */
  average: number | undefined;
}

/** Un giorno senza pasti, consumi, bevande né dichiarazioni: per i nutrienti non c'è niente. */
function isEmptyDay(d: DayIntake): boolean {
  return d.meals.length === 0 && d.standalone.length === 0 && d.drinks.length === 0 && d.coverage.untracked === 0 && d.coverage.skipped.length === 0;
}

function countOf(d: DayIntake | undefined, date: string, nutrient: NutrientKey): DayCount {
  if (d === undefined || isEmptyDay(d)) return { date, counted: false, why: "nothing" };
  if (d.complete) {
    const t = d.totals[nutrient];
    return { date, counted: true, value: t?.value, outOfHome: d.outOfHome !== undefined, ...(t ? { certainty: t.certainty, partial: t.partial } : {}) };
  }
  // un motivo solo: prima ciò che manca, poi i pasti senza dettagli, poi quelli senza voci
  if (d.reasons.includes("missing_meals")) return { date, counted: false, why: "missing_meals", missingKinds: [...d.coverage.missing] };
  if (d.reasons.includes("untracked_meals")) return { date, counted: false, why: "untracked_meals" };
  return { date, counted: false, why: "empty_meals" };
}

/**
 * Ogni giorno del periodo (estremi inclusi), dal più recente: contato o no, e perché. Un giorno conta se è completo
 * (`DayIntake.complete`, la stessa regola delle medie): la media è quella di `averageIntake`, sui giorni completi che
 * hanno il dato di questo nutriente.
 */
export function periodBreakdown(days: readonly DayIntake[], range: { from: string; to: string }, nutrient: NutrientKey): PeriodBreakdown {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: DayCount[] = [];
  for (let date = range.to; date >= range.from; date = addDays(date, -1)) out.push(countOf(byDate.get(date), date, nutrient));
  const withData = out.flatMap((d) => (d.counted && d.value !== undefined ? [d.value] : []));
  return {
    nutrient,
    days: out,
    counted: withData.length,
    complete: out.filter((d) => d.counted).length,
    average: withData.length === 0 ? undefined : Math.round((withData.reduce((s, x) => s + x, 0) / withData.length) * 1e6) / 1e6,
  };
}
