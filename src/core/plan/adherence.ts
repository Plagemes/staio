// Pianificato contro reale: confronta le voci del piano con i pasti registrati nel diario.
// Solo sui giorni tracciati: un giorno con vuoti non dice cosa è stato mangiato, quindi non si
// giudica (non è "saltato") e si conta a parte.

import type { Quantity } from "../ledger";
import {
  dayCoverage,
  getDay,
  mealMoments,
  mealsWithPantry,
  MEAL_KINDS,
  type DiaryMeal,
  type DiaryState,
  type MealKind,
} from "../diary";
import { weekDates } from "./calendar";
import { getWeek, type PlanState } from "./derive";
import { foodKeys, type ExpandRef } from "./refs";
import type { PlannedEntry } from "./types";

export type EntryStatus =
  /** Mangiato come pianificato (anche in un altro pasto dello stesso giorno: `otherSlot`). */
  | "respected"
  /** Al suo posto è stato mangiato altro. */
  | "substituted"
  /** Nel pasto non c'è, e non c'è niente al suo posto. */
  | "skipped"
  /** Non si può dire: ricetta non espandibile, o pasto dichiarato ma non tracciato. */
  | "unverifiable";

export interface ActualItem {
  name: string;
  foodId?: string;
  quantity: Quantity;
  mealId: string;
  /** Da dove viene il dato: voce libera del pasto o consumo di un lotto della dispensa. */
  from: "diary" | "pantry";
  lotId?: string;
}

export interface EntryResult {
  date: string;
  meal: MealKind;
  planned: PlannedEntry["item"];
  status: EntryStatus;
  /** Cosa corrisponde (rispettato) o cosa è stato mangiato al posto (sostituito). */
  actual: ActualItem[];
  /** Rispettato, ma in un altro pasto del giorno. */
  otherSlot?: true;
  /** Quantità mangiata / quantità pianificata, se le unità coincidono (solo per gli alimenti). */
  quantityRatio?: number;
  /**
   * Per `skipped`: il momento è stato dichiarato «saltato». Il pasto pianificato risulta non fatto
   * (e non scala nulla dalla dispensa); non viene spostato da solo.
   */
  declaredSkipped?: true;
  /** Motivo, per `unverifiable`. */
  reason?: "unresolved_ref" | "untracked_meal";
}

export interface AdherenceCounts {
  respected: number;
  substituted: number;
  skipped: number;
  /** Voci mangiate che il piano non prevede. */
  extra: number;
  unverifiable: number;
}

export interface AdherenceDay {
  date: string;
  entries: EntryResult[];
  extras: (ActualItem & { meal: MealKind })[];
  counts: AdherenceCounts;
}

export interface AdherenceWeek {
  weekStart: string;
  /** Solo i giorni tracciati con voci pianificate, in ordine di data. */
  days: AdherenceDay[];
  /** Giorni esclusi dal confronto, contati a parte. */
  excluded: {
    /** Giorni con tutti i pasti principali ma almeno uno dichiarato e non tracciato. */
    declared: string[];
    /** Giorni con pasti principali mancanti, né tracciati né dichiarati. */
    gaps: string[];
    /** Giorni senza voci pianificate. */
    unplanned: string[];
  };
  totals: AdherenceCounts;
  /** Rispettate / (rispettate + sostituite + saltate); assente se nessuna voce è giudicabile. */
  rate?: number;
}

export interface LotRef {
  productRef: string;
  /** Preparazione di cui il lotto è il lotto di porzioni. */
  prepId?: string;
}

export interface AdherenceOptions {
  /** Registro intero, per i consumi di dispensa dei pasti (`mealId`). Senza, contano solo le voci libere. */
  events?: Iterable<unknown>;
  /** Prodotto e preparazione di ogni lotto, per riconoscere i consumi di dispensa. */
  lots?: ReadonlyMap<string, LotRef>;
  /** Per giudicare le voci di tipo ricetta (il diario non conosce le ricette). */
  expand?: ExpandRef;
}

const emptyCounts = (): AdherenceCounts => ({
  respected: 0,
  substituted: 0,
  skipped: 0,
  extra: 0,
  unverifiable: 0,
});

interface Evidence extends ActualItem {
  meal: MealKind;
  keys: string[];
  prepId?: string;
  used: boolean;
}

function evidenceOf(meal: DiaryMeal, consumes: readonly { lotId: string; quantity: Quantity }[], lots?: ReadonlyMap<string, LotRef>): Evidence[] {
  const out: Evidence[] = [];
  for (const item of meal.items) {
    out.push({
      name: item.name,
      ...(item.foodId !== undefined ? { foodId: item.foodId } : {}),
      quantity: item.quantity,
      mealId: meal.mealId,
      from: "diary",
      meal: meal.kind,
      keys: foodKeys(item),
      used: false,
    });
  }
  for (const c of consumes) {
    const ref = lots?.get(c.lotId);
    out.push({
      name: ref?.productRef ?? c.lotId,
      quantity: c.quantity,
      mealId: meal.mealId,
      from: "pantry",
      lotId: c.lotId,
      meal: meal.kind,
      keys: ref ? [...foodKeys({ name: ref.productRef }), `id:${ref.productRef.trim().toLowerCase()}`] : [],
      ...(ref?.prepId !== undefined ? { prepId: ref.prepId } : {}),
      used: false,
    });
  }
  return out;
}

const actualOf = ({ name, foodId, quantity, mealId, from, lotId }: Evidence): ActualItem => ({
  name,
  ...(foodId !== undefined ? { foodId } : {}),
  quantity,
  mealId,
  from,
  ...(lotId !== undefined ? { lotId } : {}),
});

const sameKey = (a: readonly string[], b: readonly string[]): boolean => a.some((k) => b.includes(k));

/** Cerca tra le prove non ancora usate ciò che corrisponde alla voce. */
function findMatch(
  entry: PlannedEntry,
  pool: readonly Evidence[],
  expand: ExpandRef | undefined,
): { items: Evidence[] } | "unresolved" | undefined {
  const item = entry.item;
  if (item.kind === "food") {
    const keys = foodKeys(item);
    const hit = pool.find((e) => !e.used && sameKey(keys, e.keys));
    return hit ? { items: [hit] } : undefined;
  }
  if (item.kind === "prep") {
    const hit = pool.find((e) => !e.used && e.prepId === item.prepId);
    return hit ? { items: [hit] } : undefined;
  }
  const ingredients = expand?.({ kind: "recipe", id: item.recipeId }, item.servings);
  if (!ingredients || ingredients.length === 0) return "unresolved";
  const taken: Evidence[] = [];
  for (const ing of ingredients) {
    const keys = foodKeys(ing);
    const hit = pool.find((e) => !e.used && !taken.includes(e) && sameKey(keys, e.keys));
    if (!hit) return undefined;
    taken.push(hit);
  }
  return { items: taken };
}

function plannedQuantity(entry: PlannedEntry): Quantity | undefined {
  return entry.item.kind === "food" ? entry.item.quantity : undefined;
}

function ratioOf(entry: PlannedEntry, items: readonly Evidence[]): number | undefined {
  const planned = plannedQuantity(entry);
  if (!planned || items.length === 0) return undefined;
  if (!items.every((e) => e.quantity.unit === planned.unit)) return undefined;
  const sum = items.reduce((s, e) => s + e.quantity.value, 0);
  return Math.round((sum / planned.value) * 1e6) / 1e6;
}

function compareDay(
  date: string,
  planned: readonly PlannedEntry[],
  meals: readonly DiaryMeal[],
  declaredKinds: ReadonlySet<MealKind>,
  skippedKinds: ReadonlySet<MealKind>,
  consumesOf: (mealId: string) => readonly { lotId: string; quantity: Quantity }[],
  options: AdherenceOptions,
): AdherenceDay {
  const evidence = meals.flatMap((m) => evidenceOf(m, consumesOf(m.mealId), options.lots));
  const results = new Map<number, EntryResult>();
  const unverifiableSlots = new Set<MealKind>();

  const setResult = (i: number, r: Omit<EntryResult, "date" | "meal" | "planned">): void => {
    results.set(i, { date, meal: planned[i].meal, planned: planned[i].item, ...r });
  };

  // 1. Nel pasto previsto.
  planned.forEach((entry, i) => {
    const slot = evidence.filter((e) => e.meal === entry.meal);
    const m = findMatch(entry, slot, options.expand);
    if (m === "unresolved") {
      unverifiableSlots.add(entry.meal);
      setResult(i, { status: "unverifiable", actual: [], reason: "unresolved_ref" });
    } else if (m) {
      m.items.forEach((e) => (e.used = true));
      const ratio = ratioOf(entry, m.items);
      setResult(i, {
        status: "respected",
        actual: m.items.map(actualOf),
        ...(ratio !== undefined ? { quantityRatio: ratio } : {}),
      });
    }
  });
  // 2. In un altro pasto dello stesso giorno.
  planned.forEach((entry, i) => {
    if (results.has(i)) return;
    const m = findMatch(entry, evidence, options.expand);
    if (m && m !== "unresolved") {
      m.items.forEach((e) => (e.used = true));
      const ratio = ratioOf(entry, m.items);
      setResult(i, {
        status: "respected",
        actual: m.items.map(actualOf),
        otherSlot: true,
        ...(ratio !== undefined ? { quantityRatio: ratio } : {}),
      });
    }
  });
  // 3. Sostituito (al suo posto qualcos'altro nello stesso pasto) o saltato.
  planned.forEach((entry, i) => {
    if (results.has(i)) return;
    const leftover = unverifiableSlots.has(entry.meal)
      ? undefined
      : evidence.find((e) => !e.used && e.meal === entry.meal);
    if (leftover) {
      leftover.used = true;
      setResult(i, { status: "substituted", actual: [actualOf(leftover)] });
    } else if (
      declaredKinds.has(entry.meal) &&
      !meals.some((m) => m.kind === entry.meal)
    ) {
      setResult(i, { status: "unverifiable", actual: [], reason: "untracked_meal" });
    } else if (unverifiableSlots.has(entry.meal)) {
      setResult(i, { status: "unverifiable", actual: [], reason: "unresolved_ref" });
    } else {
      setResult(i, {
        status: "skipped",
        actual: [],
        ...(skippedKinds.has(entry.meal) && !meals.some((m) => m.kind === entry.meal) ? { declaredSkipped: true as const } : {}),
      });
    }
  });

  const entries = planned.map((_, i) => results.get(i)!);
  const extras = evidence
    .filter((e) => !e.used && !unverifiableSlots.has(e.meal))
    .map((e) => ({ ...actualOf(e), meal: e.meal }));

  const counts = emptyCounts();
  for (const r of entries) counts[r.status]++;
  counts.extra = extras.length;
  return { date, entries, extras, counts };
}

function consumesLookup(
  diary: DiaryState,
  options: AdherenceOptions,
): (mealId: string) => readonly { lotId: string; quantity: Quantity }[] {
  const consumesByMeal = new Map<string, { lotId: string; quantity: Quantity }[]>();
  if (options.events) {
    for (const m of mealsWithPantry(diary, options.events)) {
      consumesByMeal.set(
        m.mealId,
        m.pantryConsumes.map((c) => ({ lotId: c.lotId, quantity: c.quantity })),
      );
    }
  }
  return (mealId) => consumesByMeal.get(mealId) ?? [];
}

function compareDayOf(
  date: string,
  planned: readonly PlannedEntry[],
  diary: DiaryState,
  consumesOf: (mealId: string) => readonly { lotId: string; quantity: Quantity }[],
  options: AdherenceOptions,
): AdherenceDay {
  const day = getDay(diary, date);
  const moments = mealMoments(day);
  const declaredKinds = new Set<MealKind>([
    ...(day?.untrackedMeals ?? []).map((m) => m.kind),
    ...moments.filter((m) => m.status === "untracked").map((m) => m.kind),
  ]);
  const skippedKinds = new Set<MealKind>(moments.filter((m) => m.status === "skipped").map((m) => m.kind));
  const kindOrder = new Map<string, number>(MEAL_KINDS.map((k, i) => [k, i]));
  const sorted = [...planned].sort((a, b) => (kindOrder.get(a.meal) ?? 99) - (kindOrder.get(b.meal) ?? 99));
  return compareDay(date, sorted, day?.meals ?? [], declaredKinds, skippedKinds, consumesOf, options);
}

/**
 * Il confronto di un solo giorno, anche se non è tracciato per intero: serve a chi deve sapere se una voce del piano è
 * stata mangiata (anche in un altro momento del giorno) mentre il giorno è ancora aperto. Le voci sono quelle del giorno.
 */
export function compareDayEntries(
  date: string,
  planned: readonly PlannedEntry[],
  diary: DiaryState,
  options: AdherenceOptions = {},
): AdherenceDay {
  return compareDayOf(
    date,
    planned.filter((e) => e.date === date),
    diary,
    consumesLookup(diary, options),
    options,
  );
}

/**
 * Confronto di una settimana di piano con il diario. Solo i giorni con voci pianificate e con
 * colazione, pranzo e cena tracciati sono confrontati; gli altri sono elencati in `excluded`.
 * Il confronto è sull'identità degli alimenti (identificativo di tabella o nome normalizzato),
 * non sulle quantità: il rapporto tra quantità mangiata e pianificata è riportato a parte.
 * Più pasti dello stesso tipo nello stesso giorno formano un unico pasto.
 */
export function compareWeek(
  state: PlanState,
  weekStart: string,
  diary: DiaryState,
  options: AdherenceOptions = {},
): AdherenceWeek {
  const week = getWeek(state, weekStart);
  const consumesOf = consumesLookup(diary, options);

  const days: AdherenceDay[] = [];
  const excluded = { declared: [] as string[], gaps: [] as string[], unplanned: [] as string[] };
  for (const date of weekDates(weekStart)) {
    const planned = (week?.entries ?? []).filter((e) => e.date === date);
    if (planned.length === 0) {
      excluded.unplanned.push(date);
      continue;
    }
    const day = getDay(diary, date);
    const coverage = dayCoverage(day, date);
    if (coverage.status === "declared") {
      excluded.declared.push(date);
      continue;
    }
    if (coverage.status === "gaps") {
      excluded.gaps.push(date);
      continue;
    }
    days.push(compareDayOf(date, planned, diary, consumesOf, options));
  }

  const totals = emptyCounts();
  for (const d of days) for (const k of Object.keys(totals) as (keyof AdherenceCounts)[]) totals[k] += d.counts[k];
  const judged = totals.respected + totals.substituted + totals.skipped;
  return {
    weekStart,
    days,
    excluded,
    totals,
    ...(judged > 0 ? { rate: Math.round((totals.respected / judged) * 1e6) / 1e6 } : {}),
  };
}

export function getAdherenceDay(week: AdherenceWeek, date: string): AdherenceDay | undefined {
  return week.days.find((d) => d.date === date);
}
