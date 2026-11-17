// Registri costruiti per i test delle analisi. Tutti i dati sono inventati.
import { addDays, deriveDiary } from "../diary";
import { drink, meal, mood, symptom, untracked, weight, seededRandom } from "../diary/test-helpers";
import type { MealKind } from "../diary";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";

export { seededRandom, shuffled } from "../diary/test-helpers";

/** Un lunedì. */
export const D0 = "2026-03-02";

export const TZ = "UTC";

export const dateOf = (i: number): string => addDays(D0, i);
export const at = (i: number, hhmm: string): string => `${dateOf(i)}T${hhmm}:00.000Z`;

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
// Senza tabella: le voci restano non risolte ma con il loro nome. Basta per le analisi che non usano
// i nutrienti e rende molto più veloci i registri numerosi.
const lightResolver = createResolver({ foods: [], productByRef: () => undefined });

export function analyze(events: readonly unknown[]) {
  return {
    diary: deriveDiary(events, { timeZone: TZ }),
    intakeDays: computeIntake(events, resolver, { timeZone: TZ }).days,
  };
}

export function analyzeLight(events: readonly unknown[]) {
  return {
    diary: deriveDiary(events, { timeZone: TZ }),
    intakeDays: computeIntake(events, lightResolver, { timeZone: TZ }).days,
  };
}

export interface DayOptions {
  /** Energia totale del giorno in kcal, divisa in tre pasti (olio: 900 kcal per 100 g). */
  kcal?: number;
  /** Voci aggiuntive del pranzo. */
  lunchItems?: { name: string; grams?: number; foodId?: string }[];
  times?: { breakfast?: string; lunch?: string; dinner?: string };
  /** Salta questi pasti: il giorno ha vuoti. */
  skip?: MealKind[];
  /** Al posto di saltare, segna il pasto come non tracciato. */
  untrackedKinds?: MealKind[];
}

let counter = 0;
const uid = (prefix: string): string => `${prefix}-${++counter}`;

/** Un giorno con colazione, pranzo e cena. */
export function day(i: number, o: DayOptions = {}): unknown[] {
  const times = { breakfast: "07:30", lunch: "12:30", dinner: "19:30", ...o.times };
  const kcal = o.kcal ?? 2000;
  const grams = (kcal / 3 / 900) * 100;
  const out: unknown[] = [];
  for (const kind of ["breakfast", "lunch", "dinner"] as const) {
    if (o.skip?.includes(kind)) continue;
    if (o.untrackedKinds?.includes(kind)) {
      out.push(untracked(uid("u"), at(i, times[kind]), { kind }));
      continue;
    }
    const items = [
      { name: "Olio", foodId: "olio", quantity: { value: grams, unit: "g" as const }, certainty: "measured" as const },
      ...(kind === "lunch" ? (o.lunchItems ?? []) : []).map((x) => ({
        name: x.name,
        ...(x.foodId !== undefined ? { foodId: x.foodId } : {}),
        quantity: { value: x.grams ?? 100, unit: "g" as const },
        certainty: "measured" as const,
      })),
    ];
    out.push(meal(uid("m"), at(i, times[kind]), { mealId: uid("meal"), kind, items }));
  }
  return out;
}

export const weighIn = (i: number, kg: number, hhmm = "07:00") => weight(uid("w"), at(i, hhmm), { kg });
export const moodOn = (i: number, score: number, hhmm = "21:30") => mood(uid("mo"), at(i, hhmm), { score });
export const symptomOn = (i: number, kind: "digestion" | "energy" | "sleep" | "other", score: number) =>
  symptom(uid("sy"), at(i, "22:00"), { kind, score });
export const caffeineOn = (i: number, hhmm: string, mg = 80) =>
  drink(uid("dr"), at(i, hhmm), { name: "Caffè", ml: 40, caffeineMg: mg });
export const alcoholOn = (i: number, hhmm: string, g = 14) =>
  drink(uid("al"), at(i, hhmm), { name: "Vino", ml: 150, alcoholG: g });

/** Rumore gaussiano approssimato (somma di 6 uniformi) con deviazione standard `sd`. */
export function noise(random: () => number, sd: number): number {
  let s = 0;
  for (let k = 0; k < 6; k++) s += random();
  return (s - 3) * sd * Math.sqrt(2);
}

export const rng = seededRandom;
