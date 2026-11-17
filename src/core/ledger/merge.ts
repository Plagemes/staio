import type { LedgerEvent } from "./types";
import { instantMs } from "./time";
import { validateEvent } from "./validate";

class Unserializable extends Error {}

function canon(value: unknown, strict: boolean, stack: object[]): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // NaN, Infinity e -0 devono restare distinti da null e da 0 (JSON li appiattirebbe).
      return Object.is(value, -0) ? "-0" : String(value);
    case "undefined":
      return "null";
    case "bigint":
      if (strict) throw new Unserializable();
      return `"${value}n"`;
    case "function":
    case "symbol":
      if (strict) throw new Unserializable();
      return `"<${typeof value}>"`;
  }
  if (value === null) return "null";
  const obj = value as object;
  if (stack.includes(obj)) {
    if (strict) throw new Unserializable();
    return '"<circular>"';
  }
  stack.push(obj);
  try {
    if (obj instanceof Date) {
      // Le date diventano la loro stringa ISO (un evento con una Date extra resta valido).
      if (Number.isNaN(obj.getTime())) {
        if (strict) throw new Unserializable();
        return '"<invalid-date>"';
      }
      // Etichettata: una Date e la stringa ISO equivalente sono contenuti diversi.
      return `Date(${JSON.stringify(obj.toISOString())})`;
    }
    if (Array.isArray(obj)) {
      return `[${obj.map((v) => canon(v, strict, stack)).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (strict && proto !== Object.prototype && proto !== null) {
      throw new Unserializable();
    }
    const rec = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(rec).sort()) {
      if (rec[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canon(rec[key], strict, stack)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    stack.pop();
  }
}

/**
 * Serializzazione con chiavi ordinate: due contenuti uguali danno la stessa stringa.
 * Non lancia mai (valori non serializzabili diventano marcatori).
 */
export function canonicalStringify(value: unknown): string {
  try {
    return canon(value, false, []);
  } catch {
    return '"<unserializable>"';
  }
}

/** Come `canonicalStringify`, ma `undefined` per valori non serializzabili in JSON (bigint, funzioni, cicli, istanze di classe). */
function strictCanonical(value: unknown): string | undefined {
  try {
    return canon(value, true, []);
  } catch {
    return undefined;
  }
}

// Un istante non valido vale -Infinity, così l'ordine resta totale anche con dati corrotti.
const msKey = (v: unknown): number => {
  const ms = instantMs(v);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

const cmpNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Il minimo che serve per unire e ordinare: vale per gli eventi della dispensa e per altri registri. */
export interface EventLike {
  id: string;
  at: string;
  recordedAt: string;
}

/** Ordine canonico degli eventi: (at, recordedAt, id). */
export function compareEvents(a: EventLike, b: EventLike): number {
  return (
    cmpNum(msKey(a.at), msKey(b.at)) ||
    cmpNum(msKey(a.recordedAt), msKey(b.recordedAt)) ||
    cmpStr(String(a.id ?? ""), String(b.id ?? ""))
  );
}

export function sortEvents<T extends EventLike>(events: Iterable<T>): T[] {
  return [...events].sort(compareEvents);
}

export interface MergeConflict<T extends EventLike = LedgerEvent> {
  id: string;
  /** Versione scelta. */
  kept: T;
  /** Altre versioni con lo stesso id e contenuto diverso, in ordine deterministico. */
  discarded: T[];
}

export interface MergeResult<T extends EventLike = LedgerEvent> {
  /** Eventi unici per id, in ordine canonico. */
  events: T[];
  conflicts: MergeConflict<T>[];
  /**
   * Voci scartate perché non unibili per id: non-oggetti, senza id, o con valori davvero non
   * serializzabili (BigInt, funzioni, cicli, istanze di classe). Senza duplicati, in ordine
   * deterministico. Le Date non rientrano qui (salvo quelle non valide): valgono come stringa ISO etichettata.
   */
  rejected: unknown[];
}

export interface MergeOptions {
  /**
   * Decide se una versione è valida ai fini dell'ordine tra versioni con lo stesso `id`
   * (la valida batte la non valida). Deve essere deterministica e dipendere solo dal contenuto.
   * Default: `validateEvent` degli eventi della dispensa. Se lancia, la versione conta come non valida.
   */
  validate?: (e: unknown) => boolean;
}

function isValid(e: unknown, validate?: (e: unknown) => boolean): boolean {
  try {
    return validate ? Boolean(validate(e)) : validateEvent(e).length === 0;
  } catch {
    return false;
  }
}

/**
 * Tra versioni diverse con lo stesso id vince, nell'ordine: la versione valida (una copia
 * corrotta non nasconde mai quella buona), poi quella registrata più tardi, poi il contenuto
 * canonico maggiore. È il massimo di un ordine totale, quindi l'unione resta idempotente,
 * commutativa e associativa.
 */
interface Version<T> {
  event: T;
  key: string;
  valid: boolean;
  recordedMs: number;
}

function compareVersions<T>(a: Version<T>, b: Version<T>): number {
  return (
    cmpNum(a.valid ? 1 : 0, b.valid ? 1 : 0) ||
    cmpNum(a.recordedMs, b.recordedMs) ||
    cmpStr(a.key, b.key)
  );
}

export interface GroupedEvents<T extends EventLike = LedgerEvent> {
  byId: Map<string, T>;
  conflicts: MergeConflict<T>[];
  /**
   * Voci senza id stringa utilizzabile, non-oggetto o non serializzabili (es. con un BigInt):
   * non si possono unire per id.
   */
  unidentifiable: unknown[];
}

export function groupById<T extends EventLike = LedgerEvent>(
  events: Iterable<T>,
  validate?: (e: unknown) => boolean,
): GroupedEvents<T> {
  const versions = new Map<string, Map<string, T>>();
  const unidentifiable: unknown[] = [];
  for (const e of events) {
    let id: string | undefined;
    let key: string | undefined;
    try {
      const raw =
        typeof e === "object" && e !== null ? (e as { id?: unknown }).id : undefined;
      if (typeof raw === "string" && raw.length > 0) {
        id = raw;
        key = strictCanonical(e);
      }
    } catch {
      key = undefined;
    }
    if (id === undefined || key === undefined) {
      unidentifiable.push(e);
      continue;
    }
    let forId = versions.get(id);
    if (!forId) versions.set(id, (forId = new Map()));
    forId.set(key, e);
  }
  const byId = new Map<string, T>();
  const conflicts: MergeConflict<T>[] = [];
  for (const id of [...versions.keys()].sort(cmpStr)) {
    const forId = versions.get(id)!;
    let kept: T;
    let discarded: T[] = [];
    if (forId.size === 1) {
      kept = [...forId.values()][0];
    } else {
      const all: Version<T>[] = [...forId].map(([key, event]) => ({
        event,
        key,
        valid: isValid(event, validate),
        recordedMs: msKey(event.recordedAt),
      }));
      all.sort(compareVersions);
      kept = all[all.length - 1].event;
      discarded = all
        .slice(0, -1)
        .reverse()
        .map((v) => v.event);
      conflicts.push({ id, kept, discarded });
    }
    byId.set(id, kept);
  }
  return { byId, conflicts, unidentifiable };
}

/**
 * Unione di più liste di eventi per `id`. Non lancia mai: le voci senza id utilizzabile
 * o non serializzabili (es. con un BigInt) non entrano in `events` ma sono elencate in `rejected`.
 */
export function mergeEventLists(
  lists: Iterable<readonly LedgerEvent[]>,
  options?: MergeOptions,
): MergeResult;
export function mergeEventLists<T extends EventLike>(
  lists: Iterable<readonly T[]>,
  options?: MergeOptions,
): MergeResult<T>;
export function mergeEventLists<T extends EventLike>(
  lists: Iterable<readonly T[]>,
  options: MergeOptions = {},
): MergeResult<T> {
  const all: T[] = [];
  for (const list of lists) for (const e of list) all.push(e);
  const { byId, conflicts, unidentifiable } = groupById(all, options.validate);
  const rejected = new Map<string, unknown>();
  for (const item of unidentifiable) rejected.set(canonicalStringify(item), item);
  return {
    events: sortEvents(byId.values()),
    conflicts,
    rejected: [...rejected.keys()].sort(cmpStr).map((k) => rejected.get(k)),
  };
}

/**
 * Unione per `id`: idempotente, commutativa e associativa quanto a `events`, per qualunque
 * `options.validate` deterministico. `conflicts` riguarda solo gli input di questa chiamata
 * (un conflitto già risolto in un'unione precedente non riappare).
 */
export function mergeEvents(
  a: readonly LedgerEvent[],
  b: readonly LedgerEvent[],
  options?: MergeOptions,
): MergeResult;
export function mergeEvents<T extends EventLike>(
  a: readonly T[],
  b: readonly T[],
  options?: MergeOptions,
): MergeResult<T>;
export function mergeEvents<T extends EventLike>(
  a: readonly T[],
  b: readonly T[],
  options: MergeOptions = {},
): MergeResult<T> {
  return mergeEventLists([a, b], options);
}
