// Un consumo di dispensa che nasce da un tocco (un pezzo, mezzo pezzo, «Mangiato») va nel diario del giorno,
// nel momento giusto: se in quel momento c'è già un pasto vi si aggiunge, altrimenti nasce un pasto con quel solo
// alimento. Cambiare momento è una correzione: il consumo vecchio si annulla e se ne scrive uno nuovo; se lo
// spostamento fa nascere un pasto, quel pasto prende l'ora tipica del momento di arrivo.
// Logica pura: gli eventi vengono restituiti, non scritti.

import {
  correct,
  generateId,
  worseCertainty,
  type Certainty,
  type ConsumeEvent,
  type IdGenerator,
  type LedgerEvent,
  type ReplacementEvent,
  type VoidEvent,
} from "../ledger";
import { addDays, instantOfLocal, localMoment } from "./calendar";
import { createMeal } from "./create";
import type { DiaryMeal, DiaryState } from "./derive";
import { momentOfMinutes } from "./selectors";
import { DEFAULT_TIME_ZONE, type MealEvent, type MealKind } from "./types";

/** Nota dei consumi nati da un tocco sulla scheda di un alimento: Oggi li riconosce e li lascia spostare o annullare da soli. */
export const QUICK_CONSUME_NOTE = "quick";

/** Il consumo nasce da un tocco rapido sulla scheda di un alimento. */
export const isQuickConsume = (c: Pick<ConsumeEvent, "note">): boolean => c.note === QUICK_CONSUME_NOTE;

export interface PlaceContext {
  deviceId: string;
  /** Istante corrente ISO UTC. */
  now: string;
  idGenerator?: IdGenerator;
  /** Predefinito: il fuso del diario, poi quello di default. */
  timeZone?: string;
}

/** Dove va un consumo: tutto opzionale, ciò che manca si ricava dall'ora in cui è stato mangiato. */
export interface PlaceTarget {
  kind?: MealKind;
  /** Giorno di calendario `YYYY-MM-DD`; predefinito il giorno in cui è stato mangiato. */
  date?: string;
}

export interface Placement {
  /** Il pasto nuovo (se serve), poi i consumi legati al pasto; per un cambio di momento anche i `void`. */
  events: (MealEvent | ConsumeEvent | VoidEvent)[];
  mealId: string;
  kind: MealKind;
  date: string;
  /** Il consumo si è aggiunto a un pasto che c'era già. */
  joined: boolean;
  /** I consumi come sono stati scritti (con `mealId`). */
  consumes: ConsumeEvent[];
}

export type PlaceResult = ({ ok: true } & Placement) | { ok: false; error: string };

/** Ora tipica di ogni momento (minuti), per un pasto di un giorno che non è quello di adesso o che nasce da uno spostamento. */
const TYPICAL_MINUTES: Record<MealKind, number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
  snack: 16 * 60 + 30,
};

/** Il momento a cui appartiene un istante, dall'ora locale (la stessa regola delle bevande). */
export function momentKindAt(at: string, timeZone: string = DEFAULT_TIME_ZONE): MealKind {
  const m = localMoment(at, timeZone);
  return m ? momentOfMinutes(m.minutes) : "snack";
}

/** Il pasto del giorno a cui aggiungere un consumo di quel momento: l'ultimo, per orario. Nessuno se il momento è vuoto. */
export function mealForMoment(state: DiaryState | undefined, date: string, kind: MealKind): DiaryMeal | undefined {
  const day = state?.days.find((d) => d.date === date);
  const meals = (day?.meals ?? []).filter((m) => m.kind === kind);
  if (meals.length === 0) return undefined;
  return meals.reduce((last, m) => (m.at > last.at || (m.at === last.at && m.eventId > last.eventId) ? m : last));
}

function resolveTarget(anchorAt: string, target: PlaceTarget, tz: string): { kind: MealKind; date: string; mealAt: string } | undefined {
  const anchor = localMoment(anchorAt, tz);
  if (!anchor) return undefined;
  const kind = target.kind ?? momentOfMinutes(anchor.minutes);
  const date = target.date ?? anchor.date;
  // Lo stesso giorno il pasto porta l'ora vera; un altro giorno, l'ora tipica del momento.
  const mealAt = date === anchor.date ? anchorAt : instantOfLocal(date, TYPICAL_MINUTES[kind], tz);
  return mealAt === undefined ? undefined : { kind, date, mealAt };
}

function worst(consumes: readonly ConsumeEvent[]): Certainty {
  return consumes.reduce<Certainty>((acc, c) => worseCertainty(acc, c.certainty), "measured");
}

/**
 * Mette dei consumi appena costruiti (senza `mealId`) nel diario. Il momento è quello dell'ora in cui sono stati
 * mangiati (`at` del primo consumo), a meno che non si scelga. Un pasto del momento già registrato li accoglie;
 * altrimenti nasce un pasto vuoto di voci proprie, che vale solo finché ha un consumo: se il consumo viene
 * annullato, il pasto sparisce da solo (vedi `deriveDiary`).
 */
export function placeConsumes(
  consumes: readonly ConsumeEvent[],
  state: DiaryState | undefined,
  ctx: PlaceContext,
  target: PlaceTarget = {},
): PlaceResult {
  return place(consumes, state, ctx, target);
}

/** `newMealAt`: l'istante del pasto, se deve nascere, quando non è quello che si ricava dal consumo. */
function place(
  consumes: readonly ConsumeEvent[],
  state: DiaryState | undefined,
  ctx: PlaceContext,
  target: PlaceTarget,
  newMealAt?: string,
): PlaceResult {
  if (consumes.length === 0) return { ok: false, error: "Non c'è niente da segnare." };
  const tz = ctx.timeZone ?? state?.timeZone ?? DEFAULT_TIME_ZONE;
  const resolved = resolveTarget(consumes[0].at, target, tz);
  if (!resolved) return { ok: false, error: "Non riesco a leggere l'ora." };
  const { kind, date, mealAt } = resolved;

  const existing = mealForMoment(state, date, kind);
  const mealEvent = existing
    ? undefined
    : createMeal(
        { kind },
        {
          deviceId: ctx.deviceId,
          now: () => ctx.now,
          ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}),
          at: newMealAt ?? mealAt,
          certainty: worst(consumes),
        },
      );
  const mealId = existing?.mealId ?? (mealEvent as MealEvent).mealId;
  const placed = consumes.map((c) => ({ ...c, mealId }));
  return {
    ok: true,
    events: [...(mealEvent ? [mealEvent] : []), ...placed],
    mealId,
    kind,
    date,
    joined: existing !== undefined,
    consumes: placed,
  };
}

/** L'ora da cui parte uno spostamento: quella del pasto in cui i consumi stanno adesso; senza pasto, quella del primo consumo. */
function departureOf(consumes: readonly ConsumeEvent[], state: DiaryState | undefined): string {
  const mealId = consumes[0].mealId;
  if (typeof mealId === "string" && mealId !== "") {
    for (const day of state?.days ?? []) {
      const meal = day.meals.find((m) => m.mealId === mealId);
      if (meal) return meal.at;
    }
  }
  return consumes[0].at;
}

/**
 * Cambia il momento di consumi già nel diario: ogni consumo si annulla e se ne scrive uno uguale (stesso lotto,
 * stessa quantità, stesso istante) legato al pasto nuovo o già presente. Niente si conta due volte: il consumo
 * vecchio è annullato. «Annulla» su tutti gli eventi restituiti riporta le cose com'erano. Il pasto da cui i consumi
 * partono, se resta senza voci, sparisce da solo.
 * Un pasto che nasce dallo spostamento prende l'ora tipica del momento di arrivo, anche nello stesso giorno: con l'ora
 * di partenza una voce della cena finirebbe in un «pranzo delle 22:40». Tiene l'ora di partenza solo se questa cade
 * già nella fascia di quel momento (uno spuntino delle 12:40 che diventa pranzo). Oggi l'ora del pasto nuovo non va
 * mai oltre adesso: alle 9:00, «a cena» dà una cena delle 9:00, non una delle 20:00 che deve ancora venire. Un pasto
 * di arrivo che c'è già resta com'è, e l'istante dei consumi non cambia mai: è quando l'alimento è uscito dalla
 * dispensa.
 */
export function moveConsumes(
  consumes: readonly ConsumeEvent[],
  state: DiaryState | undefined,
  ctx: PlaceContext,
  target: { kind: MealKind; date?: string },
): PlaceResult {
  if (consumes.length === 0) return { ok: false, error: "Non c'è niente da spostare." };
  const tz = ctx.timeZone ?? state?.timeZone ?? DEFAULT_TIME_ZONE;
  const resolved = resolveTarget(consumes[0].at, target, tz);
  if (!resolved) return { ok: false, error: "Non riesco a leggere l'ora." };
  const existing = mealForMoment(state, resolved.date, resolved.kind);
  if (existing && consumes.every((c) => c.mealId === existing.mealId)) {
    return { ok: false, error: "È già in questo momento." };
  }
  const from = departureOf(consumes, state);
  const left = localMoment(from, tz);
  const keepsTime = left !== undefined && left.date === resolved.date && momentOfMinutes(left.minutes) === resolved.kind;
  const chosen = keepsTime ? from : instantOfLocal(resolved.date, TYPICAL_MINUTES[resolved.kind], tz);
  if (chosen === undefined) return { ok: false, error: "Non riesco a leggere l'ora." };
  const newMealAt = Date.parse(chosen) > Date.parse(ctx.now) ? ctx.now : chosen;
  const placement = place(consumes, state, ctx, target, newMealAt);
  if (!placement.ok) return placement;

  const idGenerator = ctx.idGenerator ?? generateId;
  const out: (MealEvent | ConsumeEvent | VoidEvent)[] = placement.events.filter((e): e is MealEvent => e.type === "meal");
  for (const [i, old] of consumes.entries()) {
    const next = placement.consumes[i];
    // i campi che `correct` ricava da solo non si passano; l'istante del consumo resta quello di prima
    const { id: _id, recordedAt: _r, deviceId: _d, schemaVersion: _s, replaces: _p, ...body } = next;
    void [_id, _r, _d, _s, _p];
    const [voided, replacement] = correct(old as LedgerEvent, body as ReplacementEvent, {
      idGenerator,
      now: () => ctx.now,
      deviceId: ctx.deviceId,
    });
    out.push(voided, replacement as ConsumeEvent);
  }
  const written = out.filter((e): e is ConsumeEvent => e.type === "consume");
  return { ...placement, events: out, consumes: written };
}

/** Il giorno prima di `date`: per «ieri» passata da poco la mezzanotte. */
export const dayBefore = (date: string): string => addDays(date, -1);
