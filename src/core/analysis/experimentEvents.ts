// Eventi degli esperimenti personali e stato derivato.
//
// Gli eventi non si modificano mai e più dispositivi possono scriverne senza essersi visti. Per
// questo lo stato non si ricava dall'evento più recente per intero ma campo per campo:
//  - un evento INTERO (identificativo, titolo, descrizione, inizio, fine, misure) crea l'esperimento
//    e vale come dichiarazione di tutti i suoi campi (compatibilità con gli eventi già scritti);
//  - un evento PARZIALE dichiara solo i campi che cambiano: titolo, descrizione, chiusura anticipata
//    (`closedOn`), archiviazione o ripristino (`archived`), aderenza (`declaredAdherence`);
//  - ogni campo si risolve per conto suo con (recordedAt, id); una modifica ad altri campi non può
//    cancellare una chiusura o un'archiviazione;
//  - due chiusure diverse: vale la data più vicina all'inizio (la più prudente) e si segnala un
//    conflitto;
//  - senza un evento di creazione valido e non annullato l'esperimento non esiste: le modifiche
//    rimaste sono anomalie.
// Il risultato dipende solo dall'insieme degli eventi, non dall'ordine in cui arrivano.

import { daysBetween } from "../diary";
import {
  SCHEMA_VERSION,
  generateId,
  isCalendarDate,
  validateEnvelope,
  type Certainty,
  type EventBase,
  type IdGenerator,
  type Source,
  type ValidationError,
} from "../ledger";
import { newerThan, readOwnedLog } from "../plan/log";
import { OUTCOME_KEYS } from "./outcomes";

export const EXPERIMENT_EVENT_TYPES = ["experiment"] as const;

export const EXPERIMENT_MEASURES = [...OUTCOME_KEYS, "weight", "energyIntake"] as const;
export type ExperimentMeasure = (typeof EXPERIMENT_MEASURES)[number];

/** Limiti larghi di plausibilità, per intercettare errori di battitura e non per giudicare. */
export const EXPERIMENT_LIMITS = {
  maxDays: 366,
  maxExcludedFoods: 50,
  maxTextLength: 500,
} as const;

/** Evento intero: crea l'esperimento (o, se scritto da versioni precedenti, lo sostituisce per intero). */
export interface ExperimentFullEvent extends EventBase {
  type: "experiment";
  experimentId: string;
  title: string;
  /** Che cosa cambia durante l'esperimento, a parole dell'utente. */
  change: string;
  /** Primo e ultimo giorno previsti (inclusi), `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  /** Misure osservate. */
  measures: ExperimentMeasure[];
  /** Alimenti da escludere (nomi o identificativi di tabella): servono a misurare l'aderenza. */
  excludedFoods?: string[];
  /** Un evento intero dichiara questi campi solo se presenti. `null` toglie il valore. */
  declaredAdherence?: number | null;
  archived?: boolean;
  closedOn?: string;
}

/** Evento parziale: dichiara solo i campi che cambiano (almeno uno). */
export interface ExperimentUpdateEvent extends EventBase {
  type: "experiment";
  experimentId: string;
  title?: string;
  change?: string;
  /** Chiusura anticipata: ultimo giorno effettivo, prima di quello previsto. Non si ritira, si annulla con un `void`. */
  closedOn?: string;
  /** `true` ritira l'esperimento, `false` lo ripristina. */
  archived?: boolean;
  /** Aderenza dichiarata da 0 a 1; `null` la toglie. */
  declaredAdherence?: number | null;
}

export type ExperimentEvent = ExperimentFullEvent | ExperimentUpdateEvent;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isExperimentEvent(e: unknown): e is ExperimentEvent {
  try {
    return isRecord(e) && e.type === "experiment";
  } catch {
    return false;
  }
}

/** Evento intero: dichiara inizio, fine o misure. Gli altri sono parziali. */
export function isFullExperimentEvent(e: ExperimentEvent): e is ExperimentFullEvent {
  return "startDate" in e || "endDate" in e || "measures" in e;
}

const PATCH_FIELDS = ["title", "change", "closedOn", "archived", "declaredAdherence"] as const;

/**
 * Errori dell'evento (lista vuota se valido): busta comune più campi propri. Non lancia mai.
 * I campi in più sono ignorati, per restare compatibili con versioni future.
 */
export function validateExperimentEvent(event: unknown): ValidationError[] {
  let errors: ValidationError[];
  try {
    errors = [...validateEnvelope(event)];
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
  if (!isRecord(event)) return errors;
  const add = (path: string, code: ValidationError["code"]): void => {
    errors.push({ path, code });
  };
  try {
    if (event.type !== undefined && event.type !== "experiment") add("type", "invalid_value");
    const full = event.startDate !== undefined || event.endDate !== undefined || event.measures !== undefined;
    const text = (key: string, required: boolean): void => {
      const v = event[key];
      if (v === undefined) {
        if (required) add(key, "required");
      } else if (typeof v !== "string" || v.trim() === "") add(key, "invalid_type");
      else if (v.length > EXPERIMENT_LIMITS.maxTextLength) add(key, "invalid_value");
    };
    text("experimentId", true);
    text("title", full);
    text("change", full);
    const closedOn = event.closedOn;
    if (closedOn !== undefined && !isCalendarDate(closedOn)) add("closedOn", "invalid_date");
    if (event.archived !== undefined && typeof event.archived !== "boolean") add("archived", "invalid_type");
    const adherence = event.declaredAdherence;
    if (adherence !== undefined && adherence !== null) {
      if (typeof adherence !== "number" || !Number.isFinite(adherence)) add("declaredAdherence", "invalid_type");
      else if (adherence < 0 || adherence > 1) add("declaredAdherence", "invalid_value");
    }

    if (!full) {
      if (!PATCH_FIELDS.some((k) => event[k] !== undefined)) add("", "empty_patch");
      if (event.excludedFoods !== undefined) add("excludedFoods", "not_allowed");
    } else {
      const start = event.startDate;
      const end = event.endDate;
      if (start === undefined) add("startDate", "required");
      else if (!isCalendarDate(start)) add("startDate", "invalid_date");
      if (end === undefined) add("endDate", "required");
      else if (!isCalendarDate(end)) add("endDate", "invalid_date");
      if (isCalendarDate(start) && isCalendarDate(end)) {
        if (end < start || daysBetween(start, end) + 1 > EXPERIMENT_LIMITS.maxDays) add("endDate", "invalid_value");
      }
      const measures = event.measures;
      if (measures === undefined) add("measures", "required");
      else if (!Array.isArray(measures)) add("measures", "invalid_type");
      else {
        if (measures.length === 0) add("measures", "required");
        const seen = new Set<unknown>();
        measures.forEach((m: unknown, i) => {
          if (typeof m !== "string" || !(EXPERIMENT_MEASURES as readonly string[]).includes(m)) {
            add(`measures.${i}`, "invalid_value");
          } else if (seen.has(m)) add(`measures.${i}`, "invalid_value");
          seen.add(m);
        });
      }
      const foods = event.excludedFoods;
      if (foods !== undefined) {
        if (!Array.isArray(foods)) add("excludedFoods", "invalid_type");
        else {
          if (foods.length > EXPERIMENT_LIMITS.maxExcludedFoods) add("excludedFoods", "invalid_value");
          foods.forEach((f: unknown, i) => {
            if (typeof f !== "string" || f.trim() === "") add(`excludedFoods.${i}`, "invalid_type");
          });
        }
      }
    }
  } catch {
    return [...errors, { path: "", code: "unserializable" }];
  }
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.path}\u0000${e.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ExperimentEventOptions {
  deviceId: string;
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  /** Quando il fatto è avvenuto. Default: adesso. */
  at?: string;
  /** Default `measured`: è una scelta dell'utente, non una misura. */
  certainty?: Certainty;
  /** Default `manual`. */
  source?: Source;
  note?: string;
}

export class InvalidExperimentEventError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(
      `Evento di esperimento non valido: ${errors.map((e) => `${e.path || "(evento)"}:${e.code}`).join(", ")}`,
    );
    this.name = "InvalidExperimentEventError";
    this.errors = errors;
  }
}

export type ExperimentBody = Omit<
  ExperimentFullEvent,
  "type" | "id" | "at" | "recordedAt" | "deviceId" | "schemaVersion" | "certainty" | "source" | "note" | "replaces"
>;

function build(
  fields: Record<string, unknown>,
  options: ExperimentEventOptions,
): Record<string, unknown> {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const event: Record<string, unknown> = {
    id: (options.idGenerator ?? generateId)(),
    type: "experiment",
    at: options.at ?? now,
    recordedAt: now,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: options.certainty ?? "measured",
    source: options.source ?? "manual",
  };
  if (options.note !== undefined) event.note = options.note;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) event[k] = v;
  const errors = validateExperimentEvent(event);
  if (errors.length > 0) throw new InvalidExperimentEventError(errors);
  return event;
}

/** Crea l'evento intero che crea l'esperimento; lancia `InvalidExperimentEventError` se i dati non sono validi. */
export function createExperiment(body: ExperimentBody, options: ExperimentEventOptions): ExperimentFullEvent {
  return build({ ...body }, options) as unknown as ExperimentFullEvent;
}

/** Campi che una modifica può cambiare. Si dichiara solo ciò che cambia. */
export type ExperimentPatch = Partial<
  Pick<ExperimentUpdateEvent, "title" | "change" | "closedOn" | "archived" | "declaredAdherence">
>;

/** Crea un evento parziale con la sola modifica; lancia `InvalidExperimentEventError` se è vuota o non valida. */
export function updateExperiment(
  experimentId: string,
  patch: ExperimentPatch,
  options: ExperimentEventOptions,
): ExperimentUpdateEvent {
  const fields: Record<string, unknown> = { experimentId };
  for (const k of PATCH_FIELDS) if (patch[k] !== undefined) fields[k] = patch[k];
  return build(fields, options) as unknown as ExperimentUpdateEvent;
}

// ---------------------------------------------------------------------------------------------
// Derivazione

export interface Experiment {
  experimentId: string;
  /** Evento di creazione: il più antico tra gli eventi interi validi e non annullati. */
  eventId: string;
  /** Istante dell'ultima modifica (l'evento più recente che lo riguarda). */
  recordedAt: string;
  title: string;
  change: string;
  startDate: string;
  /** Ultimo giorno EFFETTIVO: la chiusura anticipata, se c'è, altrimenti quello previsto. */
  endDate: string;
  /** Ultimo giorno previsto alla creazione. */
  plannedEndDate: string;
  /** Ultimo giorno scelto con una chiusura anticipata. */
  closedOn?: string;
  closedEarly: boolean;
  measures: ExperimentMeasure[];
  excludedFoods: string[];
  declaredAdherence?: number;
}

export type ExperimentAnomalyCode =
  | "invalid_event"
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle"
  /** Modifica di un esperimento senza evento di creazione valido (o con la creazione annullata): ignorata. */
  | "orphan_update"
  /** Due o più chiusure con giorni diversi: vale la più vicina all'inizio. */
  | "closure_conflict"
  /** Chiusura prima dell'inizio: ignorata. */
  | "invalid_closure";

export interface ExperimentAnomaly {
  code: ExperimentAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  errors?: ValidationError[];
  experimentId?: string;
  /** Per `closure_conflict`: gli eventi di chiusura e i loro giorni, e il giorno che vale. */
  closures?: { eventId: string; closedOn: string }[];
  applied?: string;
}

export interface ExperimentsState {
  /** Esperimenti attivi, per data d'inizio e poi per id. */
  experiments: Experiment[];
  /** Esperimenti ritirati, con tutti i loro dati, per data d'inizio e poi per id. */
  archived: Experiment[];
  /** Id degli esperimenti ritirati. */
  archivedIds: string[];
  anomalies: ExperimentAnomaly[];
  voidedEventIds: string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ascending = (a: ExperimentEvent, b: ExperimentEvent): number =>
  newerThan(a, b) ? 1 : newerThan(b, a) ? -1 : 0;

/**
 * Esperimenti dal registro intero, campo per campo (vedi l'intestazione del file). Il risultato
 * dipende solo dall'insieme degli eventi, non dall'ordine né dai duplicati. Gli eventi di altre
 * famiglie sono ignorati; i `void` valgono. Non lancia mai.
 */
export function deriveExperiments(events: Iterable<unknown>): ExperimentsState {
  const log = readOwnedLog<ExperimentEvent & { id: string }>(events, {
    isOwn: isExperimentEvent as (e: unknown) => e is ExperimentEvent & { id: string },
    validate: validateExperimentEvent,
  });
  const anomalies: ExperimentAnomaly[] = [];
  for (const i of log.invalid) {
    anomalies.push({ code: "invalid_event", ...(i.eventId !== undefined ? { eventId: i.eventId } : {}), errors: i.errors });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });
  for (const f of log.voidFindings) {
    anomalies.push({ code: f.code, eventId: f.eventId, targetEventId: f.targetEventId });
  }

  const groups = new Map<string, ExperimentEvent[]>();
  for (const e of log.live) {
    const list = groups.get(e.experimentId);
    if (list) list.push(e);
    else groups.set(e.experimentId, [e]);
  }

  const experiments: Experiment[] = [];
  const archived: Experiment[] = [];
  for (const [experimentId, list] of [...groups.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const sorted = [...list].sort(ascending);
    const fulls = sorted.filter(isFullExperimentEvent);
    if (fulls.length === 0) {
      for (const e of sorted) anomalies.push({ code: "orphan_update", eventId: e.id, experimentId });
      continue;
    }
    // L'ultimo evento che dichiara il campo vince; `sorted` è in ordine crescente di (recordedAt, id).
    const latest = <V>(pick: (e: ExperimentEvent) => V | undefined): V | undefined => {
      let out: V | undefined;
      for (const e of sorted) {
        const v = pick(e);
        if (v !== undefined) out = v;
      }
      return out;
    };
    const latestFull = <V>(pick: (e: ExperimentFullEvent) => V | undefined): V | undefined => {
      let out: V | undefined;
      for (const e of fulls) {
        const v = pick(e);
        if (v !== undefined) out = v;
      }
      return out;
    };
    const startDate = latestFull((e) => e.startDate) as string;
    const plannedEnd = latestFull((e) => e.endDate) as string;

    // Chiusura anticipata: la più prudente (più vicina all'inizio) tra quelle valide.
    const closures: { eventId: string; closedOn: string }[] = [];
    for (const e of sorted) {
      if (e.closedOn === undefined) continue;
      if (e.closedOn < startDate) {
        anomalies.push({ code: "invalid_closure", eventId: e.id, experimentId });
      } else if (e.closedOn < plannedEnd) {
        closures.push({ eventId: e.id, closedOn: e.closedOn });
      }
    }
    closures.sort((a, b) => cmp(a.closedOn, b.closedOn) || cmp(a.eventId, b.eventId));
    const closedOn = closures[0]?.closedOn;
    if (closures.some((c) => c.closedOn !== closedOn)) {
      anomalies.push({
        code: "closure_conflict",
        experimentId,
        closures,
        applied: closedOn,
      });
    }

    const adherence = latest((e) => e.declaredAdherence);
    const experiment: Experiment = {
      experimentId,
      eventId: fulls[0].id,
      recordedAt: sorted[sorted.length - 1].recordedAt,
      title: latest((e) => e.title) as string,
      change: latest((e) => e.change) as string,
      startDate,
      endDate: closedOn ?? plannedEnd,
      plannedEndDate: plannedEnd,
      ...(closedOn !== undefined ? { closedOn } : {}),
      closedEarly: closedOn !== undefined,
      measures: [...(latestFull((e) => e.measures) as ExperimentMeasure[])],
      excludedFoods: [...(latestFull((e) => e.excludedFoods ?? []) ?? [])],
      ...(typeof adherence === "number" ? { declaredAdherence: adherence } : {}),
    };
    (latest((e) => e.archived) === true ? archived : experiments).push(experiment);
  }

  const byStart = (a: Experiment, b: Experiment): number =>
    cmp(a.startDate, b.startDate) || cmp(a.experimentId, b.experimentId);
  experiments.sort(byStart);
  archived.sort(byStart);
  const key = (a: ExperimentAnomaly): string =>
    `${a.code}|${a.eventId ?? ""}|${a.targetEventId ?? ""}|${a.experimentId ?? ""}`;
  anomalies.sort((a, b) => cmp(key(a), key(b)));
  return {
    experiments,
    archived,
    archivedIds: archived.map((e) => e.experimentId),
    anomalies,
    voidedEventIds: [...log.voided].sort(cmp),
  };
}
