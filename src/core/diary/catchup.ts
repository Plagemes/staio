// «Mettiamoci in pari»: i giorni passati senza niente nel diario e gli eventi che li riempiono, in una volta.
// Si scrivono solo pasti del diario e dichiarazioni: nessun consumo, perché la dispensa non torna indietro nel tempo.

import { generateId, isCalendarDate, type IdGenerator } from "../ledger";
import { addDays, instantOfLocal, localDate } from "./calendar";
import { createMeal, createMealDeclaration } from "./create";
import type { DiaryDay, DiaryState } from "./derive";
import { getDay, mealMoments } from "./selectors";
import { MAIN_MEAL_KINDS, type DiaryEvent, type MealItem, type MealKind } from "./types";

/** Quanti giorni indietro (ieri compreso) si guarda. */
export const CATCHUP_LOOKBACK_DAYS = 7;
/** Sotto questo numero di giorni vuoti non si propone niente: un giorno solo lo copre già Oggi. */
export const CATCHUP_MIN_DAYS = 2;
/** La nota di ogni evento scritto dal recupero: «Ultime azioni» lo riconosce da qui. */
export const CATCHUP_NOTE = "catchup";

export type CatchUpKind = (typeof MAIN_MEAL_KINDS)[number];

/** La scelta per un momento, già risolta in ciò che si scrive. */
export type CatchUpChoice =
  | { kind: "meal"; title?: string; items: MealItem[]; habitId?: string; source: "habit" | "manual" }
  | { kind: "skipped" }
  | { kind: "unknown" };

export interface CatchUpEntry {
  /** Il giorno, `YYYY-MM-DD`. */
  date: string;
  kind: CatchUpKind;
  choice: CatchUpChoice;
}

export interface CatchUpContext {
  deviceId: string;
  /** Istante della scrittura, ISO UTC: è il `recordedAt` di tutto e l'`at` delle dichiarazioni. */
  now: string;
  /** Fuso del diario: i pasti cadono nel giorno scelto, all'ora indicata, in questo fuso. */
  timeZone: string;
  /** Minuti dalla mezzanotte locale del pasto scritto, per momento. */
  minutesOf: Record<MealKind, number>;
  idGenerator?: IdGenerator;
}

/** Il piano non si può scrivere così com'è: nessun evento è stato costruito. */
export class InvalidCatchUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCatchUpError";
  }
}

/**
 * Un giorno è vuoto se nessun pasto c'è (spuntini compresi), nessun pasto è segnato come non tracciato e colazione,
 * pranzo e cena non hanno né un pasto né una dichiarazione. Acqua, bevande, peso e il resto non contano.
 */
export function isEmptyDay(day: DiaryDay | undefined): boolean {
  if (day === undefined) return true;
  if (day.meals.length > 0 || day.untrackedMeals.length > 0) return false;
  return mealMoments(day).every((m) => m.status === "none");
}

/**
 * I giorni vuoti da ieri a `CATCHUP_LOOKBACK_DAYS` giorni fa, dal più vecchio, solo dopo il primo giorno del diario:
 * a chi comincia adesso non si propone niente.
 */
export function emptyDays(state: DiaryState, today: string): string[] {
  if (!isCalendarDate(today) || state.days.length === 0) return [];
  const first = state.days[0].date;
  const out: string[] = [];
  for (let back = CATCHUP_LOOKBACK_DAYS; back >= 1; back--) {
    const date = addDays(today, -back);
    if (date <= first) continue;
    if (isEmptyDay(getDay(state, date))) out.push(date);
  }
  return out;
}

const KEY_PREFIX = "catchup:";

/** La chiave con cui «Lascia così» ricorda questi giorni: `catchup:<primo>:<ultimo>`. */
export function catchUpKey(days: readonly string[]): string {
  return `${KEY_PREFIX}${days[0] ?? ""}:${days[days.length - 1] ?? ""}`;
}

/** Il giorno sta dentro uno degli intervalli lasciati così (le altre chiavi dell'elenco non contano). */
function isDismissed(date: string, dismissed: readonly string[]): boolean {
  return dismissed.some((key) => {
    if (!key.startsWith(KEY_PREFIX)) return false;
    const [from, to] = key.slice(KEY_PREFIX.length).split(":");
    return isCalendarDate(from) && isCalendarDate(to) && from <= date && date <= to;
  });
}

/**
 * I giorni da proporre: quelli vuoti fuori dagli intervalli lasciati così (`dismissed`, le chiavi di `catchUpKey`),
 * solo se sono almeno `CATCHUP_MIN_DAYS`. Giorni lasciati così non tornano; giorni vuoti nuovi fanno una chiave nuova.
 */
export function catchUpDays(state: DiaryState, today: string, dismissed: readonly string[] = []): string[] {
  const days = emptyDays(state, today).filter((d) => !isDismissed(d, dismissed));
  return days.length >= CATCHUP_MIN_DAYS ? days : [];
}

const isMainKind = (kind: unknown): kind is CatchUpKind => (MAIN_MEAL_KINDS as readonly unknown[]).includes(kind);

/**
 * Gli eventi del piano, tutti con `note: "catchup"`, da scrivere insieme. Un pasto cade nel giorno scelto all'ora del
 * suo momento (`minutesOf`) nel fuso del diario; una dichiarazione porta il giorno in `date` e l'istante di adesso in
 * `at`. Ogni evento passa dalla validazione del diario: se un solo evento o una sola voce del piano non va, lancia e
 * non restituisce niente. Mai un consumo della dispensa.
 */
export function buildCatchUpEvents(plan: readonly CatchUpEntry[], ctx: CatchUpContext): DiaryEvent[] {
  const ids = ctx.idGenerator ?? generateId;
  const seen = new Set<string>();
  const events: DiaryEvent[] = [];
  for (const entry of plan) {
    const where = `${entry.date} ${entry.kind}`;
    if (!isCalendarDate(entry.date)) throw new InvalidCatchUpError(`Giorno non valido: ${where}`);
    if (!isMainKind(entry.kind)) throw new InvalidCatchUpError(`Si recuperano solo colazione, pranzo e cena: ${where}`);
    if (seen.has(where)) throw new InvalidCatchUpError(`Momento ripetuto nel piano: ${where}`);
    seen.add(where);
    const base = { deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: ids, note: CATCHUP_NOTE };
    const choice = entry.choice;
    if (choice.kind === "meal") {
      if (choice.items.length === 0) throw new InvalidCatchUpError(`Pasto senza voci: ${where}`);
      const at = instantOfLocal(entry.date, ctx.minutesOf[entry.kind], ctx.timeZone);
      // un istante che nel fuso del diario non cade nel giorno scelto è un errore di chi chiama, non un pasto
      if (at === undefined || localDate(at, ctx.timeZone) !== entry.date) throw new InvalidCatchUpError(`Ora non valida: ${where}`);
      events.push(
        createMeal(
          {
            kind: entry.kind,
            title: choice.title?.trim() || undefined,
            items: choice.items.map((item) => ({ ...item, quantity: { ...item.quantity }, certainty: "estimated" })),
            habitId: choice.habitId,
          },
          { ...base, at, certainty: "estimated", source: choice.source },
        ),
      );
    } else {
      const status = choice.kind === "skipped" ? "skipped" : "untracked";
      events.push(createMealDeclaration({ date: entry.date, kind: entry.kind, status }, base));
    }
  }
  return events;
}

/**
 * Dopo la rilettura dell'archivio: i momenti del piano ancora `none` e quelli che nel frattempo hanno avuto un pasto o
 * una dichiarazione (un altro telefono, un'altra scheda), che non si scrivono.
 */
export function stillEmpty(
  state: DiaryState,
  entries: readonly CatchUpEntry[],
): { entries: CatchUpEntry[]; filled: CatchUpEntry[] } {
  const kept: CatchUpEntry[] = [];
  const filled: CatchUpEntry[] = [];
  for (const entry of entries) {
    const moment = mealMoments(getDay(state, entry.date)).find((m) => m.kind === entry.kind);
    if (moment?.status === "none") kept.push(entry);
    else filled.push(entry);
  }
  return { entries: kept, filled };
}
