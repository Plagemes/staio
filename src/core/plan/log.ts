// Preparazione del registro per i moduli che definiscono propri tipi di evento (piano, preparazioni):
// unione per id e annullamenti, con le stesse regole del libro mastro.

import {
  canonicalStringify,
  mergeEvents,
  validateEvent,
  type EventLike,
  type ValidationError,
} from "../ledger";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface VoidRef {
  id: string;
  targetEventId: string;
}

export interface VoidFinding {
  code: "void_cycle" | "void_target_missing";
  eventId: string;
  targetEventId: string;
}

/**
 * Risolve gli annullamenti: un void è attivo se nessun void attivo lo annulla; un annullamento
 * annullato ripristina l'evento. Dipende solo dall'insieme dei `void`, non dal loro ordine.
 */
export function resolveVoids(
  refs: readonly VoidRef[],
  knownIds: ReadonlySet<string>,
): { voided: Set<string>; findings: VoidFinding[] } {
  const voids = new Map<string, VoidRef>();
  for (const v of refs) voids.set(v.id, v);

  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const start of voids.keys()) {
    const position = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && voids.has(cur) && !done.has(cur)) {
      const seen = position.get(cur);
      if (seen !== undefined) {
        for (const id of path.slice(seen)) cyclic.add(id);
        break;
      }
      position.set(cur, path.length);
      path.push(cur);
      cur = voids.get(cur)!.targetEventId;
    }
    for (const id of path) done.add(id);
  }

  const findings: VoidFinding[] = [];
  const effective: VoidRef[] = [];
  for (const v of voids.values()) {
    if (cyclic.has(v.id)) {
      findings.push({ code: "void_cycle", eventId: v.id, targetEventId: v.targetEventId });
    } else {
      effective.push(v);
      if (!knownIds.has(v.targetEventId)) {
        findings.push({
          code: "void_target_missing",
          eventId: v.id,
          targetEventId: v.targetEventId,
        });
      }
    }
  }

  const incoming = new Map<string, VoidRef[]>();
  for (const v of effective) {
    const list = incoming.get(v.targetEventId);
    if (list) list.push(v);
    else incoming.set(v.targetEventId, [v]);
  }
  const pending = new Map<string, number>();
  const queue: VoidRef[] = [];
  for (const v of effective) {
    const n = incoming.get(v.id)?.length ?? 0;
    pending.set(v.id, n);
    if (n === 0) queue.push(v);
  }
  const active = new Map<string, boolean>();
  const voided = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    const isActive = !(incoming.get(v.id) ?? []).some((s) => active.get(s.id));
    active.set(v.id, isActive);
    if (isActive) voided.add(v.targetEventId);
    const left = pending.get(v.targetEventId);
    if (left !== undefined) {
      pending.set(v.targetEventId, left - 1);
      if (left - 1 === 0) queue.push(voids.get(v.targetEventId)!);
    }
  }
  return { voided, findings };
}

export interface OwnedLog<T> {
  /** Eventi propri validi e non annullati, in ordine canonico (at, recordedAt, id). */
  live: T[];
  /** Tutti gli eventi propri validi, annullati compresi, in ordine canonico. */
  valid: T[];
  /** Voci proprie non valide, con gli errori. */
  invalid: { eventId?: string; errors: ValidationError[] }[];
  /** Id con versioni diverse e contenuto diverso. */
  conflictIds: string[];
  voided: Set<string>;
  voidFindings: VoidFinding[];
}

export interface OwnedLogOptions<T> {
  /** Il tipo dell'evento è uno dei propri. */
  isOwn: (e: unknown) => e is T;
  validate: (e: unknown) => ValidationError[];
}

function safeErrors(fn: () => ValidationError[]): ValidationError[] {
  try {
    return fn();
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
}

/**
 * Dal registro intero (dispensa, diario, `void`, altri) estrae gli eventi propri validi e risolve
 * gli annullamenti. Gli eventi di altri moduli sono ignorati, ma i loro id contano come bersagli
 * possibili dei `void`. Non lancia mai.
 */
export function readOwnedLog<T extends EventLike>(
  events: Iterable<unknown>,
  options: OwnedLogOptions<T>,
): OwnedLog<T> {
  const relevant: EventLike[] = [];
  const foreignIds = new Set<string>();
  for (const item of events) {
    let isVoid = false;
    let own = false;
    try {
      isVoid = isRecord(item) && item.type === "void";
      own = options.isOwn(item);
    } catch {
      isVoid = false;
      own = false;
    }
    if (isVoid || own) relevant.push(item as EventLike);
    else if (isRecord(item) && typeof item.id === "string" && item.id.length > 0) {
      foreignIds.add(item.id);
    }
  }

  const check = (e: unknown): ValidationError[] =>
    safeErrors(() =>
      isRecord(e) && e.type === "void" ? validateEvent(e) : options.validate(e),
    );
  const merged = mergeEvents<EventLike>(relevant, [], { validate: (e) => check(e).length === 0 });

  const invalid: OwnedLog<T>["invalid"] = [];
  const seenJunk = new Set<string>();
  for (const item of merged.rejected) {
    const key = canonicalStringify(item);
    if (seenJunk.has(key)) continue;
    seenJunk.add(key);
    const errors = check(item);
    invalid.push({ errors: errors.length > 0 ? errors : [{ path: "", code: "unserializable" }] });
  }

  const valid: T[] = [];
  const refs: VoidRef[] = [];
  const knownIds = new Set<string>(foreignIds);
  for (const e of merged.events) {
    knownIds.add(e.id);
    const errors = check(e);
    if (errors.length > 0) {
      invalid.push({ eventId: e.id, errors });
    } else if ((e as unknown as Rec).type === "void") {
      refs.push({ id: e.id, targetEventId: (e as unknown as { targetEventId: string }).targetEventId });
    } else {
      valid.push(e as T);
    }
  }
  const { voided, findings } = resolveVoids(refs, knownIds);
  return {
    live: valid.filter((e) => !voided.has(e.id)),
    valid,
    invalid,
    conflictIds: merged.conflicts.map((c) => c.id).sort(),
    voided,
    voidFindings: findings,
  };
}

/** `a` batte `b` per sostituzione: più recente per `recordedAt`, a parità `id` maggiore. */
export function newerThan(
  a: { recordedAt: string; id: string },
  b: { recordedAt: string; id: string },
): boolean {
  const ta = Date.parse(a.recordedAt);
  const tb = Date.parse(b.recordedAt);
  return ta > tb || (ta === tb && a.id > b.id);
}
