// Aiuti per creare eventi del piano validi a partire da dati minimi.

import {
  SCHEMA_VERSION,
  generateId,
  type Certainty,
  type IdGenerator,
  type Source,
  type ValidationError,
} from "../ledger";
import type {
  DayTypeEvent,
  PlanEvent,
  PlanStructureEvent,
  PlanTargetsEvent,
  PlanWeekEvent,
} from "./types";
import { validatePlanEvent } from "./validate";

export interface PlanEventOptions {
  /** Dispositivo che scrive. */
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

export class InvalidPlanEventError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(
      `Evento del piano non valido: ${errors.map((e) => `${e.path || "(evento)"}:${e.code}`).join(", ")}`,
    );
    this.name = "InvalidPlanEventError";
    this.errors = errors;
  }
}

type Body<E extends PlanEvent> = Omit<
  E,
  "type" | "id" | "at" | "recordedAt" | "deviceId" | "schemaVersion" | "certainty" | "source" | "note" | "replaces"
>;

function build<E extends PlanEvent>(type: E["type"], body: Body<E>, options: PlanEventOptions): E {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const event: Record<string, unknown> = {
    id: (options.idGenerator ?? generateId)(),
    type,
    at: options.at ?? now,
    recordedAt: now,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: options.certainty ?? "measured",
    source: options.source ?? "manual",
  };
  if (options.note !== undefined) event.note = options.note;
  for (const [k, v] of Object.entries(body)) if (v !== undefined) event[k] = v;
  const errors = validatePlanEvent(event);
  if (errors.length > 0) throw new InvalidPlanEventError(errors);
  return event as unknown as E;
}

export const createPlanTargets = (body: Body<PlanTargetsEvent>, options: PlanEventOptions) =>
  build<PlanTargetsEvent>("planTargets", body, options);

export const createPlanStructure = (body: Body<PlanStructureEvent>, options: PlanEventOptions) =>
  build<PlanStructureEvent>("planStructure", body, options);

export const createPlanWeek = (body: Body<PlanWeekEvent>, options: PlanEventOptions) =>
  build<PlanWeekEvent>("planWeek", body, options);

export const createDayType = (body: Body<DayTypeEvent>, options: PlanEventOptions) =>
  build<DayTypeEvent>("dayType", body, options);
