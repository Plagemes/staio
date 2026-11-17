// Aiuti per creare eventi del diario validi a partire da dati minimi.

import {
  generateId,
  SCHEMA_VERSION,
  type Certainty,
  type IdGenerator,
  type Source,
  type ValidationError,
} from "../ledger";
import type { DiaryHabit } from "./derive";
import { cloneMealItems } from "./items";
import type {
  DiaryEvent,
  DrinkEvent,
  HabitEvent,
  MealDeclarationEvent,
  MealDeclarationStatus,
  MealEvent,
  MealItem,
  MealKind,
  MoodEvent,
  SupplementEvent,
  SymptomEvent,
  SymptomKind,
  UntrackedMealEvent,
  WaterEvent,
  WeightEvent,
} from "./types";
import { validateDiaryEvent } from "./validate";

export interface DiaryEventOptions {
  /** Dispositivo che scrive. */
  deviceId: string;
  /** Default: generatore del libro mastro (tempo + casualità). */
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  /** Quando il fatto è avvenuto. Default: adesso. */
  at?: string;
  /** Default per tipo: vedi `DEFAULT_CERTAINTY`. */
  certainty?: Certainty;
  /** Default: `manual`. */
  source?: Source;
  note?: string;
}

/** Certezza usata quando chi chiama non la indica. */
export const DEFAULT_CERTAINTY = {
  meal: "estimated",
  untrackedMeal: "measured",
  mealDeclaration: "measured",
  water: "estimated",
  drink: "label",
  weight: "measured",
  mood: "measured",
  symptom: "measured",
  supplement: "label",
  habit: "measured",
} as const satisfies Record<DiaryEvent["type"], Certainty>;

export class InvalidDiaryEventError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(
      `Evento del diario non valido: ${errors.map((e) => `${e.path || "(evento)"}:${e.code}`).join(", ")}`,
    );
    this.name = "InvalidDiaryEventError";
    this.errors = errors;
  }
}

const systemNow = () => new Date().toISOString();

/** Toglie le chiavi con valore `undefined`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

type DiaryBody<E extends DiaryEvent> = Omit<
  E,
  "type" | "id" | "at" | "recordedAt" | "deviceId" | "schemaVersion" | "certainty" | "source" | "note" | "replaces"
>;

/** Costruisce l'evento completo e lo controlla: lancia `InvalidDiaryEventError` se non è valido. */
function build<E extends DiaryEvent>(
  type: E["type"],
  body: DiaryBody<E>,
  options: DiaryEventOptions,
): E {
  const now = (options.now ?? systemNow)();
  const event = compact({
    id: (options.idGenerator ?? generateId)(),
    type,
    at: options.at ?? now,
    recordedAt: now,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: options.certainty ?? DEFAULT_CERTAINTY[type],
    source: options.source ?? "manual",
    note: options.note,
    ...compact(body as Record<string, unknown>),
  }) as unknown as E;
  const errors = validateDiaryEvent(event);
  if (errors.length > 0) throw new InvalidDiaryEventError(errors);
  return event;
}

export interface MealInput {
  kind: MealKind;
  title?: string;
  items?: MealItem[];
  habitId?: string;
  /** Default: un nuovo id. Va indicato per legare dei `consume` della dispensa. */
  mealId?: string;
}

export function createMeal(input: MealInput, options: DiaryEventOptions): MealEvent {
  return build<MealEvent>(
    "meal",
    {
      mealId: input.mealId ?? (options.idGenerator ?? generateId)(),
      kind: input.kind,
      title: input.title,
      items: input.items === undefined ? undefined : cloneMealItems(input.items),
      habitId: input.habitId,
    },
    options,
  );
}

/** Pasto che nasce da un pasto abituale: stessa composizione, `source: habit`. */
export function createMealFromHabit(
  habit: Pick<DiaryHabit, "habitId" | "title" | "kind" | "items">,
  options: DiaryEventOptions,
): MealEvent {
  return createMeal(
    {
      kind: habit.kind,
      title: habit.title,
      items: cloneMealItems(habit.items),
      habitId: habit.habitId,
    },
    { source: "habit", ...options },
  );
}

export function createUntrackedMeal(
  input: { kind: MealKind },
  options: DiaryEventOptions,
): UntrackedMealEvent {
  return build<UntrackedMealEvent>("untrackedMeal", { kind: input.kind }, options);
}

/**
 * Dichiara un momento del giorno di una data: «saltato» o «mangiato, non registrato».
 * `at` è l'istante della dichiarazione (predefinito: adesso), non il giorno a cui si riferisce.
 */
export function createMealDeclaration(
  input: { date: string; kind: MealKind; status: MealDeclarationStatus },
  options: DiaryEventOptions,
): MealDeclarationEvent {
  return build<MealDeclarationEvent>("mealDeclaration", input, options);
}

export function createWater(input: { ml: number }, options: DiaryEventOptions): WaterEvent {
  return build<WaterEvent>("water", { ml: input.ml }, options);
}

export function createDrink(
  input: {
    name: string;
    ml: number;
    caffeineMg?: number;
    alcoholG?: number;
    energyKcal?: number;
    sugarsG?: number;
  },
  options: DiaryEventOptions,
): DrinkEvent {
  return build<DrinkEvent>("drink", input, options);
}

export function createWeight(input: { kg: number }, options: DiaryEventOptions): WeightEvent {
  return build<WeightEvent>("weight", { kg: input.kg }, options);
}

export function createMood(
  input: { score: number; tags?: string[] },
  options: DiaryEventOptions,
): MoodEvent {
  return build<MoodEvent>("mood", input, options);
}

export function createSymptom(
  input: { kind: SymptomKind; score: number; label?: string },
  options: DiaryEventOptions,
): SymptomEvent {
  return build<SymptomEvent>("symptom", input, options);
}

export function createSupplement(
  input: { name: string; dose?: string; lotId?: string },
  options: DiaryEventOptions,
): SupplementEvent {
  return build<SupplementEvent>("supplement", input, options);
}

export interface HabitInput {
  habitId: string;
  title: string;
  kind: MealKind;
  usualTime?: string;
  items: MealItem[];
}

/** Definisce o ridefinisce un pasto abituale (vale l'ultimo evento con lo stesso `habitId`). */
export function createHabit(input: HabitInput, options: DiaryEventOptions): HabitEvent {
  return build<HabitEvent>("habit", { ...input, items: cloneMealItems(input.items) }, options);
}

/** Ritira un pasto abituale: ripete la definizione con `archived: true`. */
export function archiveHabit(
  habit: Pick<DiaryHabit, "habitId" | "title" | "kind" | "usualTime" | "items">,
  options: DiaryEventOptions,
): HabitEvent {
  return build<HabitEvent>(
    "habit",
    {
      habitId: habit.habitId,
      title: habit.title,
      kind: habit.kind,
      usualTime: habit.usualTime,
      items: cloneMealItems(habit.items),
      archived: true,
    },
    options,
  );
}
