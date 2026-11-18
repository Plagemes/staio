// La stima dell'energia di un pasto mangiato fuori casa, di cui non si conoscono gli alimenti. È un conto, non un
// parere: dice un numero, che è una stima, e da dove viene. Solo l'energia: nessun altro nutriente si può stimare così.
// Fonti e scelte del progetto: `FONTI.md`, sezione «Stima del pasto fuori casa».

import { DIARY_LIMITS, addDays, type MealKind } from "../diary";
import type { IntakeResult, MealIntake } from "./intake";
import type { ComparableDay } from "./reference";

export type OutOfHomeSize = "light" | "normal" | "large";

export const OUT_OF_HOME_SIZES: readonly OutOfHomeSize[] = ["light", "normal", "large"];

/** Quanto pesa la taglia sul pasto «normale». Scelta del progetto. */
export const OUT_OF_HOME_FACTOR: Record<OutOfHomeSize, number> = { light: 0.6, normal: 1, large: 1.5 };

/** Sotto questo numero di pasti registrati il valore personale non si usa. Scelta del progetto. */
export const OUT_OF_HOME_MIN_MEALS = 5;

/**
 * Un pasto registrato entra nel valore personale solo se vale almeno questa parte del pasto di riferimento del suo
 * momento (un quarto: 100 kcal a colazione, 200 a pranzo, 150 a cena, 50 per uno spuntino). Sotto, non è un pasto da
 * cui stimarne uno fuori casa: un caffè a colazione non dice quanto si mangia al bar. Scelta del progetto.
 */
export const OUT_OF_HOME_MIN_MEAL_SHARE = 0.25;

/**
 * Il valore personale resta tra la metà e il doppio del pasto di riferimento del momento: fuori da lì è più probabile
 * un errore di registrazione o un'abitudine che non si trasferisce a un pasto fuori casa. Scelta del progetto.
 */
export const OUT_OF_HOME_PERSONAL_RANGE = { min: 0.5, max: 2 } as const;

/** Quanti giorni indietro (oggi compreso) si guardano i pasti registrati. Scelta del progetto. */
export const OUT_OF_HOME_HISTORY_DAYS = 30;

/** Apporto di riferimento di energia per un adulto: regolamento (UE) n. 1169/2011, allegato XIII, parte B. */
export const REFERENCE_ENERGY_KCAL = 2000;

/** Quota dell'apporto di riferimento per momento. La ripartizione è una scelta del progetto, non una fonte. */
export const OUT_OF_HOME_MOMENT_SHARE: Record<MealKind, number> = {
  breakfast: 0.2,
  lunch: 0.4,
  dinner: 0.3,
  snack: 0.1,
};

/** Il pasto «normale» di riferimento per momento, in kcal: 400, 800, 600, 200. */
export const OUT_OF_HOME_REFERENCE_KCAL: Record<MealKind, number> = {
  breakfast: REFERENCE_ENERGY_KCAL * OUT_OF_HOME_MOMENT_SHARE.breakfast,
  lunch: REFERENCE_ENERGY_KCAL * OUT_OF_HOME_MOMENT_SHARE.lunch,
  dinner: REFERENCE_ENERGY_KCAL * OUT_OF_HOME_MOMENT_SHARE.dinner,
  snack: REFERENCE_ENERGY_KCAL * OUT_OF_HOME_MOMENT_SHARE.snack,
};

export interface OutOfHomeEstimate {
  /** Arrotondata alla decina. */
  energyKcal: number;
  /** `personal`: dai pasti registrati (il loro valore di mezzo); `generic`: dal valore di riferimento del momento. */
  basis: "personal" | "generic";
  /** Per `personal`: su quanti pasti è calcolato. */
  meals?: number;
}

const isEnergy = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

// Alla decina: una stima non ha cifre più fini. Mai zero, e mai oltre il limite che la validazione accetta.
const roundToTen = (kcal: number): number => Math.min(DIARY_LIMITS.energyKcalMax, Math.max(10, Math.round(kcal / 10) * 10));

/** Il valore di mezzo: a differenza della media non si sposta per un solo pasto registrato male. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `history`: l'energia dei pasti registrati in quel momento negli ultimi 30 giorni, uno per pasto, solo quelli con
 * l'energia nota per tutte le voci e senza stime «fuori casa» dentro (vedi `mealEnergyHistory`).
 *
 * Contano i pasti che valgono almeno un quarto del pasto di riferimento del momento (`OUT_OF_HOME_MIN_MEAL_SHARE`).
 * Con almeno cinque: il loro valore di mezzo (la mediana, non la media), tenuto tra la metà e il doppio del pasto di
 * riferimento (`OUT_OF_HOME_PERSONAL_RANGE`), per il fattore della taglia. Con meno: il valore di riferimento del
 * momento per il fattore. Il risultato non dice nulla di proteine, grassi o altro.
 */
export function estimateOutOfHome(kind: MealKind, size: OutOfHomeSize, history: readonly number[]): OutOfHomeEstimate {
  const factor = OUT_OF_HOME_FACTOR[size];
  const reference = OUT_OF_HOME_REFERENCE_KCAL[kind];
  const smallest = reference * OUT_OF_HOME_MIN_MEAL_SHARE;
  const known = history.filter((v) => isEnergy(v) && v >= smallest);
  if (known.length >= OUT_OF_HOME_MIN_MEALS) {
    const typical = Math.min(reference * OUT_OF_HOME_PERSONAL_RANGE.max, Math.max(reference * OUT_OF_HOME_PERSONAL_RANGE.min, median(known)));
    return { energyKcal: roundToTen(typical * factor), basis: "personal", meals: known.length };
  }
  return { energyKcal: roundToTen(reference * factor), basis: "generic" };
}

/**
 * L'energia di un pasto, solo se si conosce per ogni sua voce, nessuna è una stima «fuori casa» e il pasto non è
 * fatto solo di bevande (tutte le voci in millilitri).
 */
function knownMealEnergy(meal: MealIntake): number | undefined {
  if (meal.lines.length === 0) return undefined;
  if (meal.lines.every((line) => line.quantity.unit === "ml")) return undefined;
  for (const line of meal.lines) {
    // una stima fatta sui pasti registrati non deve rientrare tra quelli: si ripeterebbe da sola
    if (line.status !== "ok" || line.outOfHome === true || typeof line.nutrients.energyKcal !== "number") return undefined;
  }
  const total = meal.totals.energyKcal;
  if (total === undefined || total.partial || !isEnergy(total.value)) return undefined;
  // un pasto minimo (un caffè, un biscotto) non è un pasto da cui stimarne uno fuori casa
  return total.value >= OUT_OF_HOME_REFERENCE_KCAL[meal.kind] * OUT_OF_HOME_MIN_MEAL_SHARE ? total.value : undefined;
}

/**
 * La storia su cui si calcola la stima: l'energia di ogni pasto registrato nel momento `kind` negli ultimi 30 giorni
 * fino a `today` (`YYYY-MM-DD`, compreso), uno per pasto, in ordine di data. Restano fuori i pasti con anche una sola
 * voce senza energia, quelli che contengono una stima «fuori casa», quelli fatti solo di bevande e quelli sotto un
 * quarto del pasto di riferimento del momento.
 */
export function mealEnergyHistory(result: Pick<IntakeResult, "days">, kind: MealKind, today: string): number[] {
  const from = addDays(today, -(OUT_OF_HOME_HISTORY_DAYS - 1));
  const out: number[] = [];
  for (const day of result.days) {
    if (day.date < from || day.date > today) continue;
    for (const meal of day.meals) {
      if (meal.kind !== kind) continue;
      const energy = knownMealEnergy(meal);
      if (energy !== undefined) out.push(energy);
    }
  }
  return out;
}

/**
 * Quanta parte dell'energia di un giorno è una stima «fuori casa», da 0 a 1. Zero se nel giorno non ce ne sono; 1 se
 * c'è una stima ma l'energia del giorno non si conosce. Serve a chi usa l'energia del giorno per un conto: sopra una
 * certa quota il numero del giorno è in buona parte un valore generico, non ciò che si è mangiato.
 */
export function outOfHomeEnergyShare(day: Pick<ComparableDay, "totals" | "outOfHome">): number {
  if (!day.outOfHome) return 0;
  const energy = day.totals.energyKcal?.value;
  if (energy === undefined || !(energy > 0)) return 1;
  return Math.min(1, Math.max(0, day.outOfHome.energyKcal / energy));
}
