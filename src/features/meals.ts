// Pasti: composizione degli eventi, tipo di pasto dall'ora, pasti abituali, riepilogo del giorno. Logica pura.
import {
  createHabit,
  createMeal,
  createUntrackedMeal,
  localMoment,
  type DiaryDay,
  type DiaryEventOptions,
  type DiaryHabit,
  type HabitEvent,
  type MealEvent,
  type MealItem,
  type MealKind,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import {
  SCHEMA_VERSION,
  generateId,
  validateEvent,
  worseCertainty,
  type Certainty,
  type ConsumeEvent,
  type IdGenerator,
  type Lot,
  type Quantity,
} from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { resolveAmount, type AmountChoice } from "./actions";
import { readQuantity } from "./capture";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";

export const MEAL_KIND_LABELS: Record<MealKind, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};

export const MEAL_KIND_ORDER: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];

/** I tre pasti che fanno una giornata: gli spuntini non contano. */
export const MAIN_MEALS: readonly MealKind[] = ["breakfast", "lunch", "dinner"];

/** Tipo di pasto più probabile per l'ora locale di un istante. */
export function suggestMealKind(at: string, timeZone: string = DEFAULT_TIME_ZONE): MealKind {
  const m = localMoment(at, timeZone);
  if (!m) return "snack";
  const minutes = m.minutes;
  if (minutes < 5 * 60) return "snack";
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60 + 30) return "lunch";
  if (minutes < 18 * 60 + 30) return "snack";
  if (minutes < 23 * 60) return "dinner";
  return "snack";
}

/** "08:05" nel fuso dato. */
export function localTime(at: string, timeZone: string = DEFAULT_TIME_ZONE): string | undefined {
  const m = localMoment(at, timeZone);
  if (!m) return undefined;
  const h = String(Math.floor(m.minutes / 60)).padStart(2, "0");
  const min = String(m.minutes % 60).padStart(2, "0");
  return `${h}:${min}`;
}

export function defaultHabitTitle(kind: MealKind): string {
  return { breakfast: "Solita colazione", lunch: "Solito pranzo", dinner: "Solita cena", snack: "Solito spuntino" }[kind];
}

export interface MealPick {
  lot: Lot;
  choice: AmountChoice;
}

export interface FreeItemInput {
  name: string;
  quantityText: string;
}

export interface MealInput {
  kind: MealKind;
  title?: string;
  picks: readonly MealPick[];
  freeItems: readonly FreeItemInput[];
  /** Se presente, salva anche il pasto come abituale con questo nome. */
  saveHabitAs?: string;
}

export interface MealErrors {
  /** Per `lotId`. */
  picks: Record<string, string>;
  /** Per posizione nell'elenco delle voci libere. */
  free: Record<number, string>;
  general?: string;
}

export interface MealContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type MealResult =
  | { ok: true; events: AnyEvent[]; mealId: string; message: string }
  | { ok: false; errors: MealErrors };

function options(ctx: MealContext, extra: Partial<DiaryEventOptions> = {}): DiaryEventOptions {
  return { deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: ctx.idGenerator, ...extra };
}

function consumeFor(pick: { lotId: string; quantity: Quantity; certainty: Certainty }, mealId: string, ctx: MealContext, source: "manual" | "habit") {
  const event: ConsumeEvent = {
    id: (ctx.idGenerator ?? generateId)(),
    type: "consume",
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: pick.certainty,
    source,
    lotId: pick.lotId,
    quantity: pick.quantity,
    mealId,
  };
  return event;
}

/**
 * Un pasto: un evento `meal` con le voci libere e un `consume` per ogni alimento preso dalla dispensa,
 * tutti con lo stesso `mealId`. Le voci libere valgono sempre come stime.
 */
export function buildMealEvents(input: MealInput, ctx: MealContext): MealResult {
  const errors: MealErrors = { picks: {}, free: {} };
  const consumes: { lot: Lot; quantity: Quantity; certainty: Certainty }[] = [];
  const items: MealItem[] = [];

  for (const pick of input.picks) {
    const amount = resolveAmount(pick.lot, pick.choice);
    if (!amount.ok) errors.picks[pick.lot.lotId] = amount.error;
    else consumes.push({ lot: pick.lot, quantity: amount.quantity, certainty: amount.certainty });
  }
  input.freeItems.forEach((item, index) => {
    const name = item.name.trim().replace(/\s+/g, " ");
    if (name === "" && item.quantityText.trim() === "") return;
    if (name === "") {
      errors.free[index] = "Scrivi come si chiama.";
      return;
    }
    const q = readQuantity(item.quantityText);
    if (!q.ok) errors.free[index] = q.error;
    else items.push({ name, quantity: q.quantity, certainty: "estimated" });
  });

  if (consumes.length + items.length === 0 && Object.keys(errors.picks).length + Object.keys(errors.free).length === 0) {
    errors.general = "Aggiungi almeno un alimento, dalla dispensa o scritto a mano.";
  }
  if (errors.general || Object.keys(errors.picks).length > 0 || Object.keys(errors.free).length > 0) {
    return { ok: false, errors };
  }

  let certainty: Certainty = "measured";
  for (const c of consumes) certainty = worseCertainty(certainty, c.certainty);
  for (const i of items) certainty = worseCertainty(certainty, i.certainty);

  let meal: MealEvent;
  try {
    meal = createMeal(
      { kind: input.kind, title: input.title?.trim() || undefined, items: items.length > 0 ? items : undefined },
      options(ctx, { certainty }),
    );
  } catch {
    return { ok: false, errors: { picks: {}, free: {}, general: "Non riesco a scrivere questo pasto: controlla le quantità." } };
  }
  const events: AnyEvent[] = [meal];
  for (const c of consumes) events.push(consumeFor({ lotId: c.lot.lotId, quantity: c.quantity, certainty: c.certainty }, meal.mealId, ctx, "manual"));

  const habitTitle = input.saveHabitAs?.trim();
  let habit: HabitEvent | undefined;
  if (habitTitle) {
    const habitItems: MealItem[] = [
      ...consumes.map((c) => ({ name: c.lot.productRef, quantity: c.quantity, certainty: c.certainty })),
      ...items,
    ];
    try {
      habit = createHabit(
        { habitId: (ctx.idGenerator ?? generateId)(), title: habitTitle, kind: input.kind, usualTime: localTime(ctx.now), items: habitItems },
        options(ctx),
      );
      events.push(habit);
    } catch {
      return { ok: false, errors: { picks: {}, free: {}, general: "Il nome del pasto abituale non è valido." } };
    }
  }

  for (const e of events) {
    if (e.type === "consume" && validateEvent(e).length > 0) {
      return { ok: false, errors: { picks: {}, free: {}, general: "Non riesco a scrivere questo pasto." } };
    }
  }

  const parts = [...consumes.map((c) => c.lot.productRef), ...items.map((i) => i.name)];
  const message =
    `Registrato: ${MEAL_KIND_LABELS[input.kind].toLowerCase()} con ${parts.slice(0, 3).join(", ")}` +
    (parts.length > 3 ? ` e altri ${parts.length - 3}` : "") +
    (habit ? `. Salvato come «${habit.title}»` : "") +
    ".";
  return { ok: true, events, mealId: meal.mealId, message };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export type HabitMealResult = {
  events: AnyEvent[];
  mealId: string;
  /** Voci che non si sono potute prendere (tutte o in parte) dalla dispensa. */
  missing: string[];
  message: string;
};

/**
 * Registra un pasto abituale. Ogni voce si prende dalla dispensa (prima i lotti da mangiare per primi:
 * `lots` va passato in quell'ordine) finché c'è; ciò che manca diventa una voce libera stimata, e il
 * messaggio lo dice. Il pasto si registra comunque.
 */
export function buildMealFromHabit(
  habit: Pick<DiaryHabit, "habitId" | "title" | "kind" | "items">,
  lots: readonly Lot[],
  ctx: MealContext,
): HabitMealResult {
  const left = new Map(lots.map((l) => [l.lotId, l.remaining]));
  const consumes: { lotId: string; quantity: Quantity; certainty: Certainty }[] = [];
  const free: MealItem[] = [];
  const missing: string[] = [];

  for (const item of habit.items) {
    let need = item.quantity.value;
    const matches = lots.filter(
      (l) => fold(l.productRef) === fold(item.name) && l.unit === item.quantity.unit && (left.get(l.lotId) ?? 0) > 0,
    );
    for (const lot of matches) {
      if (need <= 1e-9) break;
      const available = left.get(lot.lotId) ?? 0;
      const take = Math.min(available, need);
      left.set(lot.lotId, Math.round((available - take) * 1e9) / 1e9);
      need = Math.round((need - take) * 1e9) / 1e9;
      consumes.push({ lotId: lot.lotId, quantity: { value: take, unit: lot.unit }, certainty: item.certainty });
    }
    if (need > 1e-9) {
      free.push({ name: item.name, quantity: { value: need, unit: item.quantity.unit }, certainty: "estimated" });
      missing.push(item.name);
    }
  }

  const certainty: Certainty = [...consumes.map((c) => c.certainty), ...free.map((f) => f.certainty)].reduce(
    (a, b) => worseCertainty(a, b),
    "measured" as Certainty,
  );
  const meal = createMeal(
    { kind: habit.kind, title: habit.title, items: free.length > 0 ? free : undefined, habitId: habit.habitId },
    options(ctx, { certainty, source: "habit" }),
  );
  const events: AnyEvent[] = [meal, ...consumes.map((c) => consumeFor(c, meal.mealId, ctx, "habit"))];

  const unique = [...new Set(missing)];
  const message =
    `Registrato: ${habit.title}.` +
    (unique.length > 0
      ? ` ${unique.join(", ")} ${unique.length === 1 ? "non è" : "non sono"} più in dispensa: ${unique.length === 1 ? "l'ho aggiunto" : "li ho aggiunti"} come ${unique.length === 1 ? "voce libera stimata" : "voci libere stimate"}.`
      : "");
  return { events, mealId: meal.mealId, missing: unique, message };
}

export function buildUntrackedMeal(kind: MealKind, ctx: MealContext): { events: AnyEvent[]; message: string } {
  const event = createUntrackedMeal({ kind }, options(ctx));
  return { events: [event], message: `Segnato: ${MEAL_KIND_LABELS[kind].toLowerCase()} fuori, non tracciato.` };
}

/** Riga di testo per un alimento di un pasto: "Latte 200 ml". */
export function itemText(name: string, quantity: Quantity): string {
  return `${name} ${formatQuantity(quantity)}`;
}

export type DayStatus = "complete" | "declared" | "gaps";

export interface DaySummary {
  status: DayStatus;
  /** Colazione, pranzo e cena registrati. */
  tracked: MealKind[];
  /** Colazione, pranzo e cena segnati solo come «non tracciato». */
  untracked: MealKind[];
  /** Colazione, pranzo e cena senza niente. */
  missing: MealKind[];
  text: string;
}

function list(kinds: readonly MealKind[]): string {
  const names = kinds.map((k) => MEAL_KIND_LABELS[k].toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Stato del giorno: completo se colazione, pranzo e cena sono tracciati; dichiarato se ci sono tutti e tre
 * ma almeno uno è solo «non tracciato»; con vuoti altrimenti. Gli spuntini non contano.
 * Un vuoto non è un digiuno: il testo non lo dice mai.
 */
export function summarizeDay(day: DiaryDay | undefined): DaySummary {
  const tracked = MAIN_MEALS.filter((k) => day?.meals.some((m) => m.kind === k));
  const untracked = MAIN_MEALS.filter((k) => !tracked.includes(k) && day?.untrackedMeals.some((m) => m.kind === k));
  const missing = MAIN_MEALS.filter((k) => !tracked.includes(k) && !untracked.includes(k));
  const nothing = (day?.meals.length ?? 0) + (day?.untrackedMeals.length ?? 0) === 0;

  if (missing.length === 0 && untracked.length === 0) {
    return { status: "complete", tracked, untracked, missing, text: "Giornata completa: colazione, pranzo e cena sono registrati." };
  }
  if (missing.length === 0) {
    return {
      status: "declared",
      tracked,
      untracked,
      missing,
      text: `Giornata dichiarata: ${list(untracked)} ${untracked.length === 1 ? "è segnato" : "sono segnati"} come non tracciato. Il resto è registrato, ma il totale è incompleto.`,
    };
  }
  return {
    status: "gaps",
    tracked,
    untracked,
    missing,
    text: nothing
      ? "Ancora niente registrato oggi."
      : `Giornata con vuoti: mancano ${list(missing)}. Un vuoto non vuol dire che hai saltato il pasto.`,
  };
}
