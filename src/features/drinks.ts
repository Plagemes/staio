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
import { voidEvent, type IdGenerator } from "@/core/ledger";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { formatMl, type DrinkPreset } from "./health";
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
export function retimeDrink(drink: DiaryDrink, date: string, timeText: string, ctx: DrinkContext): RetimeResult {
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
  return {
    ok: true,
    events: [old, replacement],
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
