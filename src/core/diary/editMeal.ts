// Correggere un pasto già registrato. Un pasto è un evento `meal` (con le voci libere) più i `consume` della dispensa
// che portano lo stesso `mealId`. Una voce della dispensa si corregge sostituendo il suo consumo; una voce libera, il
// momento e l'ora si correggono annullando l'evento `meal` e scrivendone uno nuovo con lo stesso `mealId`: i consumi
// restano legati al pasto senza essere riscritti. Logica pura: gli eventi vengono restituiti, non scritti.

import {
  SCHEMA_VERSION,
  UNITS,
  correct,
  generateId,
  isCalendarDate,
  validateEvent,
  voidEvent,
  worseCertainty,
  type Certainty,
  type ConsumeEvent,
  type IdGenerator,
  type Quantity,
  type ReplacementEvent,
  type VoidEvent,
} from "../ledger";
import { formatQuantity } from "../units";
import { instantOfLocal, localMoment } from "./calendar";
import { createMeal } from "./create";
import type { DiaryState } from "./derive";
import { cloneMealItems } from "./items";
import { familyConsumes, isValidKnownEvent, prepareLog, voidsOfLog } from "./log";
import { recordedLater, resolveMealVersions } from "./mealVersions";
import { mealForMoment } from "./placeConsume";
import { DEFAULT_TIME_ZONE, DIARY_LIMITS, type MealEvent, type MealItem, type MealKind } from "./types";
import { validateDiaryEvent } from "./validate";

export interface EditContext {
  deviceId: string;
  /** Istante corrente, ISO UTC. */
  now: string;
  idGenerator?: IdGenerator;
  /** Predefinito: il fuso del diario. */
  timeZone?: string;
}

export type MealEdit =
  | { ok: true; events: (MealEvent | ConsumeEvent | VoidEvent)[] }
  | { ok: false; error: string };

const MEAL_GONE = "Questo pasto non c'è più.";
const ITEM_GONE = "Questa voce non c'è più.";
const NO_QUANTITY = "Scrivi una quantità, per esempio 80.";
const NO_NAME = "Scrivi come si chiama.";
const NO_ENERGY = "La stima non è un numero valido.";
const BAD_TIME = "Scegli un'ora valida.";
const BAD_DAY = "Scegli un giorno valido.";
const FUTURE_DAY = "Non posso mettere un pasto in un giorno che deve ancora venire.";
const UNREADABLE_TIME = "Non riesco a leggere l'ora.";
const CANNOT_WRITE = "Non riesco a scrivere la correzione.";

const EPSILON = 1e-9;

/**
 * Ora tipica di ogni momento (minuti), per un pasto che nasce in un giorno diverso da quello di partenza.
 * È la stessa tabella di `placeConsume.ts`, che non la esporta: `editMeal.test.ts` controlla che coincidano.
 */
const TYPICAL_MINUTES: Record<MealKind, number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
  snack: 16 * 60 + 30,
};

const fail = (error: string): MealEdit => ({ ok: false, error });
const nothing = (): MealEdit => ({ ok: true, events: [] });

/** Niente si restituisce se anche un solo evento non è valido: meglio non scrivere che scrivere a metà. */
function checked(events: (MealEvent | ConsumeEvent | VoidEvent)[]): MealEdit {
  for (const e of events) {
    const errors = e.type === "consume" ? validateEvent(e) : validateDiaryEvent(e);
    if (errors.length > 0) return fail(CANNOT_WRITE);
  }
  return { ok: true, events };
}

interface Factory {
  idGenerator: IdGenerator;
  now: () => string;
  deviceId: string;
}

const factoryOf = (ctx: EditContext): Factory => ({
  idGenerator: ctx.idGenerator ?? generateId,
  now: () => ctx.now,
  deviceId: ctx.deviceId,
});

interface MealNow {
  /**
   * Il pasto come lo mostra `deriveDiary`: l'evento più recente, con momento, ora e voci già uniti alle altre versioni
   * valide dove si può. Per un pasto tolto a cui resta un consumo valido, l'ultimo evento annullato senza voci libere.
   */
  meal: MealEvent;
  /** Tutti gli eventi `meal` non annullati con questo `mealId`: più di uno dopo l'unione di due dispositivi. */
  live: MealEvent[];
  consumes: ConsumeEvent[];
}

function readMeal(mealId: string, log: Iterable<unknown>): MealNow | undefined {
  const prepared = prepareLog(log);
  const { voided } = voidsOfLog(prepared.events);
  const live: MealEvent[] = [];
  const consumes: ConsumeEvent[] = [];
  const mealsById = new Map<string, MealEvent>();
  let lastVoided: MealEvent | undefined;
  let removed = 0;
  for (const e of prepared.events) {
    const rec = e as { id?: unknown; type?: unknown; mealId?: unknown };
    if (typeof rec.id !== "string" || (rec.type !== "meal" && rec.type !== "consume")) continue;
    if (rec.type === "consume" && rec.mealId !== mealId) continue;
    if (!isValidKnownEvent(e)) continue;
    if (rec.type === "meal") {
      const m = e as MealEvent;
      // tutti i pasti, anche di altri `mealId` e annullati: servono per risalire alla versione comune
      mealsById.set(m.id, m);
      if (m.mealId !== mealId) continue;
      if (!voided.has(m.id)) live.push(m);
      else if (!lastVoided || recordedLater(m, lastVoided)) lastVoided = m;
    } else if (voided.has(rec.id)) removed++;
    else consumes.push(e as ConsumeEvent);
  }
  // Le stesse regole di `deriveDiary`. Un pasto senza voci proprie e con tutti i consumi non più validi non compare.
  const ghost = consumes.length === 0 && removed > 0;
  const shown = ghost ? live.filter((m) => (m.items?.length ?? 0) > 0) : live;
  if (shown.length > 0) {
    const r = resolveMealVersions(shown, (id) => mealsById.get(id));
    const { items: _items, ...rest } = r.winner;
    void _items;
    const meal: MealEvent = {
      ...rest,
      kind: r.kind,
      at: r.at,
      certainty: r.certainty,
      ...(r.items.length > 0 || r.winner.items !== undefined ? { items: r.items } : {}),
    };
    return { meal, live, consumes };
  }
  // Un pasto tolto a cui resta un consumo valido compare ancora, senza voci libere: una correzione ne scrive uno nuovo.
  if (live.length === 0 && consumes.length > 0 && lastVoided) {
    const { items: _items, title: _title, habitId: _habitId, ...rest } = lastVoided;
    void [_items, _title, _habitId];
    return { meal: rest, live: [], consumes };
  }
  return undefined;
}

/**
 * Il pasto com'è adesso: l'evento `meal` in vigore e i suoi consumi non annullati. `undefined` se non c'è più.
 * Se due dispositivi l'hanno corretto prima di unirsi, `meal` è la versione più recente con momento, ora e voci già
 * uniti alle altre (come in `deriveDiary`); se il pasto è stato tolto ma gli resta un consumo valido, è l'ultimo evento
 * annullato, senza voci libere.
 */
export function currentMeal(
  mealId: string,
  log: Iterable<unknown>,
): { meal: MealEvent; consumes: ConsumeEvent[] } | undefined {
  const cur = readMeal(mealId, log);
  return cur ? { meal: cur.meal, consumes: cur.consumes } : undefined;
}

// Si annullano tutti gli eventi in vigore con questo `mealId`, non solo quello mostrato: se due dispositivi hanno
// corretto lo stesso pasto prima di unirsi ne restano due, e annullandone uno solo riaffiorerebbe l'altro.
const voidAll = (cur: MealNow, f: Factory): VoidEvent[] => cur.live.map((m) => voidEvent(m, f));

function nextMeal(
  cur: MealNow,
  patch: { items?: MealItem[]; kind?: MealKind; at?: string; certainty?: Certainty },
  f: Factory,
): MealEvent {
  const old = cur.meal;
  const { items: _items, ...rest } = old;
  void _items;
  const items = patch.items ?? (old.items === undefined ? undefined : cloneMealItems(old.items));
  return {
    ...rest,
    id: f.idGenerator(),
    at: patch.at ?? old.at,
    recordedAt: f.now(),
    deviceId: f.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: patch.certainty ?? old.certainty,
    replaces: old.id,
    kind: patch.kind ?? old.kind,
    ...(items !== undefined ? { items } : {}),
  };
}

function rewrite(cur: MealNow, patch: Parameters<typeof nextMeal>[1], ctx: EditContext): MealEdit {
  const f = factoryOf(ctx);
  const voids = voidAll(cur, f);
  return checked([...voids, nextMeal(cur, patch, f)]);
}

const isIndex = (index: number, length: number): boolean => Number.isInteger(index) && index >= 0 && index < length;

const isQuantity = (q: Quantity | undefined): q is Quantity =>
  typeof q === "object" &&
  q !== null &&
  typeof q.value === "number" &&
  Number.isFinite(q.value) &&
  q.value > 0 &&
  (UNITS as readonly string[]).includes(q.unit);

/** Voce della dispensa: nuova quantità. `available` è quanto si può mangiare al massimo: ciò che resta nel lotto più questo consumo. */
export function changeConsumeQuantity(
  consume: ConsumeEvent,
  next: { value: number; estimated: boolean },
  available: number,
  ctx: EditContext,
): MealEdit {
  if (typeof next.value !== "number" || !Number.isFinite(next.value) || next.value <= 0) return fail(NO_QUANTITY);
  const unit = consume.quantity.unit;
  // La certezza può solo peggiorare: una quantità riscritta a mano non diventa una pesata.
  const certainty = worseCertainty(consume.certainty, next.estimated === true ? "estimated" : "measured");
  if (next.value === consume.quantity.value && certainty === consume.certainty) return nothing();
  if (typeof available !== "number" || !Number.isFinite(available)) return fail(CANNOT_WRITE);
  if (next.value - available > EPSILON) {
    return fail(`Ne restavano ${formatQuantity({ value: Math.max(available, 0), unit })}.`);
  }
  const value = Math.abs(next.value - available) <= EPSILON ? available : next.value;

  // i campi che `correct` ricava da solo non si passano: l'istante resta quello del consumo corretto
  const { id: _id, at: _at, recordedAt: _rec, deviceId: _dev, schemaVersion: _sv, replaces: _rep, ...rest } = consume;
  void [_id, _at, _rec, _dev, _sv, _rep];
  const [voided, replacement] = correct(
    consume,
    { ...rest, quantity: { value, unit }, certainty } as ReplacementEvent,
    factoryOf(ctx),
  );
  // Il sostituto di un sostituto cita lo stesso consumo del primo, non quello appena annullato. `supersededConsumes`
  // risale comunque la catena, ma così la famiglia resta una anche se un anello intermedio non è ancora arrivato.
  const root = typeof consume.replaces === "string" && consume.replaces !== "" ? consume.replaces : consume.id;
  return checked([voided, { ...(replacement as ConsumeEvent), replaces: root }]);
}

/**
 * Toglie una voce della dispensa da un pasto. Annulla tutti i consumi ancora validi della sua famiglia (il consumo, i
 * suoi sostituti e ciò che sostituisce), non solo quello mostrato: dopo una correzione fatta su due telefoni ne resta
 * uno scartato ma non annullato, e annullando solo il vincitore tornerebbe a contare. Il pasto rimasto senza voci
 * sparisce da solo (regola di `deriveDiary`).
 */
export function removeConsume(consume: Pick<ConsumeEvent, "id">, log: Iterable<unknown>, ctx: EditContext): MealEdit {
  const targets = familyConsumes(log, [consume]);
  if (targets.length === 0) return fail(ITEM_GONE);
  const f = factoryOf(ctx);
  return checked(targets.map((c) => voidEvent(c, f)));
}

/**
 * Voce libera (per posizione in `items`): nuova quantità o nuovo nome. Per una voce «fuori casa» anche una nuova
 * energia stimata (`energyKcal`), di solito insieme al nome della taglia: una voce che non la porta già non la riceve,
 * perché smetterebbe di essere calcolata dai suoi alimenti.
 */
export function changeItem(
  mealId: string,
  index: number,
  change: { quantity?: Quantity; name?: string; energyKcal?: number },
  log: Iterable<unknown>,
  ctx: EditContext,
): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  const items = cloneMealItems(cur.meal.items);
  if (!isIndex(index, items.length)) return fail(ITEM_GONE);
  const item = items[index];
  let next = item;

  if (change.name !== undefined) {
    const name = typeof change.name === "string" ? change.name.trim().replace(/\s+/g, " ") : "";
    if (name === "") return fail(NO_NAME);
    if (name !== item.name) {
      next = { ...next, name };
      // Un altro alimento non può tenersi i valori scelti per quello di prima: il collegamento si rifà dal nome.
      if (name.toLowerCase() !== item.name.trim().replace(/\s+/g, " ").toLowerCase()) delete next.foodId;
    }
  }
  if (change.quantity !== undefined) {
    if (!isQuantity(change.quantity)) return fail(NO_QUANTITY);
    const { value, unit } = change.quantity;
    if (value !== item.quantity.value || unit !== item.quantity.unit) next = { ...next, quantity: { value, unit } };
  }
  if (change.energyKcal !== undefined) {
    const kcal = change.energyKcal;
    if (item.energyKcal === undefined) return fail(CANNOT_WRITE);
    if (typeof kcal !== "number" || !Number.isFinite(kcal) || kcal < 0 || kcal > DIARY_LIMITS.energyKcalMax) return fail(NO_ENERGY);
    if (kcal !== item.energyKcal) next = { ...next, energyKcal: kcal };
  }
  if (next === item) return nothing();
  items[index] = next;
  return rewrite(cur, { items }, ctx);
}

/** Toglie una voce libera. Se il pasto resta senza voci libere e senza consumi, annulla il pasto e basta. */
export function removeItem(mealId: string, index: number, log: Iterable<unknown>, ctx: EditContext): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  const items = cloneMealItems(cur.meal.items);
  if (!isIndex(index, items.length)) return fail(ITEM_GONE);
  items.splice(index, 1);
  if (items.length === 0 && cur.consumes.length === 0) return checked(voidAll(cur, factoryOf(ctx)));
  return rewrite(cur, { items }, ctx);
}

/** Sposta una voce libera in un altro momento (o giorno): la toglie da questo pasto e la aggiunge al pasto di quel momento, o ne crea uno. */
export function moveItem(
  mealId: string,
  index: number,
  target: { kind: MealKind; date?: string },
  log: Iterable<unknown>,
  state: DiaryState,
  ctx: EditContext,
): MealEdit {
  const list = [...log];
  const cur = readMeal(mealId, list);
  if (!cur) return fail(MEAL_GONE);
  const items = cloneMealItems(cur.meal.items);
  if (!isIndex(index, items.length)) return fail(ITEM_GONE);

  const tz = ctx.timeZone ?? state?.timeZone ?? DEFAULT_TIME_ZONE;
  const from = localMoment(cur.meal.at, tz);
  if (!from) return fail(UNREADABLE_TIME);
  if (target.date !== undefined && !isCalendarDate(target.date)) return fail(BAD_DAY);
  const date = target.date ?? from.date;
  if (date === from.date && target.kind === cur.meal.kind) return nothing();
  if (date !== from.date) {
    const today = localMoment(ctx.now, tz)?.date;
    if (today === undefined) return fail(CANNOT_WRITE);
    if (date > today) return fail(FUTURE_DAY);
  }

  const existing = mealForMoment(state, date, target.kind);
  if (existing?.mealId === mealId) return nothing();
  // `state` può essere più vecchio del registro: il pasto di arrivo vale solo se nel registro c'è ancora
  const there = existing ? readMeal(existing.mealId, list) : undefined;

  const [item] = items.splice(index, 1);
  const f = factoryOf(ctx);
  const emptied = items.length === 0 && cur.consumes.length === 0;
  const voids = [...voidAll(cur, f), ...(there ? voidAll(there, f) : [])];
  const written: MealEvent[] = emptied ? [] : [nextMeal(cur, { items }, f)];

  if (there) {
    written.push(
      nextMeal(
        there,
        { items: [...cloneMealItems(there.meal.items), item], certainty: worseCertainty(there.meal.certainty, item.certainty) },
        f,
      ),
    );
  } else {
    // Lo stesso giorno il pasto nuovo porta l'ora di quello di partenza; un altro giorno, l'ora tipica del momento.
    const at = date === from.date ? cur.meal.at : instantOfLocal(date, TYPICAL_MINUTES[target.kind], tz);
    if (at === undefined) return fail(UNREADABLE_TIME);
    try {
      written.push(createMeal({ kind: target.kind, items: [item] }, { ...f, at, certainty: item.certainty }));
    } catch {
      return fail(CANNOT_WRITE);
    }
  }
  return checked([...voids, ...written]);
}

/** Tutto il pasto in un altro momento, giorno o ora. Ciò che non è indicato resta com'è. `minutes`: minuti dalla mezzanotte. */
export function rewriteMeal(
  mealId: string,
  change: { kind?: MealKind; date?: string; minutes?: number },
  log: Iterable<unknown>,
  ctx: EditContext,
): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  const old = cur.meal;
  const kind = change.kind ?? old.kind;
  let at = old.at;

  if (change.date !== undefined || change.minutes !== undefined) {
    const { minutes } = change;
    if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 0 && minutes < 1440)) return fail(BAD_TIME);
    if (change.date !== undefined && !isCalendarDate(change.date)) return fail(BAD_DAY);
    const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
    const was = localMoment(old.at, tz);
    if (!was) return fail(UNREADABLE_TIME);
    const date = change.date ?? was.date;
    if (date !== was.date) {
      const today = localMoment(ctx.now, tz)?.date;
      if (today === undefined) return fail(CANNOT_WRITE);
      if (date > today) return fail(FUTURE_DAY);
    }
    // Giorno e ora uguali a prima: l'istante resta identico, secondi compresi.
    if (date !== was.date || (minutes ?? was.minutes) !== was.minutes) {
      const moved = instantOfLocal(date, minutes ?? was.minutes, tz);
      if (moved === undefined) return fail(BAD_TIME);
      at = moved;
    }
  }
  if (kind === old.kind && at === old.at) return nothing();
  return rewrite(cur, { kind, at }, ctx);
}

/**
 * Abbassa la certezza di un pasto che c'è già, per esempio quando gli si aggiunge un consumo stimato: se `certainty` è
 * peggiore di quella del pasto lo riscrive, altrimenti niente. La certezza di un pasto non migliora mai.
 */
export function lowerMealCertainty(mealId: string, certainty: Certainty, log: Iterable<unknown>, ctx: EditContext): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  const next = worseCertainty(cur.meal.certainty, certainty);
  if (next === cur.meal.certainty) return nothing();
  return rewrite(cur, { certainty: next }, ctx);
}

/** Aggiunge voci libere a un pasto che c'è già. */
export function appendItems(mealId: string, items: readonly MealItem[], log: Iterable<unknown>, ctx: EditContext): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  if (!Array.isArray(items)) return fail(CANNOT_WRITE);
  if (items.length === 0) return nothing();
  const added = cloneMealItems(items);
  // Una voce stimata in più rende stimato il pasto: la certezza può solo peggiorare, mai migliorare.
  let certainty = cur.meal.certainty;
  for (const item of added) {
    if (typeof item !== "object" || item === null) return fail(CANNOT_WRITE);
    certainty = worseCertainty(certainty, item.certainty);
  }
  return rewrite(cur, { items: [...cloneMealItems(cur.meal.items), ...added], certainty }, ctx);
}

const sameItems = (a: readonly MealItem[] | undefined, b: readonly MealItem[] | undefined): boolean =>
  JSON.stringify(cloneMealItems(a)) === JSON.stringify(cloneMealItems(b));

/**
 * Chiude un pasto corretto in due modi che non si sono potuti unire, tenendo il contenuto scelto: quello mostrato
 * oppure quello di un'altra versione (`DiaryMeal.otherVersions`). Annulla tutte le versioni in vigore e ne scrive una
 * nuova con quel momento, quell'ora e quelle voci libere: così una versione in vigore resta sempre, anche se su un
 * altro dispositivo, prima di unirsi, si fa la scelta opposta (annullando soltanto, due scelte opposte non
 * lascerebbero niente). La versione nuova cita in `replaces` quella di cui tiene il contenuto: due dispositivi che
 * scelgono la stessa si uniscono senza doppioni; due che scelgono in modo opposto restano due versioni in conflitto,
 * di cui vale la più recente. I consumi della dispensa non si toccano. Niente da scrivere se c'è una sola versione ed
 * è già quella scelta.
 */
export function keepMealVersion(
  mealId: string,
  chosen: { at: string; kind: MealKind; items: readonly MealItem[] },
  log: Iterable<unknown>,
  ctx: EditContext,
): MealEdit {
  const cur = readMeal(mealId, log);
  if (!cur) return fail(MEAL_GONE);
  if (typeof chosen !== "object" || chosen === null || !Array.isArray(chosen.items) || typeof chosen.at !== "string") return fail(CANNOT_WRITE);
  const items = cloneMealItems(chosen.items);
  const same = (m: MealEvent): boolean => m.kind === chosen.kind && m.at === chosen.at && sameItems(m.items, items);
  if (cur.live.length <= 1 && same(cur.meal)) return nothing();

  const kept = same(cur.meal) ? cur.meal : (cur.live.find(same) ?? cur.meal);
  // La certezza può solo peggiorare: quella mostrata tiene già conto delle versioni unite.
  let certainty = cur.meal.certainty;
  for (const item of items) {
    if (typeof item !== "object" || item === null) return fail(CANNOT_WRITE);
    certainty = worseCertainty(certainty, item.certainty);
  }
  const f = factoryOf(ctx);
  // un pasto nato senza voci libere non prende un elenco vuoto
  const patch = { kind: chosen.kind, at: chosen.at, certainty, ...(items.length > 0 || cur.meal.items !== undefined ? { items } : {}) };
  return checked([...voidAll(cur, f), { ...nextMeal(cur, patch, f), replaces: kept.id }]);
}
