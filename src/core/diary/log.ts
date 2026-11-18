// Preparazione del registro: unione per id, validazione e annullamenti.
// Condivisa da `deriveDiary` e da `mealsWithPantry`.

import {
  canonicalStringify,
  isPantryEvent,
  mergeEvents,
  supersededConsumes,
  validateEvent,
  type ConsumeEvent,
  type EventLike,
  type ValidationError,
} from "../ledger";
// `consumeRoots` non è tra le esportazioni del libro mastro: serve solo qui, per ragionare per famiglie di consumi
import { consumeRoots } from "../ledger/supersede";
import { isOtherFamilyEvent } from "./foreign";
import { isDiaryEvent, validateDiaryEvent } from "./validate";
import { resolveVoids, type VoidFinding, type VoidRef } from "./voids";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isVoid = (e: unknown): boolean => isRecord(e) && e.type === "void";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Errori di un evento noto (dispensa, diario o `void`). Gli eventi delle altre famiglie note
 * non sono validati qui (nessun errore); i tipi sconosciuti non sono mai validi.
 */
function knownErrors(e: unknown): ValidationError[] {
  if (isVoid(e) || isDiaryEvent(e)) return validateDiaryEvent(e);
  if (safe(() => isPantryEvent(e), false)) return validateEvent(e);
  // Altre famiglie: non è compito del diario validarle.
  if (isOtherFamilyEvent(e)) return [];
  return [{ path: "type", code: "invalid_value" }];
}

/** Criterio di validità per l'unione: tra versioni diverse con lo stesso id vince quella valida. */
export function isValidKnownEvent(e: unknown): boolean {
  return safe(() => knownErrors(e).length === 0, false);
}

/**
 * Gli eventi su cui si ragiona per famiglie di consumi: quelli validi, più ogni evento che non è della dispensa
 * (anche non valido o di tipo sconosciuto). Un consumo che cita uno di questi non cita un consumo: è la stessa
 * regola con cui la dispensa tratta gli eventi degli altri moduli, così dispensa e diario contano le stesse voci.
 */
function familyEvents(events: readonly unknown[]): unknown[] {
  return events.filter(
    (e) =>
      isValidKnownEvent(e) ||
      (isRecord(e) && typeof e.type === "string" && typeof e.id === "string" && !safe(() => isPantryEvent(e), false)),
  );
}

/** Evento di dispensa o di un'altra famiglia nota: il diario lo ignora. */
const isForeignToDiary = (e: unknown): boolean =>
  safe(() => isPantryEvent(e), false) || isOtherFamilyEvent(e);

export interface PreparedLog {
  /** Eventi unici per id, in ordine canonico (at, recordedAt, id). */
  events: unknown[];
  /** Id con versioni diverse e contenuti diversi (esclusi quelli degli eventi che il diario ignora). */
  conflictIds: string[];
  /** Voci non unibili (senza id, non oggetti, non serializzabili), senza duplicati e in ordine deterministico. */
  rejected: unknown[];
}

export function prepareLog(events: Iterable<unknown>): PreparedLog {
  // Voci che non sono eventi finiscono in `rejected`: il tipo `EventLike` è solo formale.
  const list = [...events] as EventLike[];
  const merged = mergeEvents<EventLike>(list, [], { validate: isValidKnownEvent });
  return {
    events: merged.events as unknown[],
    conflictIds: merged.conflicts
      .filter((c) => isVoid(c.kept) || !isForeignToDiary(c.kept))
      .map((c) => c.id)
      .sort(),
    rejected: merged.rejected,
  };
}

/** Errori da riportare per una voce non unibile. */
export function rejectedErrors(item: unknown): ValidationError[] {
  const errors = safe(() => validateDiaryEvent(item), []);
  return errors.length > 0 ? errors : [{ path: "", code: "unserializable" }];
}

export function rejectedKey(item: unknown): string {
  return canonicalStringify(item);
}

export interface VoidsOfLog {
  /** Eventi che non contano: annullati da un `void`, più i consumi scartati perché un altro della famiglia vale al loro posto. */
  voided: Set<string>;
  /** Tra i `voided`, i consumi che nessun `void` ha annullato: non contano solo perché ne vale un altro. */
  superseded: Set<string>;
  findings: VoidFinding[];
}

/** Risolve gli annullamenti validi presenti nel registro unito. */
export function voidsOfLog(events: readonly unknown[]): VoidsOfLog {
  const refs: VoidRef[] = [];
  const knownIds = new Set<string>();
  for (const e of events) {
    if (!isRecord(e)) continue;
    if (typeof e.id === "string" && e.id.length > 0) knownIds.add(e.id);
    if (e.type === "void" && validateDiaryEvent(e).length === 0) {
      refs.push({ id: e.id as string, targetEventId: e.targetEventId as string });
    }
  }
  const { voided, findings } = resolveVoids(refs, knownIds);
  // più sostituti dello stesso consumo (due dispositivi): ne vale uno solo, come nella dispensa
  const superseded = supersededConsumes(familyEvents(events), voided);
  for (const id of superseded) voided.add(id);
  return { voided, superseded, findings };
}

/** `a` è stato registrato dopo `b`: per `recordedAt`, poi per `id`. */
function recordedAfter(a: ConsumeEvent, b: ConsumeEvent): boolean {
  const d = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  return d > 0 || (d === 0 && a.id > b.id);
}

const isValidConsume = (e: unknown): e is ConsumeEvent =>
  isRecord(e) && e.type === "consume" && typeof e.id === "string" && isValidKnownEvent(e);

/**
 * Le voci della dispensa tolte da ogni pasto, per `mealId`. Una voce è una famiglia di consumi (un consumo e i suoi
 * sostituti): è tolta solo se nessuno della famiglia è ancora valido. Un consumo annullato perché corretto o spostato
 * ha un sostituto valido, quindi non è una voce tolta. La voce tolta va al pasto in cui stava per ultimo.
 * `events` è il registro unito, `voids` il risultato di `voidsOfLog` sullo stesso registro.
 */
export function removedMealLines(events: readonly unknown[], voids: VoidsOfLog): Map<string, number> {
  const roots = consumeRoots(familyEvents(events));
  const families = new Map<string, { alive: boolean; last: ConsumeEvent }>();
  for (const c of events) {
    if (!isValidConsume(c)) continue;
    const alive = !voids.voided.has(c.id) || voids.superseded.has(c.id);
    const root = roots.get(c.id) ?? c.id;
    const family = families.get(root);
    if (!family) families.set(root, { alive, last: c });
    else {
      family.alive = family.alive || alive;
      if (recordedAfter(c, family.last)) family.last = c;
    }
  }
  const out = new Map<string, number>();
  for (const { alive, last } of families.values()) {
    if (alive || typeof last.mealId !== "string" || last.mealId === "") continue;
    out.set(last.mealId, (out.get(last.mealId) ?? 0) + 1);
  }
  return out;
}

/**
 * Tutti i `consume` ancora validi (non annullati da un `void`) della famiglia dei consumi dati: i consumi stessi, i
 * loro sostituti e ciò che sostituiscono, anche quelli che oggi non contano perché ne vale un altro. Sono gli eventi da
 * annullare per togliere una voce: annullando solo quello mostrato tornerebbe a contare il sostituto scritto da un altro
 * dispositivo. Ordine canonico. Serve il registro intero, `void` compresi.
 */
export function familyConsumes(events: Iterable<unknown>, of: readonly Pick<ConsumeEvent, "id">[]): ConsumeEvent[] {
  const log = prepareLog(events);
  const voids = voidsOfLog(log.events);
  const roots = consumeRoots(familyEvents(log.events));
  const wanted = new Set(of.map((c) => roots.get(c.id) ?? c.id));
  const out: ConsumeEvent[] = [];
  for (const e of log.events) {
    if (!isValidConsume(e)) continue;
    if (voids.voided.has(e.id) && !voids.superseded.has(e.id)) continue;
    if (wanted.has(roots.get(e.id) ?? e.id)) out.push(e);
  }
  return out;
}

/**
 * `consume` validi e non annullati che portano un `mealId`, in ordine canonico.
 * Serve il registro intero, `void` compresi.
 */
export function activeConsumes(events: Iterable<unknown>): ConsumeEvent[] {
  const log = prepareLog(events);
  const { voided } = voidsOfLog(log.events);
  const out: ConsumeEvent[] = [];
  for (const e of log.events) {
    const c = e as Partial<ConsumeEvent>;
    if (c.type !== "consume" || typeof c.mealId !== "string" || c.mealId === "") continue;
    if (voided.has(c.id as string) || !isValidKnownEvent(e)) continue;
    out.push(e as ConsumeEvent);
  }
  return out;
}

/** Id e dispositivo dei pasti validi e non annullati con questo `mealId`, in ordine canonico. */
export function activeMealEvents(
  events: Iterable<unknown>,
  mealId: string,
): { id: string; deviceId: string }[] {
  const log = prepareLog(events);
  const { voided } = voidsOfLog(log.events);
  const out: { id: string; deviceId: string }[] = [];
  for (const e of log.events) {
    const m = e as { id: string; type?: unknown; mealId?: unknown; deviceId: string };
    if (m.type !== "meal" || m.mealId !== mealId) continue;
    if (voided.has(m.id) || !isValidKnownEvent(e)) continue;
    out.push({ id: m.id, deviceId: m.deviceId });
  }
  return out;
}
