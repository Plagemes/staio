import {
  isPantryEvent,
  worseCertainty,
  type Certainty,
  type Source,
  type ValidationError,
} from "../ledger";
import { isOtherFamilyEvent } from "./foreign";
import { cloneMealItems } from "./items";
import { isValidTimeZone, localDate } from "./calendar";
import { isVoid, prepareLog, rejectedErrors, rejectedKey, voidsOfLog } from "./log";
import {
  DEFAULT_TIME_ZONE,
  type DiaryEvent,
  type MealItem,
  type MealKind,
  type SymptomKind,
} from "./types";
import { isDiaryEvent, validateDiaryEvent } from "./validate";

export type DiaryAnomalyCode =
  /** Voce non valida, senza id utilizzabile, non oggetto o non serializzabile: ignorata. */
  | "invalid_event"
  /** Tipo di evento che né la dispensa né il diario conoscono: ignorato. */
  | "unknown_event_type"
  /** Stesso id con contenuti diversi (ne è stato scelto uno). */
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle"
  /** Due pasti con lo stesso `mealId`: conta il primo nell'ordine canonico. */
  | "duplicate_meal"
  /** Il fuso passato non esiste: si è usato quello predefinito. */
  | "invalid_time_zone";

export interface DiaryAnomaly {
  code: DiaryAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  mealId?: string;
  eventType?: string;
  /** Per `invalid_event`. */
  errors?: ValidationError[];
}

/** Dati comuni di ogni voce del diario. */
export interface DiaryEntry {
  eventId: string;
  /** Istante in cui il fatto è avvenuto. */
  at: string;
  certainty: Certainty;
  source: Source;
  note?: string;
}

export interface DiaryMeal extends DiaryEntry {
  mealId: string;
  kind: MealKind;
  title?: string;
  items: MealItem[];
  habitId?: string;
}

export interface DiaryUntrackedMeal extends DiaryEntry {
  kind: MealKind;
}

export interface DiaryDrink extends DiaryEntry {
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
}

export interface DiaryWeight extends DiaryEntry {
  kg: number;
}

export interface DiaryMood extends DiaryEntry {
  score: number;
  tags: string[];
}

export interface DiarySymptom extends DiaryEntry {
  kind: SymptomKind;
  score: number;
  label?: string;
}

export interface DiarySupplement extends DiaryEntry {
  name: string;
  dose?: string;
  lotId?: string;
}

export interface DiaryDay {
  /** Data di calendario `YYYY-MM-DD` nel fuso dello stato. */
  date: string;
  meals: DiaryMeal[];
  untrackedMeals: DiaryUntrackedMeal[];
  /** Somma degli eventi `water` (le bevande stanno a parte, in `drinks`). */
  waterMl: number;
  /** La meno affidabile tra le certezze degli eventi sommati; assente senza eventi. */
  waterCertainty?: Certainty;
  drinks: DiaryDrink[];
  caffeineMg: number;
  caffeineCertainty?: Certainty;
  alcoholG: number;
  alcoholCertainty?: Certainty;
  weights: DiaryWeight[];
  /** Ultima pesata del giorno (per `at`, poi `id`). */
  weightKg?: number;
  moods: DiaryMood[];
  symptoms: DiarySymptom[];
  supplements: DiarySupplement[];
}

export interface DiaryHabit {
  habitId: string;
  title: string;
  kind: MealKind;
  usualTime?: string;
  items: MealItem[];
  /** Evento che lo definisce al momento. */
  eventId: string;
  recordedAt: string;
  certainty: Certainty;
}

export interface DiaryState {
  timeZone: string;
  /** Solo giorni con almeno una voce, in ordine di data. */
  days: DiaryDay[];
  /** Pasti abituali attivi (non ritirati), per ora abituale, titolo e `habitId`. */
  habits: DiaryHabit[];
  anomalies: DiaryAnomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

export interface DeriveDiaryOptions {
  /** Fuso orario IANA con cui si assegnano gli eventi ai giorni. Predefinito `Europe/Rome`. */
  timeZone?: string;
}

// Evita residui come 0.30000000000000004 nelle somme.
const norm = (n: number): number => Math.round(n * 1e6) / 1e6;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function emptyDay(date: string): DiaryDay {
  return {
    date,
    meals: [],
    untrackedMeals: [],
    waterMl: 0,
    drinks: [],
    caffeineMg: 0,
    alcoholG: 0,
    weights: [],
    moods: [],
    symptoms: [],
    supplements: [],
  };
}

function entryOf(e: DiaryEvent): DiaryEntry {
  return {
    eventId: e.id,
    at: e.at,
    certainty: e.certainty,
    source: e.source,
    ...(e.note !== undefined ? { note: e.note } : {}),
  };
}

function anomalyKey(a: DiaryAnomaly): string {
  return [a.code, a.eventId ?? "", a.targetEventId ?? "", a.mealId ?? "", a.eventType ?? ""].join(
    "\u0000",
  );
}

/**
 * Riduzione deterministica del diario. Il risultato dipende solo dall'insieme di eventi
 * (non dall'ordine né dai duplicati in ingresso). Non lancia mai.
 *
 * Accetta il registro intero: gli eventi di dispensa e delle altre famiglie note (piano,
 * preparazioni, ricettario) sono ignorati in silenzio (ma i loro id
 * contano per i bersagli dei `void`), un tipo sconosciuto è segnalato come anomalia.
 * Un evento annullato non conta; un annullamento annullato ripristina l'evento.
 * Ogni evento va nella giornata di calendario del suo `at` nel fuso scelto.
 */
export function deriveDiary(
  events: Iterable<unknown>,
  options: DeriveDiaryOptions = {},
): DiaryState {
  const anomalies: DiaryAnomaly[] = [];
  let timeZone = DEFAULT_TIME_ZONE;
  if (options.timeZone !== undefined) {
    if (isValidTimeZone(options.timeZone)) timeZone = options.timeZone;
    else anomalies.push({ code: "invalid_time_zone" });
  }

  const log = prepareLog(events);

  const junk = new Map<string, unknown>();
  for (const item of log.rejected) junk.set(rejectedKey(item), item);
  for (const item of junk.values()) {
    anomalies.push({ code: "invalid_event", errors: rejectedErrors(item) });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });

  const valid: DiaryEvent[] = [];
  for (const e of log.events) {
    const rec = e as { id: string; type?: unknown };
    if (isVoid(e)) {
      const errors = validateDiaryEvent(e);
      if (errors.length > 0) anomalies.push({ code: "invalid_event", eventId: rec.id, errors });
    } else if (isDiaryEvent(e)) {
      const errors = validateDiaryEvent(e);
      if (errors.length > 0) anomalies.push({ code: "invalid_event", eventId: rec.id, errors });
      else valid.push(e);
    } else if (isPantryEvent(e) || isOtherFamilyEvent(e)) {
      // Fuori dal diario (dispensa, piano, preparazioni, ricettario): nessuna anomalia.
    } else if (typeof rec.type === "string") {
      anomalies.push({ code: "unknown_event_type", eventId: rec.id, eventType: rec.type });
    } else {
      anomalies.push({
        code: "invalid_event",
        eventId: rec.id,
        errors: validateDiaryEvent(e),
      });
    }
  }

  const { voided, findings } = voidsOfLog(log.events);
  for (const f of findings) {
    anomalies.push({ code: f.code, eventId: f.eventId, targetEventId: f.targetEventId });
  }
  const live = valid.filter((e) => !voided.has(e.id));

  const days = new Map<string, DiaryDay>();
  const dayOf = (e: DiaryEvent): DiaryDay | undefined => {
    const date = localDate(e.at, timeZone);
    if (date === undefined) return undefined;
    let day = days.get(date);
    if (!day) days.set(date, (day = emptyDay(date)));
    return day;
  };

  const mealIds = new Set<string>();
  const habitWinners = new Map<string, Extract<DiaryEvent, { type: "habit" }>>();

  // `live` è già in ordine canonico (at, recordedAt, id): le somme sono deterministiche.
  for (const e of live) {
    if (e.type === "habit") {
      const cur = habitWinners.get(e.habitId);
      if (
        !cur ||
        Date.parse(e.recordedAt) > Date.parse(cur.recordedAt) ||
        (Date.parse(e.recordedAt) === Date.parse(cur.recordedAt) && e.id > cur.id)
      ) {
        habitWinners.set(e.habitId, e);
      }
      continue;
    }
    if (e.type === "meal") {
      if (mealIds.has(e.mealId)) {
        anomalies.push({ code: "duplicate_meal", eventId: e.id, mealId: e.mealId });
        continue;
      }
      mealIds.add(e.mealId);
    }
    const day = dayOf(e);
    if (!day) continue;
    const base = entryOf(e);
    switch (e.type) {
      case "meal":
        day.meals.push({
          ...base,
          mealId: e.mealId,
          kind: e.kind,
          ...(e.title !== undefined ? { title: e.title } : {}),
          items: cloneMealItems(e.items),
          ...(e.habitId !== undefined ? { habitId: e.habitId } : {}),
        });
        break;
      case "untrackedMeal":
        day.untrackedMeals.push({ ...base, kind: e.kind });
        break;
      case "water":
        day.waterMl = norm(day.waterMl + e.ml);
        day.waterCertainty = day.waterCertainty
          ? worseCertainty(day.waterCertainty, e.certainty)
          : e.certainty;
        break;
      case "drink":
        day.drinks.push({
          ...base,
          name: e.name,
          ml: e.ml,
          ...(e.caffeineMg !== undefined ? { caffeineMg: e.caffeineMg } : {}),
          ...(e.alcoholG !== undefined ? { alcoholG: e.alcoholG } : {}),
        });
        if (e.caffeineMg !== undefined) {
          day.caffeineMg = norm(day.caffeineMg + e.caffeineMg);
          day.caffeineCertainty = day.caffeineCertainty
            ? worseCertainty(day.caffeineCertainty, e.certainty)
            : e.certainty;
        }
        if (e.alcoholG !== undefined) {
          day.alcoholG = norm(day.alcoholG + e.alcoholG);
          day.alcoholCertainty = day.alcoholCertainty
            ? worseCertainty(day.alcoholCertainty, e.certainty)
            : e.certainty;
        }
        break;
      case "weight":
        day.weights.push({ ...base, kg: e.kg });
        day.weightKg = e.kg;
        break;
      case "mood":
        day.moods.push({ ...base, score: e.score, tags: [...(e.tags ?? [])] });
        break;
      case "symptom":
        day.symptoms.push({
          ...base,
          kind: e.kind,
          score: e.score,
          ...(e.label !== undefined ? { label: e.label } : {}),
        });
        break;
      case "supplement":
        day.supplements.push({
          ...base,
          name: e.name,
          ...(e.dose !== undefined ? { dose: e.dose } : {}),
          ...(e.lotId !== undefined ? { lotId: e.lotId } : {}),
        });
        break;
    }
  }

  const habits: DiaryHabit[] = [];
  for (const h of habitWinners.values()) {
    if (h.archived === true) continue;
    habits.push({
      habitId: h.habitId,
      title: h.title,
      kind: h.kind,
      ...(h.usualTime !== undefined ? { usualTime: h.usualTime } : {}),
      items: cloneMealItems(h.items),
      eventId: h.id,
      recordedAt: h.recordedAt,
      certainty: h.certainty,
    });
  }
  habits.sort(
    (a, b) =>
      cmp(a.usualTime ?? "99:99", b.usualTime ?? "99:99") ||
      cmp(a.title, b.title) ||
      cmp(a.habitId, b.habitId),
  );

  anomalies.sort((a, b) => cmp(anomalyKey(a), anomalyKey(b)));

  return {
    timeZone,
    days: [...days.values()].sort((a, b) => cmp(a.date, b.date)),
    habits,
    anomalies,
    voidedEventIds: [...voided].sort(cmp),
  };
}
