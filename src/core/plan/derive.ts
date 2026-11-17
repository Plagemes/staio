import type { ValidationError } from "../ledger";
import { MEAL_KINDS } from "../diary";
import { newerThan, readOwnedLog } from "./log";
import type {
  EatingWindow,
  NutrientTargets,
  PlanEvent,
  PlanMealSlot,
  PlannedEntry,
} from "./types";
import { isPlanEvent, validatePlanEvent } from "./validate";

export type PlanAnomalyCode =
  /** Evento del piano non valido o voce non unibile: ignorato. */
  | "invalid_event"
  /** Stesso id con contenuti diversi (ne è stato scelto uno). */
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle";

export interface PlanAnomaly {
  code: PlanAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  errors?: ValidationError[];
}

export interface PlanTargetsState {
  dayType: string;
  targets: NutrientTargets;
  /** Evento che lo definisce al momento. */
  eventId: string;
  recordedAt: string;
}

export interface PlanStructureState {
  meals: PlanMealSlot[];
  eatingWindow?: EatingWindow;
  excludedFoods: string[];
  allergens: string[];
  defaultDayType?: string;
  eventId: string;
  recordedAt: string;
}

export interface PlanWeekState {
  /** Lunedì. */
  weekStart: string;
  /** In ordine di data, tipo di pasto e poi ordine di scrittura. */
  entries: PlannedEntry[];
  eventId: string;
  recordedAt: string;
}

export interface DayTypeState {
  date: string;
  dayType: string;
  eventId: string;
  recordedAt: string;
}

export interface PlanState {
  /** Per tipo di giornata, in ordine alfabetico. */
  targets: PlanTargetsState[];
  structure?: PlanStructureState;
  /** In ordine di data d'inizio. */
  weeks: PlanWeekState[];
  /** In ordine di data. */
  dayTypes: DayTypeState[];
  anomalies: PlanAnomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const MEAL_ORDER = new Map<string, number>(MEAL_KINDS.map((k, i) => [k, i]));

function anomalyKey(a: PlanAnomaly): string {
  return [a.code, a.eventId ?? "", a.targetEventId ?? ""].join("\u0000");
}

/**
 * Riduzione deterministica degli eventi del piano. Il risultato dipende solo dall'insieme di
 * eventi (non dall'ordine né dai duplicati in ingresso). Non lancia mai. Accetta il registro
 * intero: gli eventi di altri moduli sono ignorati (i loro id contano come bersagli dei `void`).
 *
 * Un evento successivo dello stesso tipo e chiave sostituisce il precedente: vale l'ultimo per
 * `recordedAt`, poi `id`. Chiavi: `planTargets` per `dayType`, `planWeek` per `weekStart`,
 * `dayType` per `date`, `planStructure` una sola. Un evento annullato non conta, quindi
 * riemerge quello precedente; un annullamento annullato ripristina l'evento.
 */
export function derivePlan(events: Iterable<unknown>): PlanState {
  const log = readOwnedLog<PlanEvent>(events, {
    isOwn: isPlanEvent,
    validate: validatePlanEvent,
  });

  const anomalies: PlanAnomaly[] = [];
  for (const bad of log.invalid) {
    anomalies.push({
      code: "invalid_event",
      ...(bad.eventId !== undefined ? { eventId: bad.eventId } : {}),
      errors: bad.errors,
    });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });
  for (const f of log.voidFindings) {
    anomalies.push({ code: f.code, eventId: f.eventId, targetEventId: f.targetEventId });
  }

  const targets = new Map<string, Extract<PlanEvent, { type: "planTargets" }>>();
  const weeks = new Map<string, Extract<PlanEvent, { type: "planWeek" }>>();
  const dayTypes = new Map<string, Extract<PlanEvent, { type: "dayType" }>>();
  let structure: Extract<PlanEvent, { type: "planStructure" }> | undefined;
  const take = <E extends { recordedAt: string; id: string }>(
    map: Map<string, E>,
    key: string,
    e: E,
  ): void => {
    const cur = map.get(key);
    if (!cur || newerThan(e, cur)) map.set(key, e);
  };
  for (const e of log.live) {
    switch (e.type) {
      case "planTargets":
        take(targets, e.dayType, e);
        break;
      case "planWeek":
        take(weeks, e.weekStart, e);
        break;
      case "dayType":
        take(dayTypes, e.date, e);
        break;
      case "planStructure":
        if (!structure || newerThan(e, structure)) structure = e;
        break;
    }
  }

  const state: PlanState = {
    targets: [...targets.values()]
      .map((e) => ({
        dayType: e.dayType,
        targets: clone(e.targets),
        eventId: e.id,
        recordedAt: e.recordedAt,
      }))
      .sort((a, b) => cmp(a.dayType, b.dayType)),
    weeks: [...weeks.values()]
      .map((e) => ({
        weekStart: e.weekStart,
        entries: clone(e.entries)
          .map((entry, index) => ({ entry, index }))
          .sort(
            (a, b) =>
              cmp(a.entry.date, b.entry.date) ||
              (MEAL_ORDER.get(a.entry.meal) ?? 99) - (MEAL_ORDER.get(b.entry.meal) ?? 99) ||
              a.index - b.index,
          )
          .map((x) => x.entry),
        eventId: e.id,
        recordedAt: e.recordedAt,
      }))
      .sort((a, b) => cmp(a.weekStart, b.weekStart)),
    dayTypes: [...dayTypes.values()]
      .map((e) => ({ date: e.date, dayType: e.dayType, eventId: e.id, recordedAt: e.recordedAt }))
      .sort((a, b) => cmp(a.date, b.date)),
    anomalies: anomalies.sort((a, b) => cmp(anomalyKey(a), anomalyKey(b))),
    voidedEventIds: [...log.voided].sort(cmp),
  };
  if (structure) {
    state.structure = {
      meals: clone(structure.meals),
      ...(structure.eatingWindow ? { eatingWindow: { ...structure.eatingWindow } } : {}),
      excludedFoods: [...(structure.excludedFoods ?? [])],
      allergens: [...(structure.allergens ?? [])],
      ...(structure.defaultDayType !== undefined ? { defaultDayType: structure.defaultDayType } : {}),
      eventId: structure.id,
      recordedAt: structure.recordedAt,
    };
  }
  return state;
}

export function getWeek(state: PlanState, weekStart: string): PlanWeekState | undefined {
  return state.weeks.find((w) => w.weekStart === weekStart);
}

/** Tipo di giornata di una data: l'evento `dayType`, altrimenti quello predefinito della struttura. */
export function dayTypeOf(state: PlanState, date: string): string | undefined {
  return (
    state.dayTypes.find((d) => d.date === date)?.dayType ?? state.structure?.defaultDayType
  );
}

export function targetsOf(state: PlanState, dayType: string): PlanTargetsState | undefined {
  return state.targets.find((t) => t.dayType === dayType);
}

export function entriesOfDate(week: PlanWeekState | undefined, date: string): PlannedEntry[] {
  return week ? week.entries.filter((e) => e.date === date) : [];
}
