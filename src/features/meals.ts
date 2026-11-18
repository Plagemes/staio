// Pasti: composizione degli eventi, tipo di pasto dall'ora, pasti abituali, riepilogo del giorno. Logica pura.
import {
  createHabit,
  createMeal,
  createMealDeclaration,
  createUntrackedMeal,
  localMoment,
  mealMoments,
  momentOfMinutes,
  type DiaryDay,
  type DiaryEventOptions,
  type DiaryHabit,
  type HabitEvent,
  type MealEvent,
  type MealDeclarationStatus,
  type MealItem,
  type MealKind,
  type MealMoment,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import {
  SCHEMA_VERSION,
  generateId,
  validateEvent,
  worseCertainty,
  type Certainty,
  type ConsumeEvent,
  type IdGenerator,
  type Lot,
  type Quantity,
} from "@/core/ledger";
import {
  OUT_OF_HOME_FACTOR,
  OUT_OF_HOME_MIN_MEALS,
  OUT_OF_HOME_SIZES,
  REFERENCE_ENERGY_KCAL,
  estimateOutOfHome,
  type OutOfHomeEstimate,
  type OutOfHomeSize,
} from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { resolveAmount, type AmountChoice } from "./actions";
import { formatNutrient } from "./nutrition/labels";
import { pieceChoices } from "./pieces";
import { readQuantity } from "./capture";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";

export const MEAL_KIND_LABELS: Record<MealKind, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};

export const MEAL_KIND_ORDER: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];

/** I tre pasti che fanno una giornata: gli spuntini non contano. */
export const MAIN_MEALS: readonly MealKind[] = ["breakfast", "lunch", "dinner"];

/** Tipo di pasto più probabile per l'ora locale di un istante (la stessa regola con cui le bevande vanno a un momento). */
export function suggestMealKind(at: string, timeZone: string = DEFAULT_TIME_ZONE): MealKind {
  const m = localMoment(at, timeZone);
  return m ? momentOfMinutes(m.minutes) : "snack";
}

/** "08:05" nel fuso dato. */
export function localTime(at: string, timeZone: string = DEFAULT_TIME_ZONE): string | undefined {
  const m = localMoment(at, timeZone);
  if (!m) return undefined;
  const h = String(Math.floor(m.minutes / 60)).padStart(2, "0");
  const min = String(m.minutes % 60).padStart(2, "0");
  return `${h}:${min}`;
}

/** Ora tipica di ogni momento, per un pasto o una bevanda di un giorno passato (modificabile). */
export const TYPICAL_MEAL_TIME: Record<MealKind, string> = {
  breakfast: "08:00",
  lunch: "13:00",
  dinner: "20:00",
  snack: "16:30",
};

/**
 * Come si sceglie la quantità di un alimento preso da un lotto: tutto, metà, un quarto, scritta a mano, oppure
 * (per i lotti fatti di pezzi) una delle scelte `piece:<id>` di `pieceChoices`, per esempio «1 piadina = 100 g».
 */
export type AmountKey = "all" | "half" | "quarter" | "text" | `piece:${string}`;

/** La scelta di quantità per un lotto: i pezzi diventano una quantità già calcolata, le frazioni di pezzo restano stime. */
export function amountChoiceOf(key: AmountKey, text: string, lot: Lot): AmountChoice {
  if (key.startsWith("piece:")) {
    const piece = pieceChoices(lot).find((c) => c.id === key.slice("piece:".length));
    if (piece) return { kind: "value", value: piece.quantity.value, estimated: piece.estimated };
    // una scelta che non esiste più (il lotto è cambiato): meglio chiedere la quantità che consumare tutto
    return { kind: "text", text: "" };
  }
  return key === "text" ? { kind: "text", text } : { kind: key as "all" | "half" | "quarter" };
}

export function defaultHabitTitle(kind: MealKind): string {
  return { breakfast: "Solita colazione", lunch: "Solito pranzo", dinner: "Solita cena", snack: "Solito spuntino" }[kind];
}

export interface MealPick {
  lot: Lot;
  choice: AmountChoice;
}

export interface FreeItemInput {
  name: string;
  quantityText: string;
  /** Alimento della tabella scelto dall'utente: il nome scritto resta com'è e il calcolo usa questo. */
  foodId?: string;
}

export interface MealInput {
  kind: MealKind;
  title?: string;
  picks: readonly MealPick[];
  freeItems: readonly FreeItemInput[];
  /** Se presente, salva anche il pasto come abituale con questo nome. */
  saveHabitAs?: string;
}

export interface MealErrors {
  /** Per `lotId`. */
  picks: Record<string, string>;
  /** Per posizione nell'elenco delle voci libere. */
  free: Record<number, string>;
  general?: string;
}

export interface MealContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
  /**
   * Quando è stato mangiato, se non adesso (un pasto di un giorno passato). Vale solo per l'evento del pasto: i
   * consumi della dispensa restano di adesso, perché la dispensa non torna indietro nel tempo.
   */
  mealAt?: string;
}

export type MealResult =
  | { ok: true; events: AnyEvent[]; mealId: string; message: string }
  | { ok: false; errors: MealErrors };

function options(ctx: MealContext, extra: Partial<DiaryEventOptions> = {}): DiaryEventOptions {
  return { deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: ctx.idGenerator, ...extra };
}

function consumeFor(pick: { lotId: string; quantity: Quantity; certainty: Certainty }, mealId: string, ctx: MealContext, source: "manual" | "habit") {
  const event: ConsumeEvent = {
    id: (ctx.idGenerator ?? generateId)(),
    type: "consume",
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: pick.certainty,
    source,
    lotId: pick.lotId,
    quantity: pick.quantity,
    mealId,
  };
  return event;
}

/**
 * Un pasto: un evento `meal` con le voci libere e un `consume` per ogni alimento preso dalla dispensa,
 * tutti con lo stesso `mealId`. Le voci libere valgono sempre come stime.
 */
export function buildMealEvents(input: MealInput, ctx: MealContext): MealResult {
  const errors: MealErrors = { picks: {}, free: {} };
  const consumes: { lot: Lot; quantity: Quantity; certainty: Certainty }[] = [];
  const items: MealItem[] = [];

  for (const pick of input.picks) {
    const amount = resolveAmount(pick.lot, pick.choice);
    if (!amount.ok) errors.picks[pick.lot.lotId] = amount.error;
    else consumes.push({ lot: pick.lot, quantity: amount.quantity, certainty: amount.certainty });
  }
  input.freeItems.forEach((item, index) => {
    const name = item.name.trim().replace(/\s+/g, " ");
    if (name === "" && item.quantityText.trim() === "") return;
    if (name === "") {
      errors.free[index] = "Scrivi come si chiama.";
      return;
    }
    const q = readQuantity(item.quantityText);
    if (!q.ok) errors.free[index] = q.error;
    else items.push({ name, quantity: q.quantity, certainty: "estimated", ...(item.foodId ? { foodId: item.foodId } : {}) });
  });

  if (consumes.length + items.length === 0 && Object.keys(errors.picks).length + Object.keys(errors.free).length === 0) {
    errors.general = "Aggiungi almeno un alimento, dalla dispensa o scritto a mano.";
  }
  if (errors.general || Object.keys(errors.picks).length > 0 || Object.keys(errors.free).length > 0) {
    return { ok: false, errors };
  }

  let certainty: Certainty = "measured";
  for (const c of consumes) certainty = worseCertainty(certainty, c.certainty);
  for (const i of items) certainty = worseCertainty(certainty, i.certainty);

  let meal: MealEvent;
  try {
    meal = createMeal(
      { kind: input.kind, title: input.title?.trim() || undefined, items: items.length > 0 ? items : undefined },
      options(ctx, { certainty, ...(ctx.mealAt ? { at: ctx.mealAt } : {}) }),
    );
  } catch {
    return { ok: false, errors: { picks: {}, free: {}, general: "Non riesco a scrivere questo pasto: controlla le quantità." } };
  }
  const events: AnyEvent[] = [meal];
  for (const c of consumes) events.push(consumeFor({ lotId: c.lot.lotId, quantity: c.quantity, certainty: c.certainty }, meal.mealId, ctx, "manual"));

  const habitTitle = input.saveHabitAs?.trim();
  let habit: HabitEvent | undefined;
  if (habitTitle) {
    const habitItems: MealItem[] = [
      ...consumes.map((c) => ({ name: c.lot.productRef, quantity: c.quantity, certainty: c.certainty })),
      ...items,
    ];
    try {
      habit = createHabit(
        { habitId: (ctx.idGenerator ?? generateId)(), title: habitTitle, kind: input.kind, usualTime: localTime(ctx.mealAt ?? ctx.now), items: habitItems },
        options(ctx),
      );
      events.push(habit);
    } catch {
      return { ok: false, errors: { picks: {}, free: {}, general: "Il nome del pasto abituale non è valido." } };
    }
  }

  for (const e of events) {
    if (e.type === "consume" && validateEvent(e).length > 0) {
      return { ok: false, errors: { picks: {}, free: {}, general: "Non riesco a scrivere questo pasto." } };
    }
  }

  const parts = [...consumes.map((c) => c.lot.productRef), ...items.map((i) => i.name)];
  const message =
    `Registrato: ${MEAL_KIND_LABELS[input.kind].toLowerCase()} con ${parts.slice(0, 3).join(", ")}` +
    (parts.length > 3 ? ` e altri ${parts.length - 3}` : "") +
    (habit ? `. Salvato come «${habit.title}»` : "") +
    ".";
  return { ok: true, events, mealId: meal.mealId, message };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export type HabitMealResult = {
  events: AnyEvent[];
  mealId: string;
  /** Voci che non si sono potute prendere (tutte o in parte) dalla dispensa. */
  missing: string[];
  message: string;
};

/**
 * Registra un pasto abituale. Ogni voce si prende dalla dispensa (prima i lotti da mangiare per primi:
 * `lots` va passato in quell'ordine) finché c'è; ciò che manca diventa una voce libera stimata, e il
 * messaggio lo dice. Il pasto si registra comunque.
 */
export function buildMealFromHabit(
  habit: Pick<DiaryHabit, "habitId" | "title" | "kind" | "items">,
  lots: readonly Lot[],
  ctx: MealContext,
): HabitMealResult {
  const left = new Map(lots.map((l) => [l.lotId, l.remaining]));
  const consumes: { lotId: string; quantity: Quantity; certainty: Certainty }[] = [];
  const free: MealItem[] = [];
  const missing: string[] = [];

  for (const item of habit.items) {
    let need = item.quantity.value;
    const matches = lots.filter(
      (l) => fold(l.productRef) === fold(item.name) && l.unit === item.quantity.unit && (left.get(l.lotId) ?? 0) > 0,
    );
    for (const lot of matches) {
      if (need <= 1e-9) break;
      const available = left.get(lot.lotId) ?? 0;
      const take = Math.min(available, need);
      left.set(lot.lotId, Math.round((available - take) * 1e9) / 1e9);
      need = Math.round((need - take) * 1e9) / 1e9;
      consumes.push({ lotId: lot.lotId, quantity: { value: take, unit: lot.unit }, certainty: item.certainty });
    }
    if (need > 1e-9) {
      free.push({
        name: item.name,
        quantity: { value: need, unit: item.quantity.unit },
        certainty: "estimated",
        ...(item.foodId ? { foodId: item.foodId } : {}),
      });
      missing.push(item.name);
    }
  }

  const certainty: Certainty = [...consumes.map((c) => c.certainty), ...free.map((f) => f.certainty)].reduce(
    (a, b) => worseCertainty(a, b),
    "measured" as Certainty,
  );
  const meal = createMeal(
    { kind: habit.kind, title: habit.title, items: free.length > 0 ? free : undefined, habitId: habit.habitId },
    options(ctx, { certainty, source: "habit" }),
  );
  const events: AnyEvent[] = [meal, ...consumes.map((c) => consumeFor(c, meal.mealId, ctx, "habit"))];

  const unique = [...new Set(missing)];
  const message =
    `Registrato: ${habit.title}.` +
    (unique.length > 0
      ? ` ${unique.join(", ")} ${unique.length === 1 ? "non è" : "non sono"} più in dispensa: ${unique.length === 1 ? "l'ho aggiunto" : "li ho aggiunti"} come ${unique.length === 1 ? "voce libera stimata" : "voci libere stimate"}.`
      : "");
  return { events, mealId: meal.mealId, missing: unique, message };
}

/* ---------- fuori casa: un pasto di cui non si conoscono gli alimenti, registrato come stima ---------- */

export const OUT_OF_HOME_SIZE_LABELS: Record<OutOfHomeSize, string> = { light: "Leggero", normal: "Normale", large: "Abbondante" };

/** Il nome della voce nel diario: «Fuori casa · normale». */
export const outOfHomeName = (size: OutOfHomeSize): string => `Fuori casa · ${OUT_OF_HOME_SIZE_LABELS[size].toLowerCase()}`;

/** La voce è una stima «fuori casa»: porta un'energia scritta e non i suoi alimenti. */
export const isOutOfHomeItem = (item: Pick<MealItem, "energyKcal">): boolean => item.energyKcal !== undefined;

/** La taglia scritta nel nome di una voce «fuori casa»; `undefined` se il nome non è uno dei tre. */
export function outOfHomeSizeOf(name: string): OutOfHomeSize | undefined {
  const key = fold(name);
  return OUT_OF_HOME_SIZES.find((size) => fold(outOfHomeName(size)) === key);
}

/** «~800 kcal»: la tilde c'è sempre, perché il numero è sempre una stima. */
export const energyEstimateText = (energyKcal: number): string => `~${formatNutrient("energyKcal", energyKcal)}`;

/** «pranzo fuori casa, normale (~800 kcal, stima)» */
export function outOfHomeSentence(kind: MealKind, size: OutOfHomeSize, energyKcal: number): string {
  return `${MEAL_KIND_LABELS[kind].toLowerCase()} fuori casa, ${OUT_OF_HOME_SIZE_LABELS[size].toLowerCase()} (${energyEstimateText(energyKcal)}, stima)`;
}

const FROM_YOUR_MEALS: Record<MealKind, string> = {
  breakfast: "dalle tue colazioni",
  lunch: "dai tuoi pranzi",
  dinner: "dalle tue cene",
  snack: "dai tuoi spuntini",
};
const FROM_YOUR_RECORDED_MEALS: Record<MealKind, string> = {
  breakfast: "dalle tue colazioni registrate",
  lunch: "dai tuoi pranzi registrati",
  dinner: "dalle tue cene registrate",
  snack: "dai tuoi spuntini registrati",
};
const WITH_ENOUGH_MEALS: Record<MealKind, string> = {
  breakfast: "colazioni registrate userò le tue",
  lunch: "pranzi registrati userò i tuoi",
  dinner: "cene registrate userò le tue",
  snack: "spuntini registrati userò i tuoi",
};
const COUNT_WORDS = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci"];
const inWords = (n: number): string => COUNT_WORDS[n] ?? String(n);

/** La riga piccola sotto la voce: «~480 kcal, stima generica», «~450 kcal, stima dai tuoi pranzi». */
export function outOfHomeHint(kind: MealKind, estimate: OutOfHomeEstimate): string {
  return `${energyEstimateText(estimate.energyKcal)}, stima ${estimate.basis === "personal" ? FROM_YOUR_MEALS[kind] : "generica"}`;
}

/**
 * Da dove viene la stima, in una riga: «È una stima dai tuoi pranzi registrati, moltiplicata per 1,5.» oppure «È una
 * stima generica: una parte di 2000 kcal al giorno. Con cinque pranzi registrati userò i tuoi.». Solo il conto, nessun
 * parere. Non dice «media»: il valore personale è quello di mezzo tra i pasti registrati, tenuto entro limiti
 * (`estimateOutOfHome`), e «dai tuoi pranzi» resta vero in ogni caso.
 */
export function outOfHomeBasisText(kind: MealKind, size: OutOfHomeSize, estimate: OutOfHomeEstimate): string {
  if (estimate.basis === "personal") {
    const factor = OUT_OF_HOME_FACTOR[size];
    return `È una stima ${FROM_YOUR_RECORDED_MEALS[kind]}${factor === 1 ? "" : `, moltiplicata per ${factor.toLocaleString("it-IT")}`}.`;
  }
  return `È una stima generica: una parte di ${formatNutrient("energyKcal", REFERENCE_ENERGY_KCAL)} al giorno. Con ${inWords(OUT_OF_HOME_MIN_MEALS)} ${WITH_ENOUGH_MEALS[kind]}.`;
}

export interface OutOfHomeChoice {
  id: `out-${OutOfHomeSize}`;
  size: OutOfHomeSize;
  /** «Fuori casa · normale»: il nome che la voce avrà nel diario. */
  label: string;
  hint: string;
  estimate: OutOfHomeEstimate;
}

/**
 * Le tre voci «Fuori casa» per un momento, dalla più piccola. `history`: l'energia dei pasti registrati in quel
 * momento negli ultimi 30 giorni (`mealEnergyHistory`).
 */
export function outOfHomeChoices(kind: MealKind, history: readonly number[]): OutOfHomeChoice[] {
  return OUT_OF_HOME_SIZES.map((size) => {
    const estimate = estimateOutOfHome(kind, size, history);
    return { id: `out-${size}` as const, size, label: outOfHomeName(size), hint: outOfHomeHint(kind, estimate), estimate };
  });
}

/**
 * Un pasto fuori casa: un evento `meal` con una sola voce, che porta la stima dell'energia e nient'altro. È sempre
 * una stima. `ctx.mealAt` vale come per gli altri pasti (un giorno passato, l'ora proposta).
 */
export function buildOutOfHomeMeal(
  args: { kind: MealKind; size: OutOfHomeSize; estimate: OutOfHomeEstimate },
  ctx: MealContext,
): { events: AnyEvent[]; mealId: string; message: string } {
  const { kind, size, estimate } = args;
  const item: MealItem = {
    name: outOfHomeName(size),
    quantity: { value: 1, unit: "pz" },
    certainty: "estimated",
    energyKcal: estimate.energyKcal,
  };
  const meal = createMeal({ kind, items: [item] }, options(ctx, { certainty: "estimated", ...(ctx.mealAt ? { at: ctx.mealAt } : {}) }));
  return { events: [meal], mealId: meal.mealId, message: `Registrato: ${outOfHomeSentence(kind, size, estimate.energyKcal)}.` };
}

export function buildUntrackedMeal(kind: MealKind, ctx: MealContext): { events: AnyEvent[]; message: string } {
  const event = createUntrackedMeal({ kind }, options(ctx));
  return { events: [event], message: `Segnato: ${MEAL_KIND_LABELS[kind].toLowerCase()} fuori, non tracciato.` };
}

/** I tre momenti che si possono dichiarare. */
export type DeclarableKind = "breakfast" | "lunch" | "dinner";

export function buildMealDeclaration(
  date: string,
  kind: DeclarableKind,
  status: MealDeclarationStatus,
  ctx: MealContext,
): { events: AnyEvent[]; message: string } {
  const event = createMealDeclaration({ date, kind, status }, options(ctx));
  const name = MEAL_KIND_LABELS[kind].toLowerCase();
  const feminine = kind !== "lunch";
  const word = status === "skipped" ? (feminine ? "saltata" : "saltato") : feminine ? "mangiata, senza dettagli" : "mangiato, senza dettagli";
  return { events: [event], message: `Segnato: ${name} ${word}.` };
}

/** Inizio della fascia di ogni momento (minuti): da lì in poi il momento compare in Oggi. */
export const MOMENT_STARTS: Record<DeclarableKind, number> = {
  breakfast: 5 * 60,
  lunch: 10 * 60 + 30,
  dinner: 18 * 60 + 30,
};

/** Da quest'ora si propone «Saltato»: oltre il tempo in cui il pasto si fa di solito, non prima. */
export const MOMENT_DECLARE_FROM: Record<DeclarableKind, number> = {
  breakfast: 10 * 60,
  lunch: 14 * 60 + 30,
  dinner: 21 * 60,
};

const HOUR_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;

/** "12:30" → minuti dalla mezzanotte. */
export function minutesOfTime(text: string): number | undefined {
  const m = HOUR_RE.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export type MomentOffer = "hidden" | "register" | "declare";

/**
 * Che cosa propone Oggi per un momento senza pasto. `hidden`: la fascia non è ancora cominciata, non
 * si mostra niente. `register`: si può registrare, ma non si propone «Saltato» (il momento è in corso o
 * appena iniziato). `declare`: passato l'orario abituale (quello del pasto abituale se c'è, più un'ora
 * e mezza; altrimenti quello tipico della fascia) si offrono anche «Saltato» e «Mangiato, senza dettagli».
 * Un giorno passato offre sempre tutto.
 */
export function momentOffer(
  kind: DeclarableKind,
  nowMinutes: number,
  options: { pastDay?: boolean; usualTime?: string } = {},
): MomentOffer {
  if (options.pastDay) return "declare";
  if (nowMinutes < MOMENT_STARTS[kind]) return "hidden";
  const usual = options.usualTime !== undefined ? minutesOfTime(options.usualTime) : undefined;
  const from = usual !== undefined ? Math.min(MOMENT_DECLARE_FROM[kind], usual + 90) : MOMENT_DECLARE_FROM[kind];
  return nowMinutes >= from ? "declare" : "register";
}

const MOMENT_STATUS_TEXT: Record<MealMoment["status"], string> = {
  recorded: "registrato",
  skipped: "saltato",
  untracked: "mangiato, senza dettagli",
  none: "",
};

/** "Pranzo · saltato", "Colazione · solo una bevanda: tè". Una bevanda non è un pasto registrato. */
export function momentTitle(kind: MealKind, status: MealMoment["status"], drinkNames: readonly string[] = []): string {
  const label = MEAL_KIND_LABELS[kind];
  const names = [...new Set(drinkNames.map((n) => n.trim().toLowerCase()))];
  if (status === "none") {
    if (names.length === 0) return label;
    return `${label} · ${names.length === 1 ? "solo una bevanda" : "solo bevande"}: ${names.join(", ")}`;
  }
  const base = `${label} · ${MOMENT_STATUS_TEXT[status]}`;
  return names.length > 0 ? `${base} · ${names.length === 1 ? "bevanda" : "bevande"}: ${names.join(", ")}` : base;
}

/** Stato dei tre momenti di un giorno. */
export function momentsOf(day: DiaryDay | undefined): (MealMoment & { kind: DeclarableKind })[] {
  return mealMoments(day).filter((m): m is MealMoment & { kind: DeclarableKind } => m.kind !== "snack");
}

/** Riga di testo per un alimento di un pasto: "Latte 200 ml". */
export function itemText(name: string, quantity: Quantity): string {
  return `${name} ${formatQuantity(quantity)}`;
}

export type DayStatus = "complete" | "declared" | "gaps";

export interface DaySummary {
  status: DayStatus;
  /** Colazione, pranzo e cena registrati. */
  tracked: MealKind[];
  /** Colazione, pranzo e cena dichiarati «saltati»: un dato vero, non un vuoto. */
  skipped: MealKind[];
  /** Colazione, pranzo e cena segnati solo come «non tracciato». */
  untracked: MealKind[];
  /** Colazione, pranzo e cena senza niente. */
  missing: MealKind[];
  text: string;
}

function list(kinds: readonly MealKind[]): string {
  const names = kinds.map((k) => MEAL_KIND_LABELS[k].toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Stato del giorno: completo se colazione, pranzo e cena sono registrati o dichiarati «saltati»; dichiarato
 * se ci sono tutti e tre ma almeno uno è solo «non tracciato»; con vuoti altrimenti. Gli spuntini non contano.
 * Un vuoto non è un digiuno: il testo non lo dice mai. Un momento «saltato» invece è un fatto che hai detto tu.
 */
export function summarizeDay(day: DiaryDay | undefined): DaySummary {
  const moments = momentsOf(day);
  const kindsWith = (status: MealMoment["status"]) => moments.filter((m) => m.status === status).map((m) => m.kind);
  const tracked = kindsWith("recorded");
  const skipped = kindsWith("skipped");
  const untracked = kindsWith("untracked");
  const missing = kindsWith("none");
  const nothing = (day?.meals.length ?? 0) + (day?.untrackedMeals.length ?? 0) + (day?.declarations.length ?? 0) === 0;

  if (missing.length === 0 && untracked.length === 0) {
    const text =
      skipped.length === 0
        ? "Giornata completa: colazione, pranzo e cena sono registrati."
        : skipped.length === 3
          ? "Giornata completa: colazione, pranzo e cena segnati come saltati."
          : `Giornata completa: ${list(tracked)} ${tracked.length === 1 ? "registrato" : "registrati"}, ${list(skipped)} ${skipped.length === 1 ? "saltato" : "saltati"}.`;
    return { status: "complete", tracked, skipped, untracked, missing, text };
  }
  if (missing.length === 0) {
    return {
      status: "declared",
      tracked,
      skipped,
      untracked,
      missing,
      text: `Giornata dichiarata: ${list(untracked)} ${untracked.length === 1 ? "è segnato" : "sono segnati"} come non tracciato. Il resto è registrato, ma il totale è incompleto.`,
    };
  }
  return {
    status: "gaps",
    tracked,
    skipped,
    untracked,
    missing,
    text: nothing
      ? "Ancora niente registrato oggi."
      : `Giornata con vuoti: mancano ${list(missing)}. Un vuoto non vuol dire che hai saltato il pasto: se è così, segnalo.`,
  };
}
