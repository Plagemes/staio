import {
  compareEvents,
  isPantryEvent,
  worseCertainty,
  type Certainty,
  type Source,
  type ValidationError,
} from "../ledger";
import { isOtherFamilyEvent } from "./foreign";
import { cloneMealItems } from "./items";
import { isValidTimeZone, localDate } from "./calendar";
import { isValidKnownEvent, isVoid, prepareLog, rejectedErrors, rejectedKey, removedMealLines, voidsOfLog } from "./log";
import { recordedLater, resolveMealVersions } from "./mealVersions";
import {
  DEFAULT_TIME_ZONE,
  type DiaryEvent,
  type MealDeclarationEvent,
  type MealDeclarationStatus,
  type MealEvent,
  type MealItem,
  type MealKind,
  type SymptomKind,
} from "./types";
import { isDiaryEvent, validateDiaryEvent } from "./validate";

export type DiaryAnomalyCode =
  /** Voce non valida, senza id utilizzabile, non oggetto o non serializzabile: ignorata. */
  | "invalid_event"
  /** Tipo di evento che né la dispensa né il diario conoscono: ignorato. */
  | "unknown_event_type"
  /** Stesso id con contenuti diversi (ne è stato scelto uno). */
  | "id_conflict"
  | "void_target_missing"
  | "void_cycle"
  /**
   * Più pasti validi con lo stesso `mealId` (due dispositivi l'hanno corretto prima di unirsi): vale il più recente,
   * unito agli altri dove si può (vedi `mealVersions.ts`). Una per ogni versione che non è la più recente:
   * `eventId` è quella versione, `keptEventId` quella che vale. Le versioni rimaste fuori stanno in
   * `DiaryMeal.otherVersions`.
   */
  | "duplicate_meal"
  /** Il fuso passato non esiste: si è usato quello predefinito. */
  | "invalid_time_zone";

export interface DiaryAnomaly {
  code: DiaryAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  mealId?: string;
  /** Per `duplicate_meal`: l'evento del pasto che vale. */
  keptEventId?: string;
  eventType?: string;
  /** Per `invalid_event`. */
  errors?: ValidationError[];
}

/** Dati comuni di ogni voce del diario. */
export interface DiaryEntry {
  eventId: string;
  /** Istante in cui il fatto è avvenuto. */
  at: string;
  certainty: Certainty;
  source: Source;
  note?: string;
}

/** Una versione del pasto scritta da un altro dispositivo e rimasta fuori da ciò che si mostra. */
export interface DiaryMealVersion {
  eventId: string;
  recordedAt: string;
  deviceId: string;
  at: string;
  kind: MealKind;
  items: MealItem[];
}

export interface DiaryMeal extends DiaryEntry {
  mealId: string;
  kind: MealKind;
  title?: string;
  items: MealItem[];
  habitId?: string;
  /**
   * Voci del pasto che erano consumi della dispensa e sono state tolte (per esempio con «Inserito per sbaglio»).
   * Un consumo corretto o spostato non è una voce tolta: vale il suo sostituto. Assente se nessuna. Un pasto fatto
   * solo di consumi che non ci sono più non compare affatto.
   */
  removedLines?: number;
  /**
   * Il pasto era stato tolto (tutti i suoi eventi sono annullati) ma gli resta almeno un consumo della dispensa
   * ancora valido, di solito scritto da un altro dispositivo mentre qui lo si toglieva. Compare lo stesso, con il
   * momento e l'ora dell'ultima versione e senza voci libere, perché nessun consumo valido resti fuori dal diario.
   */
  revived?: true;
  /**
   * Versioni dello stesso pasto corrette su un altro dispositivo e in conflitto con questa: non si sono potute unire,
   * vale la più recente e queste restano da mostrare all'utente. Dalla più recente. Assente se non ce ne sono.
   */
  otherVersions?: DiaryMealVersion[];
}

export interface DiaryUntrackedMeal extends DiaryEntry {
  kind: MealKind;
}

/**
 * Dichiarazione in vigore per un giorno e un momento (la più recente per `recordedAt`, poi `id`).
 * Le dichiarazioni battute da quella più recente non compaiono: restano nel registro.
 */
export interface DiaryMealDeclaration extends DiaryEntry {
  kind: MealKind;
  status: MealDeclarationStatus;
  recordedAt: string;
  /**
   * Perché non conta: `meal` se in quel momento c'è un pasto registrato (il pasto vince),
   * `newer` se un pasto «non tracciato» (evento `untrackedMeal`) più recente la contraddice.
   * Assente se conta.
   */
  supersededBy?: "meal" | "newer";
}

export interface DiaryDrink extends DiaryEntry {
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
  energyKcal?: number;
  sugarsG?: number;
}

export interface DiaryWeight extends DiaryEntry {
  kg: number;
}

export interface DiaryMood extends DiaryEntry {
  score: number;
  tags: string[];
}

export interface DiarySymptom extends DiaryEntry {
  kind: SymptomKind;
  score: number;
  label?: string;
}

export interface DiarySupplement extends DiaryEntry {
  name: string;
  dose?: string;
  lotId?: string;
}

export interface DiaryDay {
  /** Data di calendario `YYYY-MM-DD` nel fuso dello stato. */
  date: string;
  meals: DiaryMeal[];
  untrackedMeals: DiaryUntrackedMeal[];
  /** Dichiarazioni «saltato» / «mangiato, non registrato» di questo giorno, una per momento. */
  declarations: DiaryMealDeclaration[];
  /** Somma degli eventi `water` (le bevande stanno a parte, in `drinks`). */
  waterMl: number;
  /** La meno affidabile tra le certezze degli eventi sommati; assente senza eventi. */
  waterCertainty?: Certainty;
  drinks: DiaryDrink[];
  caffeineMg: number;
  caffeineCertainty?: Certainty;
  alcoholG: number;
  alcoholCertainty?: Certainty;
  weights: DiaryWeight[];
  /** Ultima pesata del giorno (per `at`, poi `id`). */
  weightKg?: number;
  moods: DiaryMood[];
  symptoms: DiarySymptom[];
  supplements: DiarySupplement[];
}

export interface DiaryHabit {
  habitId: string;
  title: string;
  kind: MealKind;
  usualTime?: string;
  items: MealItem[];
  /** Evento che lo definisce al momento. */
  eventId: string;
  recordedAt: string;
  certainty: Certainty;
}

export interface DiaryState {
  timeZone: string;
  /** Solo giorni con almeno una voce, in ordine di data. */
  days: DiaryDay[];
  /** Pasti abituali attivi (non ritirati), per ora abituale, titolo e `habitId`. */
  habits: DiaryHabit[];
  anomalies: DiaryAnomaly[];
  /** Id degli eventi annullati da un `void` efficace, in ordine alfabetico. */
  voidedEventIds: string[];
}

export interface DeriveDiaryOptions {
  /** Fuso orario IANA con cui si assegnano gli eventi ai giorni. Predefinito `Europe/Rome`. */
  timeZone?: string;
}

// Evita residui come 0.30000000000000004 nelle somme.
const norm = (n: number): number => Math.round(n * 1e6) / 1e6;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function emptyDay(date: string): DiaryDay {
  return {
    date,
    meals: [],
    untrackedMeals: [],
    declarations: [],
    waterMl: 0,
    drinks: [],
    caffeineMg: 0,
    alcoholG: 0,
    weights: [],
    moods: [],
    symptoms: [],
    supplements: [],
  };
}

/** `a` è più recente di `b`: per `recordedAt`, poi per `id`. */
function isNewer(a: { recordedAt: string; id: string }, b: { recordedAt: string; id: string }): boolean {
  const ta = Date.parse(a.recordedAt);
  const tb = Date.parse(b.recordedAt);
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

/**
 * Per ogni giorno e momento vale la dichiarazione più recente, qualunque sia l'ordine di arrivo.
 * Un pasto registrato nello stesso momento prevale. Un evento `untrackedMeal` (il vecchio «ho mangiato
 * fuori») è una dichiarazione «non registrato» fatta alla data del suo `at`: se è più recente
 * dell'ultima dichiarazione, vince lui; se è più vecchio, sparisce dall'elenco dei non tracciati.
 */
function resolveDeclarations(
  events: readonly MealDeclarationEvent[],
  days: Map<string, DiaryDay>,
  untrackedRecordedAt: ReadonlyMap<string, string>,
): void {
  const winners = new Map<string, MealDeclarationEvent>();
  for (const e of events) {
    const key = `${e.date}|${e.kind}`;
    const cur = winners.get(key);
    if (!cur || isNewer(e, cur)) winners.set(key, e);
  }
  for (const e of winners.values()) {
    let day = days.get(e.date);
    if (!day) days.set(e.date, (day = emptyDay(e.date)));
    const hasMeal = day.meals.some((m) => m.kind === e.kind);
    const legacy = day.untrackedMeals.filter((u) => u.kind === e.kind);
    const newerLegacy = legacy.some((u) => isNewer({ recordedAt: untrackedRecordedAt.get(u.eventId) ?? u.at, id: u.eventId }, e));
    if (!newerLegacy) {
      day.untrackedMeals = day.untrackedMeals.filter((u) => u.kind !== e.kind);
    }
    const base = entryOf(e);
    day.declarations.push({
      ...base,
      kind: e.kind,
      status: e.status,
      recordedAt: e.recordedAt,
      ...(hasMeal ? { supersededBy: "meal" as const } : newerLegacy ? { supersededBy: "newer" as const } : {}),
    });
  }
  for (const day of days.values()) {
    day.declarations.sort((a, b) => cmp(a.kind, b.kind));
  }
}

function entryOf(e: DiaryEvent): DiaryEntry {
  return {
    eventId: e.id,
    at: e.at,
    certainty: e.certainty,
    source: e.source,
    ...(e.note !== undefined ? { note: e.note } : {}),
  };
}

function anomalyKey(a: DiaryAnomaly): string {
  return [a.code, a.eventId ?? "", a.targetEventId ?? "", a.mealId ?? "", a.eventType ?? ""].join(
    "\u0000",
  );
}

/**
 * Riduzione deterministica del diario. Il risultato dipende solo dall'insieme di eventi
 * (non dall'ordine né dai duplicati in ingresso). Non lancia mai.
 *
 * Accetta il registro intero: gli eventi di dispensa e delle altre famiglie note (piano,
 * preparazioni, ricettario) sono ignorati in silenzio (ma i loro id
 * contano per i bersagli dei `void`), un tipo sconosciuto è segnalato come anomalia.
 * Un evento annullato non conta; un annullamento annullato ripristina l'evento.
 * Ogni evento va nella giornata di calendario del suo `at` nel fuso scelto.
 */
export function deriveDiary(
  events: Iterable<unknown>,
  options: DeriveDiaryOptions = {},
): DiaryState {
  const anomalies: DiaryAnomaly[] = [];
  let timeZone = DEFAULT_TIME_ZONE;
  if (options.timeZone !== undefined) {
    if (isValidTimeZone(options.timeZone)) timeZone = options.timeZone;
    else anomalies.push({ code: "invalid_time_zone" });
  }

  const log = prepareLog(events);

  const junk = new Map<string, unknown>();
  for (const item of log.rejected) junk.set(rejectedKey(item), item);
  for (const item of junk.values()) {
    anomalies.push({ code: "invalid_event", errors: rejectedErrors(item) });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });

  const valid: DiaryEvent[] = [];
  for (const e of log.events) {
    const rec = e as { id: string; type?: unknown };
    if (isVoid(e)) {
      const errors = validateDiaryEvent(e);
      if (errors.length > 0) anomalies.push({ code: "invalid_event", eventId: rec.id, errors });
    } else if (isDiaryEvent(e)) {
      const errors = validateDiaryEvent(e);
      if (errors.length > 0) anomalies.push({ code: "invalid_event", eventId: rec.id, errors });
      else valid.push(e);
    } else if (isPantryEvent(e) || isOtherFamilyEvent(e)) {
      // Fuori dal diario (dispensa, piano, preparazioni, ricettario): nessuna anomalia.
    } else if (typeof rec.type === "string") {
      anomalies.push({ code: "unknown_event_type", eventId: rec.id, eventType: rec.type });
    } else {
      anomalies.push({
        code: "invalid_event",
        eventId: rec.id,
        errors: validateDiaryEvent(e),
      });
    }
  }

  const voids = voidsOfLog(log.events);
  const { voided, findings } = voids;
  for (const f of findings) {
    anomalies.push({ code: f.code, eventId: f.eventId, targetEventId: f.targetEventId });
  }
  const live = valid.filter((e) => !voided.has(e.id));

  // Consumi della dispensa legati a un pasto: attivi e non più validi (annullati, corretti, spostati altrove). Un pasto
  // senza voci scritte nel diario e con tutti i consumi non più validi è un pasto fantasma: il suo contenuto è sparito,
  // non vale come registrato.
  const mealConsumes = new Map<string, { active: number; gone: number }>();
  for (const e of log.events) {
    const c = e as { id?: unknown; type?: unknown; mealId?: unknown };
    if (c.type !== "consume" || typeof c.mealId !== "string" || c.mealId === "" || typeof c.id !== "string") continue;
    if (!isValidKnownEvent(e)) continue;
    const entry = mealConsumes.get(c.mealId) ?? { active: 0, gone: 0 };
    if (voided.has(c.id)) entry.gone++;
    else entry.active++;
    mealConsumes.set(c.mealId, entry);
  }
  const removedLines = removedMealLines(log.events, voids);

  const days = new Map<string, DiaryDay>();
  const dayOf = (e: DiaryEvent): DiaryDay | undefined => {
    const date = localDate(e.at, timeZone);
    if (date === undefined) return undefined;
    let day = days.get(date);
    if (!day) days.set(date, (day = emptyDay(date)));
    return day;
  };

  // I pasti: per ogni `mealId` una riga sola. Tra più versioni valide vale la più recente, unita alle altre dove si
  // può; un pasto tolto a cui resta un consumo valido compare lo stesso (`revived`).
  const mealsById = new Map<string, MealEvent>();
  const liveMeals = new Map<string, MealEvent[]>();
  const voidedMeals = new Map<string, MealEvent>();
  for (const e of valid) {
    if (e.type !== "meal") continue;
    mealsById.set(e.id, e);
    if (voided.has(e.id)) {
      const last = voidedMeals.get(e.mealId);
      if (!last || recordedLater(e, last)) voidedMeals.set(e.mealId, e);
    } else {
      const list = liveMeals.get(e.mealId);
      if (list) list.push(e);
      else liveMeals.set(e.mealId, [e]);
    }
  }
  const lines = (mealId: string) => (removedLines.has(mealId) ? { removedLines: removedLines.get(mealId) } : {});
  const mealRows: { meal: DiaryMeal; recordedAt: string }[] = [];
  for (const [mealId, versions] of liveMeals) {
    const consumes = mealConsumes.get(mealId);
    const ghostly = consumes !== undefined && consumes.active === 0 && consumes.gone > 0;
    const shown = ghostly ? versions.filter((v) => (v.items?.length ?? 0) > 0) : versions;
    if (shown.length === 0) continue;
    const r = resolveMealVersions(shown, (id) => mealsById.get(id));
    for (const v of shown) {
      if (v !== r.winner) anomalies.push({ code: "duplicate_meal", eventId: v.id, mealId, keptEventId: r.winner.id });
    }
    const w = r.winner;
    mealRows.push({
      recordedAt: w.recordedAt,
      meal: {
        ...entryOf(w),
        at: r.at,
        certainty: r.certainty,
        mealId,
        kind: r.kind,
        ...(w.title !== undefined ? { title: w.title } : {}),
        items: r.items,
        ...(w.habitId !== undefined ? { habitId: w.habitId } : {}),
        ...lines(mealId),
        ...(r.others.length > 0
          ? {
              otherVersions: r.others.map((v) => ({
                eventId: v.id,
                recordedAt: v.recordedAt,
                deviceId: v.deviceId,
                at: v.at,
                kind: v.kind,
                items: cloneMealItems(v.items),
              })),
            }
          : {}),
      },
    });
  }
  for (const [mealId, last] of voidedMeals) {
    if (liveMeals.has(mealId) || (mealConsumes.get(mealId)?.active ?? 0) === 0) continue;
    mealRows.push({
      recordedAt: last.recordedAt,
      meal: {
        eventId: last.id,
        at: last.at,
        certainty: last.certainty,
        source: last.source,
        mealId,
        kind: last.kind,
        items: [],
        ...lines(mealId),
        revived: true,
      },
    });
  }
  mealRows.sort((a, b) =>
    compareEvents(
      { id: a.meal.eventId, at: a.meal.at, recordedAt: a.recordedAt },
      { id: b.meal.eventId, at: b.meal.at, recordedAt: b.recordedAt },
    ),
  );
  for (const { meal } of mealRows) {
    const date = localDate(meal.at, timeZone);
    if (date === undefined) continue;
    let day = days.get(date);
    if (!day) days.set(date, (day = emptyDay(date)));
    day.meals.push(meal);
  }

  const declarationEvents: MealDeclarationEvent[] = [];
  const untrackedRecordedAt = new Map<string, string>();
  const habitWinners = new Map<string, Extract<DiaryEvent, { type: "habit" }>>();

  // `live` è già in ordine canonico (at, recordedAt, id): le somme sono deterministiche.
  for (const e of live) {
    if (e.type === "habit") {
      const cur = habitWinners.get(e.habitId);
      if (
        !cur ||
        Date.parse(e.recordedAt) > Date.parse(cur.recordedAt) ||
        (Date.parse(e.recordedAt) === Date.parse(cur.recordedAt) && e.id > cur.id)
      ) {
        habitWinners.set(e.habitId, e);
      }
      continue;
    }
    if (e.type === "mealDeclaration") {
      declarationEvents.push(e);
      continue;
    }
    if (e.type === "meal") continue;
    const day = dayOf(e);
    if (!day) continue;
    const base = entryOf(e);
    switch (e.type) {
      case "untrackedMeal":
        day.untrackedMeals.push({ ...base, kind: e.kind });
        untrackedRecordedAt.set(e.id, e.recordedAt);
        break;
      case "water":
        day.waterMl = norm(day.waterMl + e.ml);
        day.waterCertainty = day.waterCertainty
          ? worseCertainty(day.waterCertainty, e.certainty)
          : e.certainty;
        break;
      case "drink":
        day.drinks.push({
          ...base,
          name: e.name,
          ml: e.ml,
          ...(e.caffeineMg !== undefined ? { caffeineMg: e.caffeineMg } : {}),
          ...(e.alcoholG !== undefined ? { alcoholG: e.alcoholG } : {}),
          ...(e.energyKcal !== undefined ? { energyKcal: e.energyKcal } : {}),
          ...(e.sugarsG !== undefined ? { sugarsG: e.sugarsG } : {}),
        });
        if (e.caffeineMg !== undefined) {
          day.caffeineMg = norm(day.caffeineMg + e.caffeineMg);
          day.caffeineCertainty = day.caffeineCertainty
            ? worseCertainty(day.caffeineCertainty, e.certainty)
            : e.certainty;
        }
        if (e.alcoholG !== undefined) {
          day.alcoholG = norm(day.alcoholG + e.alcoholG);
          day.alcoholCertainty = day.alcoholCertainty
            ? worseCertainty(day.alcoholCertainty, e.certainty)
            : e.certainty;
        }
        break;
      case "weight":
        day.weights.push({ ...base, kg: e.kg });
        day.weightKg = e.kg;
        break;
      case "mood":
        day.moods.push({ ...base, score: e.score, tags: [...(e.tags ?? [])] });
        break;
      case "symptom":
        day.symptoms.push({
          ...base,
          kind: e.kind,
          score: e.score,
          ...(e.label !== undefined ? { label: e.label } : {}),
        });
        break;
      case "supplement":
        day.supplements.push({
          ...base,
          name: e.name,
          ...(e.dose !== undefined ? { dose: e.dose } : {}),
          ...(e.lotId !== undefined ? { lotId: e.lotId } : {}),
        });
        break;
    }
  }

  resolveDeclarations(declarationEvents, days, untrackedRecordedAt);

  const habits: DiaryHabit[] = [];
  for (const h of habitWinners.values()) {
    if (h.archived === true) continue;
    habits.push({
      habitId: h.habitId,
      title: h.title,
      kind: h.kind,
      ...(h.usualTime !== undefined ? { usualTime: h.usualTime } : {}),
      items: cloneMealItems(h.items),
      eventId: h.id,
      recordedAt: h.recordedAt,
      certainty: h.certainty,
    });
  }
  habits.sort(
    (a, b) =>
      cmp(a.usualTime ?? "99:99", b.usualTime ?? "99:99") ||
      cmp(a.title, b.title) ||
      cmp(a.habitId, b.habitId),
  );

  anomalies.sort((a, b) => cmp(anomalyKey(a), anomalyKey(b)));

  return {
    timeZone,
    days: [...days.values()].sort((a, b) => cmp(a.date, b.date)),
    habits,
    anomalies,
    voidedEventIds: [...voided].sort(cmp),
  };
}
