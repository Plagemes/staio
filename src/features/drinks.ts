// Bevande nel diario: composizione degli eventi, momento del giorno, correzione dell'ora, conteggi. Logica pura.
import {
  createDrink,
  instantOfLocal,
  localMoment,
  momentOfMinutes,
  type DiaryDrink,
  type DiaryEventOptions,
  type MealKind,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { generateId, piecesOf, voidEvent, type ConsumeEvent, type IdGenerator, type Lot } from "@/core/ledger";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { formatQuantity } from "@/core/units";
import { buildConsume } from "./actions";
import { formatMl, type DrinkPreset } from "./health";
import { evaluateLots } from "./lots";
import { minutesOfTime } from "./meals";

export interface DrinkContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
  timeZone?: string;
  /** Quando è stata bevuta, se non adesso (una bevanda dimenticata di un giorno passato). */
  at?: string;
  /** «ieri», «2 giorni fa»: si aggiunge all'avviso quando la bevanda non è di oggi. */
  dayLabel?: string;
}

export interface DrinkInput {
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
  energyKcal?: number;
  sugarsG?: number;
}

const WORD: Record<MealKind, string> = { breakfast: "colazione", lunch: "pranzo", dinner: "cena", snack: "fuori pasto" };

/** Il momento a cui una bevanda appartiene per orario, a parole: «colazione», «pranzo», «cena», «fuori pasto». */
export function drinkMomentWord(at: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const m = localMoment(at, timeZone);
  return WORD[m ? momentOfMinutes(m.minutes) : "snack"];
}

/** "8:12" nel fuso dato, senza zero iniziale. */
export function shortTime(at: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const m = localMoment(at, timeZone);
  if (!m) return "";
  return `${Math.floor(m.minutes / 60)}:${String(m.minutes % 60).padStart(2, "0")}`;
}

export const inputOfPreset = (p: DrinkPreset): DrinkInput => ({
  name: p.name,
  ml: p.ml,
  ...(p.caffeineMg !== undefined ? { caffeineMg: p.caffeineMg } : {}),
  ...(p.alcoholG !== undefined ? { alcoholG: p.alcoholG } : {}),
  ...(p.energyKcal !== undefined ? { energyKcal: p.energyKcal } : {}),
  ...(p.sugarsG !== undefined ? { sugarsG: p.sugarsG } : {}),
});

const eventOptions = (ctx: DrinkContext, extra: Partial<DiaryEventOptions> = {}): DiaryEventOptions => ({
  deviceId: ctx.deviceId,
  now: () => ctx.now,
  ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}),
  ...extra,
});

/**
 * Una bevanda segnata adesso. I valori delle scelte rapide e quelli scritti a mano valgono come stime;
 * il messaggio dice che cosa è stato segnato, a che ora e in quale momento.
 */
export function buildDrink(
  input: DrinkInput,
  ctx: DrinkContext,
  extra: { certainty?: "estimated" | "label" | "measured" } = {},
): { events: AnyEvent[]; message: string } {
  const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const when = ctx.at ?? ctx.now;
  const event = createDrink(input, eventOptions(ctx, { certainty: extra.certainty ?? "estimated", ...(ctx.at ? { at: ctx.at } : {}) }));
  return {
    events: [event],
    message: `${input.name} segnato alle ${shortTime(when, tz)} · ${drinkMomentWord(when, tz)}${ctx.dayLabel ? ` · ${ctx.dayLabel}` : ""}`,
  };
}

export type RetimeResult = { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string };

/**
 * «L'ho bevuto prima»: cambia l'ora di una bevanda. Il registro non si modifica: la voce vecchia si annulla
 * e se ne scrive una nuova con la stessa composizione e il nuovo orario, nello stesso giorno di calendario.
 * «Annulla» sull'avviso (che annulla i due eventi) riporta la voce com'era.
 */
export function retimeDrink(
  drink: DiaryDrink,
  date: string,
  timeText: string,
  ctx: DrinkContext,
  /** I consumi della dispensa legati alla bevanda: seguono la voce nuova (vedi `linkedConsumes`). */
  linked: readonly ConsumeEvent[] = [],
): RetimeResult {
  const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const minutes = minutesOfTime(timeText);
  if (minutes === undefined) return { ok: false, error: "Scrivi l'ora come 08:15." };
  const at = instantOfLocal(date, minutes, tz);
  if (at === undefined) return { ok: false, error: "Non riesco a leggere quest'ora." };
  if (at > ctx.now) return { ok: false, error: "Quest'ora non è ancora passata." };
  const old = voidEvent({ id: drink.eventId, deviceId: ctx.deviceId }, eventOptions(ctx));
  const replacement = createDrink(
    {
      name: drink.name,
      ml: drink.ml,
      ...(drink.caffeineMg !== undefined ? { caffeineMg: drink.caffeineMg } : {}),
      ...(drink.alcoholG !== undefined ? { alcoholG: drink.alcoholG } : {}),
      ...(drink.energyKcal !== undefined ? { energyKcal: drink.energyKcal } : {}),
      ...(drink.sugarsG !== undefined ? { sugarsG: drink.sugarsG } : {}),
    },
    eventOptions(ctx, { at, certainty: drink.certainty, source: drink.source, ...(drink.note !== undefined ? { note: drink.note } : {}) }),
  );
  const relinked: AnyEvent[] = linked.flatMap((c) => [
    voidEvent({ id: c.id, deviceId: ctx.deviceId }, eventOptions(ctx)),
    { ...c, id: (ctx.idGenerator ?? generateId)(), recordedAt: ctx.now, deviceId: ctx.deviceId, note: drinkLinkNote(replacement.id) },
  ]);
  return {
    ok: true,
    events: [old, replacement, ...relinked],
    message: `${drink.name} spostato alle ${shortTime(at, tz)} · ${drinkMomentWord(at, tz)}`,
  };
}

/** «Tè × 2, Caffè espresso»: le bevande di oggi raggruppate per nome, per far vedere un doppio tocco. */
export function drinkCounts(drinks: readonly Pick<DiaryDrink, "name">[]): string {
  const counts = new Map<string, { name: string; n: number }>();
  for (const d of drinks) {
    const key = d.name.trim().toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { name: d.name.trim(), n: 1 });
  }
  return [...counts.values()].map((c) => (c.n > 1 ? `${c.name} × ${c.n}` : c.name)).join(", ");
}

/** "Tè, 200 ml · caffeina ~40 mg": quantità e, se ci sono, caffeina e alcol (stime se la voce è una stima). */
export function drinkDetail(d: DiaryDrink): { text: string; estimated: boolean } {
  const parts = [`${d.name}, ${formatMl(d.ml)}`];
  if (d.caffeineMg !== undefined && d.caffeineMg > 0) parts.push(`caffeina ${d.certainty === "estimated" ? "~" : ""}${d.caffeineMg} mg`);
  if (d.alcoholG !== undefined && d.alcoholG > 0) parts.push(`alcol ${d.certainty === "estimated" ? "~" : ""}${String(d.alcoholG).replace(".", ",")} g`);
  return { text: parts.join(" · "), estimated: d.certainty === "estimated" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bevanda scalata dalla dispensa: dopo aver segnato un tè o un caffè si propone, con un tocco, di scalarne una dose
// da un lotto adatto. Mai in automatico. Il consumo porta nella nota il collegamento con la bevanda, così annullare
// la bevanda annulla anche il consumo.

export type DrinkKind = "tea" | "coffee";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const TEA_WORDS = /\b(te|the|tea|tisana|tisane|infuso|infusi|camomilla|rooibos|matcha|karkade)\b/;
const COFFEE_WORDS = /\b(caffe\w*|decaf\w*|espresso|nespresso|moka)\b/;
/** Prodotti che hanno il sapore del tè o del caffè ma non si bevono: non sono la scorta della bevanda. */
const NOT_A_DRINK_STOCK =
  /\b(biscott\w*|gelat\w*|yogurt|crema|torta|barrett\w*|cioccolat\w*|liquor\w*|sciropp\w*|zucchero|dolcificant\w*|budin\w*|wafer|snack|merendin\w*|tiramis\w*|granit\w*|caramell\w*|caffettiera)\b/;

/** Che bevanda è, dal nome: «Tè» e «Caffè espresso» sì, una birra no. */
export function drinkKindOf(name: string): DrinkKind | undefined {
  const text = fold(name);
  if (COFFEE_WORDS.test(text)) return "coffee";
  if (TEA_WORDS.test(text)) return "tea";
  return undefined;
}

/** Di che bevanda è la scorta un lotto (tè, tisana, caffè in polvere, capsule, cialde...), dal nome del prodotto. */
export function lotDrinkKind(lot: Pick<Lot, "productRef">): DrinkKind | undefined {
  if (NOT_A_DRINK_STOCK.test(fold(lot.productRef))) return undefined;
  return drinkKindOf(lot.productRef);
}

export interface DrinkDose {
  quantity: { value: number; unit: "g" | "pz" };
  /** Sempre una stima: nessuno pesa la dose di tè o di caffè. */
  certainty: "estimated";
  /** «una bustina», «una capsula», «una cialda», «circa 7 g». */
  text: string;
}

/** Grammi tipici di una dose di prodotto sfuso: una tazza di tè in foglie, un espresso di caffè macinato. */
export const TYPICAL_DOSE_G: Record<DrinkKind, number> = { tea: 2, coffee: 7 };

/** Sotto questi pezzi un lotto contato in `pz` senza una parola da monodose potrebbe essere una confezione sola. */
const MIN_COUNTABLE_PIECES = 5;

function pieceWord(lot: Pick<Lot, "productRef">, kind: DrinkKind): { word: string; explicit: boolean } {
  const text = fold(lot.productRef);
  if (/\bcapsul\w*/.test(text)) return { word: "capsula", explicit: true };
  if (/\b(cialda|cialde|pod|ese)\b/.test(text)) return { word: "cialda", explicit: true };
  if (/\b(filtr\w*|bustin\w*)\b/.test(text)) return { word: "bustina", explicit: true };
  return { word: kind === "tea" ? "bustina" : "capsula", explicit: false };
}

/**
 * La dose prudente da scalare: una bustina, capsula o cialda se il lotto è fatto di pezzi (dichiarati o contati in
 * `pz`); altrimenti i grammi tipici (2 g di tè, 7 g di caffè). `undefined` se il lotto non si presta: a litri, oppure
 * contato in pezzi ma senza dire che sono monodose e con meno di cinque pezzi (potrebbe essere un pacco solo).
 * Mai più di quanto resta.
 */
export function drinkDose(lot: Lot, kind: DrinkKind): DrinkDose | undefined {
  if (!(lot.remaining > 0)) return undefined;
  const { word, explicit } = pieceWord(lot, kind);
  if (lot.unit === "pz") {
    if (!explicit && lot.initial < MIN_COUNTABLE_PIECES) return undefined;
    const value = Math.min(1, lot.remaining);
    return { quantity: { value, unit: "pz" }, certainty: "estimated", text: value < 1 ? "un pezzo" : `una ${word}` };
  }
  if (lot.unit !== "g") return undefined;
  const pieces = piecesOf(lot);
  const value = Math.min(pieces ? pieces.each : TYPICAL_DOSE_G[kind], lot.remaining);
  const text = pieces ? `una ${pieces.name ?? word}` : `circa ${formatQuantity({ value, unit: "g" })}`;
  return { quantity: { value, unit: "g" }, certainty: "estimated", text };
}

export interface DrinkPantryOption {
  lot: Lot;
  dose: DrinkDose;
}

/**
 * I lotti da cui si può scalare una bevanda, uno per prodotto: per ogni prodotto il lotto che scade prima (lo stesso
 * ordine di «Da mangiare prima»). Il prodotto scelto l'ultima volta, se c'è ancora, viene per primo.
 */
export function pantryOptionsForDrink(
  kind: DrinkKind,
  lots: readonly Lot[],
  now: string,
  options: { preferredProduct?: string; timeZone?: string } = {},
): DrinkPantryOption[] {
  const eligible = lots.filter((l) => l.status === "active" && lotDrinkKind(l) === kind && drinkDose(l, kind) !== undefined);
  const seen = new Set<string>();
  const out: DrinkPantryOption[] = [];
  for (const { lot } of evaluateLots(eligible, now, options.timeZone)) {
    const key = fold(lot.productRef);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lot, dose: drinkDose(lot, kind) as DrinkDose });
  }
  const preferred = options.preferredProduct === undefined ? -1 : out.findIndex((o) => fold(o.lot.productRef) === fold(options.preferredProduct as string));
  return preferred > 0 ? [out[preferred], ...out.filter((_, i) => i !== preferred)] : out;
}

const LINK_PREFIX = "drink:";

/** La nota del consumo che lo lega alla bevanda. */
export const drinkLinkNote = (drinkEventId: string): string => `${LINK_PREFIX}${drinkEventId}`;

/** L'evento di consumo per una dose, legato alla bevanda; sempre una stima, mai senza che l'utente lo chieda. */
export function buildDrinkConsume(
  option: DrinkPantryOption,
  drinkEventId: string,
  ctx: { now: string; deviceId: string; idGenerator?: IdGenerator },
): { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string } {
  const r = buildConsume(option.lot, { kind: "value", value: option.dose.quantity.value, estimated: true }, ctx);
  if (!r.ok) return r;
  const events = r.events.map((e) => ({ ...e, note: drinkLinkNote(drinkEventId) }) as AnyEvent);
  return { ok: true, events, message: `Scalato dalla dispensa: ${option.dose.text} da ${option.lot.productRef}, è una stima.` };
}

/** I consumi ancora validi legati a una bevanda. */
export function linkedConsumes(drinkEventId: string, events: readonly AnyEvent[], voidedEventIds: Iterable<string>): ConsumeEvent[] {
  const voided = new Set(voidedEventIds);
  return events.filter((e): e is ConsumeEvent => e.type === "consume" && e.note === drinkLinkNote(drinkEventId) && !voided.has(e.id));
}

/** «Annulla» una bevanda: il `void` della bevanda e quello del consumo che le era legato, se c'è. */
export function removeDrink(drink: DiaryDrink, linked: readonly ConsumeEvent[], ctx: DrinkContext): { events: AnyEvent[]; message: string } {
  const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const events: AnyEvent[] = [
    voidEvent({ id: drink.eventId, deviceId: ctx.deviceId }, eventOptions(ctx)),
    ...linked.map((c) => voidEvent({ id: c.id, deviceId: ctx.deviceId }, eventOptions(ctx))),
  ];
  const base = `Annullato: ${drink.name.toLowerCase()} delle ${shortTime(drink.at, tz)}`;
  return { events, message: linked.length > 0 ? `${base}, e anche ciò che avevi scalato dalla dispensa.` : `${base}.` };
}
