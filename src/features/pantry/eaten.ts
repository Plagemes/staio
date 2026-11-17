// Ciò che si mangia dalla scheda di un alimento in Dispensa va nel diario del giorno, nel momento giusto.
// Logica pura: gli eventi si restituiscono, li scrive chi chiama. La scelta del momento e l'aggiunta a un pasto che
// c'è già stanno in `core/diary/placeConsume`.
import { dayBefore, localDate, momentKindAt, moveConsumes, placeConsumes, QUICK_CONSUME_NOTE, type DiaryState, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent, Lot, VoidEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { buildConsume, buildUndo, type ActionContext, type AmountChoice } from "../actions";
import { dayOf, relativeDay } from "../format";

/** Dove sta il consumo appena segnato: abbastanza per dirlo all'utente e per spostarlo o annullarlo. */
export interface Marked {
  consumes: ConsumeEvent[];
  mealId: string;
  kind: MealKind;
  /** Giorno di calendario `YYYY-MM-DD`. */
  date: string;
  /** Si è aggiunto a un pasto che c'era già. */
  joined: boolean;
  /** Il nome dell'alimento (o delle confezioni). */
  name: string;
  /** «275 g», «3 confezioni». */
  amount: string;
}

export type EatenResult =
  | { ok: true; events: AnyEvent[]; message: string; marked: Marked }
  | { ok: false; error: string };

const WHERE: Record<MealKind, string> = { breakfast: "a colazione", lunch: "a pranzo", dinner: "a cena", snack: "fuori pasto" };

/** I momenti, nell'ordine in cui si scelgono. */
export const MOMENT_CHOICES: readonly { kind: MealKind; label: string }[] = [
  { kind: "breakfast", label: "Colazione" },
  { kind: "lunch", label: "Pranzo" },
  { kind: "dinner", label: "Cena" },
  { kind: "snack", label: "Fuori pasto" },
];

/** «a pranzo», «a cena di ieri», «fuori pasto» (con il giorno se non è oggi). */
export function whereText(kind: MealKind, date: string, today: string): string {
  if (date === today) return WHERE[kind];
  return `${WHERE[kind]} ${date === dayBefore(today) ? "di ieri" : `· ${relativeDay(date, today)}`}`;
}

/** «Oggi a pranzo», «Ieri a cena»: l'etichetta fissa della scheda. */
export function whenText(kind: MealKind, date: string, today: string): string {
  const day = date === today ? "Oggi" : date === dayBefore(today) ? "Ieri" : relativeDay(date, today);
  return `${day} ${WHERE[kind]}`;
}

const amountOf = (lots: readonly Lot[], consumes: readonly ConsumeEvent[]): string => {
  if (lots.length > 1) return `${lots.length} confezioni`;
  return formatQuantity(consumes[0].quantity);
};

/** In mezzo a una frase il nome comincia con la minuscola: «275 g di petto di pollo». */
const nameOf = (lots: readonly Lot[]): string => lots[0].productRef.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());

/**
 * «Mangiato» da un alimento: il consumo (uno per confezione) e, se serve, il pasto. Il momento viene dall'ora di
 * adesso; se in quel momento c'è già un pasto, il consumo vi si aggiunge. Il messaggio dice che cosa è stato segnato
 * e dove: «Segnato a pranzo: 275 g di petto di pollo».
 */
export function buildEaten(lots: readonly Lot[], choice: AmountChoice, ctx: ActionContext, diary: DiaryState | undefined): EatenResult {
  if (lots.length === 0) return { ok: false, error: "Non hai scelto nessuna confezione." };
  const consumes: ConsumeEvent[] = [];
  for (const lot of lots) {
    const r = buildConsume(lot, choice, ctx);
    if (!r.ok) return { ok: false, error: lots.length > 1 ? `${lot.productRef}: ${r.error}` : r.error };
    for (const e of r.events) if (e.type === "consume") consumes.push({ ...e, note: QUICK_CONSUME_NOTE });
  }
  const placed = placeConsumes(consumes, diary, { deviceId: ctx.deviceId, now: ctx.now, ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}) });
  if (!placed.ok) return placed;
  const amount = amountOf(lots, placed.consumes);
  const name = nameOf(lots);
  const where = whereText(placed.kind, placed.date, dayOf(ctx.now));
  return {
    ok: true,
    events: placed.events,
    message: `Segnato ${where}: ${amount} di ${name}`,
    marked: { consumes: placed.consumes, mealId: placed.mealId, kind: placed.kind, date: placed.date, joined: placed.joined, name, amount },
  };
}

/**
 * «Cambia momento»: il consumo passa a un altro momento (con `date`, di un altro giorno). Il vecchio si annulla e se ne
 * scrive uno nuovo: nei nutrienti conta una volta sola. Se il pasto di partenza resta senza voci sparisce da solo.
 */
export function buildChangeMoment(
  marked: Marked,
  to: { kind: MealKind; date?: string },
  ctx: ActionContext,
  diary: DiaryState | undefined,
): EatenResult {
  const moved = moveConsumes(marked.consumes, diary, { deviceId: ctx.deviceId, now: ctx.now, ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}) }, to);
  if (!moved.ok) return moved;
  const where = whereText(moved.kind, moved.date, dayOf(ctx.now));
  return {
    ok: true,
    events: moved.events,
    message: `Ora ${where}: ${marked.amount} di ${marked.name}`,
    marked: { ...marked, consumes: moved.consumes, mealId: moved.mealId, kind: moved.kind, date: moved.date, joined: moved.joined },
  };
}

/**
 * Annullare ciò che un tocco ha scritto (pasto, consumi, correzioni) senza lasciare consumi orfani: il pasto si annulla
 * solo se nessun altro consumo ancora valido lo usa (per esempio uno aggiunto dopo); i consumi e le correzioni si
 * annullano sempre. `log` è il registro com'è adesso, `voidedEventIds` gli eventi già annullati.
 */
export function undoPlacement(
  events: readonly AnyEvent[],
  log: readonly AnyEvent[],
  voidedEventIds: readonly string[],
  ctx: ActionContext,
): VoidEvent[] {
  const voided = new Set(voidedEventIds);
  const own = new Set(events.map((e) => e.id));
  const keep = (e: AnyEvent): boolean =>
    e.type === "meal" &&
    ((e.items?.length ?? 0) > 0 || log.some((c) => c.type === "consume" && c.mealId === e.mealId && !voided.has(c.id) && !own.has(c.id)));
  return buildUndo(events.filter((e) => !keep(e)), ctx);
}

/** Gli eventi da annullare per togliere un consumo appena segnato: i consumi e, se l'ha creato questo tocco, il suo pasto. */
export function eventsOfMarked(marked: Marked, log: readonly AnyEvent[]): AnyEvent[] {
  const meals = marked.joined ? [] : log.filter((e) => e.type === "meal" && e.mealId === marked.mealId);
  return [...meals, ...marked.consumes];
}

/** Il giorno in cui si è mangiato (quello del consumo, non di adesso): vale per ogni cambio di momento. */
export function eatenDayOf(marked: Marked, timeZone: string, fallback: string): string {
  const at = marked.consumes[0]?.at;
  return (at ? localDate(at, timeZone) : undefined) ?? fallback;
}

export type LooseConsumes = Record<MealKind, ConsumeEvent[]>;

/**
 * I consumi del giorno che Oggi non mostra in nessun pasto: quelli senza pasto (di prima di questa regola, o di una
 * preparazione) e quelli il cui pasto non c'è più (annullato, o vuoto), nel momento della loro ora. Così nessun consumo
 * ancora valido resta invisibile. Restano fuori gli annullati e quelli legati a una bevanda (hanno una nota).
 */
export function looseConsumesOf(log: readonly AnyEvent[], diary: DiaryState, date: string): LooseConsumes {
  const timeZone = diary.timeZone;
  const out: LooseConsumes = { breakfast: [], lunch: [], dinner: [], snack: [] };
  const voided = new Set(diary.voidedEventIds);
  const shown = new Set(diary.days.flatMap((d) => d.meals.map((m) => m.mealId)));
  for (const e of log) {
    if (e.type !== "consume" || voided.has(e.id)) continue;
    if (e.mealId !== undefined && e.mealId !== "" && shown.has(e.mealId)) continue;
    if (e.note !== undefined && e.note !== "" && e.note !== QUICK_CONSUME_NOTE) continue;
    if (localDate(e.at, timeZone) !== date) continue;
    out[momentKindAt(e.at, timeZone)].push(e);
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return out;
}
