// Nutrienti di pasti e giornate a partire dal registro degli eventi.

import {
  dayCoverage,
  deriveDiary,
  localDate,
  type DayCoverage,
  type DiaryDay,
  type DiaryMeal,
  type MealKind,
} from "../diary";
import { isValidKnownEvent, prepareLog, voidsOfLog } from "../diary/log";
import {
  derivePantry,
  type Certainty,
  type ConsumeEvent,
  type Quantity,
} from "../ledger";
import {
  nutrientsOfQuantity,
  roundValue,
  sumNutrients,
  type NotComputableReason,
  type NutrientTotals,
  type SumPart,
} from "./amounts";
import type { CompositionOrigin } from "./amounts";
import type { FoodState, StatePreference } from "./match";
import {
  DEFAULT_STATE_PREFERENCE,
  type CompositionResolver,
  type IntakeSubject,
} from "./resolve";
import type { NutrientAmounts, NutrientKey } from "./types";

export type UnresolvedReason =
  | "no_composition"
  /** Alimento riconosciuto, ma nella tabella c'è solo la voce secca e il pasto intende il cotto. */
  | "missing_cooked_entry"
  /** La voce porta l'identificativo di un alimento che non esiste più nella tabella. */
  | "unknown_food_id"
  | NotComputableReason
  | "unknown_lot";

interface LineBase {
  /** Voce libera di un pasto oppure consumo di dispensa. */
  kind: "mealItem" | "pantry";
  /** Nome della voce o riferimento del prodotto. */
  label: string;
  quantity: Quantity;
  quantityCertainty: Certainty;
  /** Id dell'evento: il pasto per una voce libera, il `consume` per la dispensa. */
  eventId: string;
  /** Posizione della voce nel pasto, per le voci libere. */
  itemIndex?: number;
  mealId?: string;
}

export interface ResolvedLine extends LineBase {
  status: "ok";
  /** A che cosa è stata associata la voce. */
  composition: {
    name: string;
    ref?: string;
    origin: CompositionOrigin;
    /**
     * Stato assunto per l'alimento (per esempio `cooked`: "calcolato come pasta cotta"); assente se
     * la fonte non lo dichiara, come i prodotti a codice a barre.
     */
    state?: FoodState;
    /** Preferenza di stato applicata e se è stata rispettata: se non lo è, l'utente può correggere. */
    statePreference?: StatePreference;
    /** `explicit`: alimento scelto dall'utente; `name`: trovato dal nome; `product`: codice a barre. */
    selection?: "explicit" | "name" | "product";
  };
  nutrients: NutrientAmounts;
  /** La peggiore tra la certezza della quantità e quella dell'origine dei valori. */
  certainty: Certainty;
  /**
   * La riga è la stima di un pasto fuori casa: `nutrients` porta la sola energia scritta nella voce, sempre
   * `estimated`. Non viene da una composizione (`composition` ripete il nome della voce, senza `ref`) e non c'è un
   * alimento da collegare. Per ogni altro nutriente la riga è un dato mancante: i totali che la comprendono sono parziali.
   */
  outOfHome?: true;
}

export interface UnresolvedLine extends LineBase {
  status: "unresolved";
  reason: UnresolvedReason;
  message?: string;
}

export type IntakeLine = ResolvedLine | UnresolvedLine;

export interface MealIntake {
  mealId: string;
  eventId: string;
  /** Data di calendario del pasto nel fuso scelto. */
  date: string;
  at: string;
  kind: MealKind;
  title?: string;
  lines: IntakeLine[];
  totals: NutrientTotals;
  certainty?: Certainty;
  unresolved: UnresolvedLine[];
}

export interface DrinkIntake {
  eventId: string;
  at: string;
  name: string;
  ml: number;
  caffeineMg?: number;
  alcoholG?: number;
  /** Energia e zuccheri, solo se la bevanda li dichiara: altrimenti sono non noti, non zero. */
  energyKcal?: number;
  sugarsG?: number;
  certainty: Certainty;
}

export type DayPartialReason =
  /** Almeno un pasto segnato come non tracciato. */
  | "untracked_meals"
  /** Manca colazione, pranzo o cena: né tracciato né dichiarato. */
  | "missing_meals"
  /** Un pasto tracciato senza alcuna voce. */
  | "empty_meals";

export interface DayIntake {
  date: string;
  /**
   * Vero solo se la giornata è tracciata per intero. Altrimenti i totali sono una parte
   * dell'assunzione e non vanno letti come assunzione completa.
   */
  complete: boolean;
  reasons: DayPartialReason[];
  coverage: DayCoverage;
  meals: MealIntake[];
  /** Consumi di dispensa senza pasto (compresi quelli di un pasto che non risulta nel diario). */
  standalone: IntakeLine[];
  drinks: DrinkIntake[];
  /**
   * Somma di pasti, consumi senza pasto e bevande. Le voci non risolte contano come dato mancante
   * di ogni nutriente: vedi `missingShare`.
   */
  totals: NutrientTotals;
  certainty?: Certainty;
  unresolved: UnresolvedLine[];
  /**
   * Presente se nel giorno c'è almeno una stima «fuori casa»: quante voci e quanta energia portano. Chi usa
   * l'energia del giorno per un conto (dispendio, confronti tra periodi) sa così quanta parte è una stima generica;
   * chi guarda gli alimenti sa che di quei pasti non si conosce il contenuto.
   */
  outOfHome?: OutOfHomeInfo;
}

/** Le stime «fuori casa» di una giornata. */
export interface OutOfHomeInfo {
  /** Voci «fuori casa» (di norma una per pasto). */
  meals: number;
  /** Somma dell'energia stimata, in kcal. */
  energyKcal: number;
}

export interface IntakeOptions {
  /** Stati preferiti per tipo di voce; vedi `DEFAULT_STATE_PREFERENCE`. */
  statePreference?: Partial<Record<"mealItem" | "pantry", readonly FoodState[]>>;
  /** Fuso orario IANA con cui si assegnano gli eventi ai giorni. Predefinito `Europe/Rome`. */
  timeZone?: string;
}

export interface IntakeResult {
  timeZone: string;
  /** Giorni con almeno una voce, in ordine di data. */
  days: DayIntake[];
}

/** `consume` validi e non annullati, con o senza pasto, in ordine canonico. */
function activeConsumeEvents(events: readonly unknown[]): ConsumeEvent[] {
  const log = prepareLog(events);
  const { voided } = voidsOfLog(log.events);
  const out: ConsumeEvent[] = [];
  for (const e of log.events) {
    const c = e as Partial<ConsumeEvent>;
    if (c.type !== "consume" || typeof c.id !== "string") continue;
    if (voided.has(c.id) || !isValidKnownEvent(e)) continue;
    out.push(e as ConsumeEvent);
  }
  return out;
}

function makeLine(
  base: LineBase,
  subject: IntakeSubject,
  resolve: CompositionResolver,
): IntakeLine {
  const composition = resolve(subject);
  if (!composition) return { ...base, status: "unresolved", reason: "no_composition" };
  if ("failure" in composition) {
    return {
      ...base,
      status: "unresolved",
      reason: composition.failure,
      ...(composition.message !== undefined ? { message: composition.message } : {}),
    };
  }
  const result = nutrientsOfQuantity(composition, base.quantity, base.quantityCertainty);
  if (!result.ok) {
    return { ...base, status: "unresolved", reason: result.reason, message: result.message };
  }
  return {
    ...base,
    status: "ok",
    composition: {
      name: composition.name,
      ...(composition.ref !== undefined ? { ref: composition.ref } : {}),
      origin: composition.origin,
      ...(composition.state !== undefined ? { state: composition.state } : {}),
      ...(composition.statePreference !== undefined
        ? { statePreference: composition.statePreference }
        : {}),
      ...(composition.selection !== undefined ? { selection: composition.selection } : {}),
    },
    nutrients: result.value.nutrients,
    certainty: result.value.certainty,
  };
}

/** L'energia stimata scritta in una voce «fuori casa», se c'è ed è un numero valido. */
function writtenEnergyOf(item: object): number | undefined {
  const kcal = (item as { energyKcal?: unknown }).energyKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : undefined;
}

/** Identificativo dell'alimento scelto dall'utente per una voce libera, se presente. */
function foodIdOf(item: object): string | undefined {
  const id = (item as { foodId?: unknown }).foodId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

function partOf(line: IntakeLine): SumPart {
  const weight = line.quantity.unit === "pz" ? undefined : line.quantity.value;
  if (line.status === "ok") {
    return {
      nutrients: line.nutrients,
      certainty: line.certainty,
      weight: line.quantity.unit === "pz" ? undefined : line.quantity.value,
    };
  }
  return { nutrients: {}, ...(weight !== undefined ? { weight } : {}) };
}

/** Le stime «fuori casa» tra le righe; `undefined` se non ce ne sono. */
function outOfHomeOf(lines: readonly IntakeLine[]): OutOfHomeInfo | undefined {
  let meals = 0;
  let energyKcal = 0;
  for (const line of lines) {
    if (line.status !== "ok" || line.outOfHome !== true) continue;
    meals++;
    energyKcal += line.nutrients.energyKcal ?? 0;
  }
  return meals > 0 ? { meals, energyKcal: roundValue(energyKcal) } : undefined;
}

/**
 * Una stima «fuori casa» è una riga sola, senza peso: contata per righe direbbe che manca poco («1 voce su 8») anche
 * quando vale metà giornata. Per i nutrienti che la stima non copre (tutti tranne l'energia) la quota di dato mancante
 * è allora almeno la parte di energia stimata fuori casa sul totale di energia: un pranzo fuori che vale metà
 * dell'energia del giorno dice «manca circa metà». Resta un minimo: se anche altre voci non hanno il dato, vale la
 * quota più alta tra le due.
 */
function withOutOfHomeShare(totals: NutrientTotals, outOfHome: OutOfHomeInfo | undefined): NutrientTotals {
  const energy = totals.energyKcal?.value;
  if (!outOfHome || !(outOfHome.energyKcal > 0) || energy === undefined || !(energy > 0)) return totals;
  const share = roundValue(Math.min(1, outOfHome.energyKcal / energy));
  const out: NutrientTotals = { ...totals };
  for (const key of Object.keys(totals) as NutrientKey[]) {
    const total = totals[key];
    if (key === "energyKcal" || !total || total.missingShare >= share) continue;
    out[key] = { ...total, missingShare: share, partial: true };
  }
  return out;
}

const unresolvedOf = (lines: readonly IntakeLine[]): UnresolvedLine[] =>
  lines.filter((l): l is UnresolvedLine => l.status === "unresolved");

function drinkPart(d: DrinkIntake): SumPart | undefined {
  const nutrients: NutrientAmounts = {};
  const scope: NutrientKey[] = [];
  if (d.caffeineMg !== undefined) {
    nutrients.caffeineMg = d.caffeineMg;
    scope.push("caffeineMg");
  }
  if (d.alcoholG !== undefined) {
    nutrients.alcoholG = d.alcoholG;
    scope.push("alcoholG");
  }
  if (d.energyKcal !== undefined) {
    nutrients.energyKcal = d.energyKcal;
    scope.push("energyKcal");
  }
  if (d.sugarsG !== undefined) {
    nutrients.sugarsG = d.sugarsG;
    scope.push("sugarsG");
  }
  // Una bevanda che non dichiara nulla non dice niente: non è un dato e non è un vuoto.
  return scope.length === 0 ? undefined : { nutrients, certainty: d.certainty, weight: d.ml, scope };
}

function mealIntake(
  meal: DiaryMeal,
  date: string,
  consumes: readonly ConsumeEvent[],
  lotRef: (lotId: string) => { productRef: string; category?: string } | undefined,
  resolve: CompositionResolver,
): MealIntake {
  const lines: IntakeLine[] = [];
  meal.items.forEach((item, itemIndex) => {
    const base: LineBase = {
      kind: "mealItem",
      label: item.name,
      quantity: item.quantity,
      quantityCertainty: item.certainty,
      eventId: meal.eventId,
      itemIndex,
      mealId: meal.mealId,
    };
    const writtenEnergy = writtenEnergyOf(item);
    if (writtenEnergy !== undefined) {
      // Pasto fuori casa: vale l'energia scritta, senza cercare un alimento. Gli altri nutrienti restano assenti, e
      // un nutriente assente in una riga rende parziale il suo totale (come per le voci non riconosciute).
      lines.push({
        ...base,
        status: "ok",
        composition: { name: item.name, origin: "derived" },
        nutrients: { energyKcal: writtenEnergy },
        certainty: "estimated",
        outOfHome: true,
      });
      return;
    }
    lines.push(
      makeLine(
        base,
        {
          kind: "mealItem",
          name: item.name,
          mealId: meal.mealId,
          ...(foodIdOf(item) !== undefined ? { foodId: foodIdOf(item) } : {}),
        },
        resolve,
      ),
    );
  });
  for (const c of consumes) lines.push(pantryLine(c, lotRef, resolve));
  const sum = sumNutrients(lines.map(partOf));
  return {
    mealId: meal.mealId,
    eventId: meal.eventId,
    date,
    at: meal.at,
    kind: meal.kind,
    ...(meal.title !== undefined ? { title: meal.title } : {}),
    lines,
    totals: withOutOfHomeShare(sum.totals, outOfHomeOf(lines)),
    ...(sum.certainty !== undefined ? { certainty: sum.certainty } : {}),
    unresolved: unresolvedOf(lines),
  };
}

function pantryLine(
  c: ConsumeEvent,
  lotRef: (lotId: string) => { productRef: string; category?: string } | undefined,
  resolve: CompositionResolver,
): IntakeLine {
  const lot = lotRef(c.lotId);
  const base: LineBase = {
    kind: "pantry",
    label: lot?.productRef ?? c.lotId,
    quantity: c.quantity,
    quantityCertainty: c.certainty,
    eventId: c.id,
    ...(c.mealId !== undefined ? { mealId: c.mealId } : {}),
  };
  if (!lot) return { ...base, status: "unresolved", reason: "unknown_lot" };
  return makeLine(
    base,
    {
      kind: "pantry",
      productRef: lot.productRef,
      lotId: c.lotId,
      ...(lot.category !== undefined ? { category: lot.category } : {}),
    },
    resolve,
  );
}

/**
 * Nutrienti per voce, per pasto e per giornata dal registro intero (diario e dispensa).
 *
 * - Le voci libere dei pasti e i consumi di dispensa collegati da `mealId` formano il pasto;
 *   i consumi senza pasto (o con un pasto che non esiste nel diario) vanno alla giornata del loro
 *   `at`. Eventi annullati e non validi non contano.
 * - Le composizioni vengono dal risolutore, che riceve con ogni voce gli stati preferiti: `cooked`
 *   per le voci libere dei pasti, `dried`/`raw`/`as_sold` per la dispensa (`statePreference`). Ogni
 *   riga dice lo stato assunto in `composition.state`.
 *   Una voce senza composizione o con una quantità non
 *   convertibile è "non risolta" e resta nell'elenco, mai conteggiata come zero.
 * - Una voce «fuori casa» (con `energyKcal`) dà una riga con la sola energia scritta, come stima: entra nei totali
 *   di energia del pasto e del giorno, e per ogni altro nutriente è un dato mancante (il totale è un minimo): la
 *   quota mancante di quei nutrienti è almeno la parte di energia stimata fuori casa sull'energia del giorno
 *   (`missingShare`), e il giorno porta `outOfHome`. Il momento conta come tracciato.
 * - Le bevande contribuiscono solo con la caffeina e l'alcol che dichiarano.
 * - Una giornata è completa solo se colazione, pranzo e cena sono tracciati, nessun pasto è segnato
 *   come non tracciato e nessun pasto tracciato è vuoto.
 *
 * L'ordine e i duplicati degli eventi non cambiano il risultato.
 */
export function computeIntake(
  events: Iterable<unknown>,
  resolver: CompositionResolver,
  options: IntakeOptions = {},
): IntakeResult {
  const preferences = { ...DEFAULT_STATE_PREFERENCE, ...options.statePreference };
  // Il risolutore riceve con ogni voce gli stati preferiti per quel tipo di voce.
  const resolve: CompositionResolver = (subject) =>
    resolver({ ...subject, preferStates: subject.preferStates ?? preferences[subject.kind] });
  const list = [...events];
  const diary = deriveDiary(list, options);
  const consumes = activeConsumeEvents(list);
  const lots = new Map(derivePantry(list).lots.map((l) => [l.lotId, l]));
  const lotRef = (lotId: string) => {
    const lot = lots.get(lotId);
    return lot
      ? { productRef: lot.productRef, ...(lot.category !== undefined ? { category: lot.category } : {}) }
      : undefined;
  };

  const mealDate = new Map<string, string>();
  for (const day of diary.days) for (const m of day.meals) mealDate.set(m.mealId, day.date);

  const byMeal = new Map<string, ConsumeEvent[]>();
  const standaloneByDate = new Map<string, ConsumeEvent[]>();
  for (const c of consumes) {
    if (c.mealId !== undefined && c.mealId !== "" && mealDate.has(c.mealId)) {
      const list = byMeal.get(c.mealId);
      if (list) list.push(c);
      else byMeal.set(c.mealId, [c]);
      continue;
    }
    const date = localDate(c.at, diary.timeZone);
    if (date === undefined) continue;
    const list = standaloneByDate.get(date);
    if (list) list.push(c);
    else standaloneByDate.set(date, [c]);
  }

  const dates = new Set<string>([...diary.days.map((d) => d.date), ...standaloneByDate.keys()]);
  const diaryByDate = new Map<string, DiaryDay>(diary.days.map((d) => [d.date, d]));

  const days: DayIntake[] = [...dates].sort().map((date) => {
    const diaryDay = diaryByDate.get(date);
    const meals = (diaryDay?.meals ?? []).map((m) =>
      mealIntake(m, date, byMeal.get(m.mealId) ?? [], lotRef, resolve),
    );
    const standalone = (standaloneByDate.get(date) ?? []).map((c) => pantryLine(c, lotRef, resolve));
    const drinks: DrinkIntake[] = (diaryDay?.drinks ?? []).map((d) => ({
      eventId: d.eventId,
      at: d.at,
      name: d.name,
      ml: d.ml,
      ...(d.caffeineMg !== undefined ? { caffeineMg: d.caffeineMg } : {}),
      ...(d.alcoholG !== undefined ? { alcoholG: d.alcoholG } : {}),
      ...(d.energyKcal !== undefined ? { energyKcal: d.energyKcal } : {}),
      ...(d.sugarsG !== undefined ? { sugarsG: d.sugarsG } : {}),
      certainty: d.certainty,
    }));

    const allLines = [...meals.flatMap((m) => m.lines), ...standalone];
    const parts: SumPart[] = allLines.map(partOf);
    for (const d of drinks) {
      const p = drinkPart(d);
      if (p) parts.push(p);
    }
    const sum = sumNutrients(parts);
    const outOfHome = outOfHomeOf(allLines);

    const coverage = dayCoverage(diaryDay, date);
    const reasons: DayPartialReason[] = [];
    if (coverage.untracked > 0) reasons.push("untracked_meals");
    if (coverage.missing.length > 0) reasons.push("missing_meals");
    if (meals.some((m) => m.lines.length === 0)) reasons.push("empty_meals");

    return {
      date,
      complete: reasons.length === 0,
      reasons,
      coverage,
      meals,
      standalone,
      drinks,
      totals: withOutOfHomeShare(sum.totals, outOfHome),
      ...(sum.certainty !== undefined ? { certainty: sum.certainty } : {}),
      unresolved: unresolvedOf(allLines),
      ...(outOfHome ? { outOfHome } : {}),
    };
  });

  return { timeZone: diary.timeZone, days };
}
