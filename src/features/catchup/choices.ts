// «Mettiamoci in pari»: le scelte di un momento (il solito, come l'ultima volta, fuori casa, saltato, non ricordo),
// quella di partenza e la voce del piano che ne esce. Niente si prende dalla dispensa: si leggono solo nomi, quantità
// e l'alimento della tabella che dà i nutrienti di allora. Pura.
import {
  CATCHUP_NOTE,
  FOOD_ID_MAX_LENGTH,
  addDays,
  type CatchUpEntry,
  type CatchUpKind,
  type DiaryHabit,
  type MealItem,
  type MealWithPantry,
} from "@/core/diary";
import type { FoodMatcher, FoodState, IntakeResult, OutOfHomeSize } from "@/core/nutrition";
import { outOfHomeChoices, outOfHomeName, type OutOfHomeChoice } from "../meals";
import { habitLabel, namesText, repeatLabel } from "./catchupText";

/** I pasti abituali si contano sugli ultimi 30 giorni. */
export const HABIT_USE_DAYS = 30;
/** Quanti pasti abituali si propongono per momento. */
export const HABIT_CHOICES_MAX = 2;
/** «Come l'ultima volta»: si cerca nei 14 giorni prima del primo giorno vuoto. */
export const REPEAT_DAYS = 14;
/** Taglia di partenza di «Fuori casa». */
export const DEFAULT_SIZE: OutOfHomeSize = "normal";

export const OUT_OF_HOME_LABEL = "Fuori casa";
export const SKIPPED_LABEL = "Saltato";
export const UNKNOWN_LABEL = "Non ricordo";

export type CatchUpOption =
  | { id: string; type: "habit"; label: string; habit: DiaryHabit }
  | { id: "repeat"; type: "repeat"; label: string; date: string; title?: string; items: MealItem[] }
  | { id: "out"; type: "out"; label: string; sizes: OutOfHomeChoice[] }
  | { id: "skipped"; type: "skipped"; label: string }
  | { id: "unknown"; type: "unknown"; label: string };

/** Ciò che l'utente ha scelto per un momento: la scelta e, per «Fuori casa», la taglia. */
export interface CatchUpPick {
  option: string;
  size: OutOfHomeSize;
}

export interface ChoiceSources {
  /** Pasti abituali attivi (`DiaryState.habits`). */
  habits: readonly DiaryHabit[];
  /** I pasti del diario con i loro consumi (`mealsWithPantryOf`): servono solo i nomi e le quantità. */
  meals: readonly MealWithPantry[];
  /** Dal lotto al nome dell'alimento, come lo dà la dispensa. */
  lotNames: ReadonlyMap<string, string>;
  /** L'energia dei pasti registrati di quel momento (`mealEnergyHistory`); `undefined` finché non è pronta. */
  energyHistory: (kind: CatchUpKind) => readonly number[] | undefined;
  /**
   * L'alimento della tabella per un consumo della dispensa (`pantryFoodsOfConsumes`); `undefined` se non se ne conosce
   * uno che dia i nutrienti giusti (porzione di una preparazione, prodotto senza nome, nome non riconosciuto).
   */
  foodOf: (consumeId: string) => PantryFood | undefined;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Il primo giorno da recuperare. */
  firstDay: string;
}

const habitId = (h: DiaryHabit): string => `habit:${h.habitId}`;

/**
 * Fino a due pasti abituali del momento, dal più usato negli ultimi 30 giorni; a pari uso, il più usato di recente,
 * poi il più recente come definizione. Un pasto abituale senza voci non si propone: non ci sarebbe niente da scrivere.
 */
export function usualHabits(sources: Pick<ChoiceSources, "habits" | "meals" | "today">, kind: CatchUpKind): DiaryHabit[] {
  const from = addDays(sources.today, -HABIT_USE_DAYS);
  const uses = new Map<string, { count: number; lastAt: string }>();
  for (const m of sources.meals) {
    if (m.habitId === undefined || m.kind !== kind || m.date < from || m.date > sources.today) continue;
    // un pasto scritto dal recupero è una supposizione, non un uso
    if (m.note === CATCHUP_NOTE) continue;
    const cur = uses.get(m.habitId) ?? { count: 0, lastAt: "" };
    uses.set(m.habitId, { count: cur.count + 1, lastAt: m.at > cur.lastAt ? m.at : cur.lastAt });
  }
  const none = { count: 0, lastAt: "" };
  return sources.habits
    .filter((h) => h.kind === kind && h.items.length > 0)
    .map((h) => ({ h, u: uses.get(h.habitId) ?? none }))
    .sort((a, b) => b.u.count - a.u.count || cmpDesc(a.u.lastAt, b.u.lastAt) || cmpDesc(a.h.recordedAt, b.h.recordedAt) || (a.h.habitId < b.h.habitId ? -1 : 1))
    .slice(0, HABIT_CHOICES_MAX)
    .map((x) => x.h);
}

const cmpDesc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();
const UNNAMED = "Alimento senza nome";
const FOOD_ID_RE = /^[a-z0-9-]+$/;

/** L'alimento della tabella per una voce ripetuta dalla dispensa; `name` è il nome del prodotto, se va mostrato. */
export interface PantryFood {
  foodId: string;
  name?: string;
}

/** Stati in cui si conserva un alimento di dispensa: gli stessi che preferisce il calcolo per i consumi. */
const STORED_STATES: readonly FoodState[] = ["dried", "raw", "as_sold"];

const validFoodId = (id: string | undefined): id is string => id !== undefined && id.length <= FOOD_ID_MAX_LENGTH && FOOD_ID_RE.test(id);

/**
 * L'alimento della tabella per un prodotto letto dall'etichetta, cercato dal NOME del prodotto (mai dal codice a barre):
 * solo nello stato in cui si conserva (secco, crudo, come venduto), mai cotto. `undefined` se il nome manca, è
 * ambiguo o non c'è un alimento in quello stato: meglio non ripetere che scrivere la pasta secca come cotta.
 */
export function storedFoodByName(matcher: FoodMatcher, name: string): string | undefined {
  const out = matcher.find(name, { preferStates: STORED_STATES });
  if (out.status !== "match") return undefined;
  const { food, statePreference } = out.match;
  if (food.state === "cooked" || (statePreference !== undefined && !statePreference.honored)) return undefined;
  return validFoodId(food.id) ? food.id : undefined;
}

/**
 * Per ogni consumo della dispensa, l'alimento della tabella da portare nella voce ripetuta, nello stato in cui si
 * conserva (la pasta secca, non quella cotta):
 * - riga risolta dalla tabella: lo stesso alimento di allora;
 * - riga con i valori d'etichetta: una voce libera non può portarli, quindi un alimento della tabella cercato dal nome
 *   del prodotto (`storedFoodByName`), con quel nome come nome della voce. È una stima, come ogni voce ripetuta;
 * - porzione di una preparazione, prodotto senza nome, nome non riconosciuto: niente.
 */
export function pantryFoodsOfConsumes(intake: Pick<IntakeResult, "days">, matcher?: FoodMatcher): Map<string, PantryFood> {
  const out = new Map<string, PantryFood>();
  for (const day of intake.days) {
    for (const meal of day.meals) {
      for (const line of meal.lines) {
        if (line.kind !== "pantry" || line.status !== "ok") continue;
        const { origin, ref, name } = line.composition;
        if (origin === "table") {
          if (validFoodId(ref)) out.set(line.eventId, { foodId: ref });
          continue;
        }
        if (origin !== "label" || !matcher) continue;
        // senza un nome di prodotto il calcolo mostra il codice a barre: da quello non si cerca niente
        const productName = name.trim();
        if (productName === "" || productName === ref || productName === line.label || /^\d+$/.test(productName)) continue;
        const foodId = storedFoodByName(matcher, productName);
        if (foodId !== undefined) out.set(line.eventId, { foodId, name: productName });
      }
    }
  }
  return out;
}

/**
 * Le voci di un pasto già fatto, tutte libere e stimate. Un alimento preso dalla dispensa diventa una voce con il suo
 * nome, la quantità di allora e l'alimento della tabella nello stato in cui si conservava (`foodOf`): così 120 g di
 * pasta secca restano pasta secca e non diventano pasta cotta. Le confezioni dello stesso alimento si sommano
 * (stessa regola dei nomi di «Come ieri»; senza nome, «Alimento senza nome»). Le voci libere si copiano.
 * `undefined` se di un alimento della dispensa non si conosce l'alimento della tabella: ripeterlo darebbe nutrienti
 * diversi da quelli di allora, e un giorno con valori sbagliati conterebbe come completo.
 */
export function freeItemsOf(
  meal: MealWithPantry,
  lotNames: ReadonlyMap<string, string>,
  foodOf: (consumeId: string) => PantryFood | undefined,
): MealItem[] | undefined {
  const named: MealItem[] = [];
  const unnamed: MealItem[] = [];
  const add = (list: MealItem[], name: string, quantity: MealItem["quantity"], foodId: string) => {
    const same = list.find((i) => i.quantity.unit === quantity.unit && i.foodId === foodId && nameKey(i.name) === nameKey(name));
    if (same) same.quantity = { ...same.quantity, value: Math.round((same.quantity.value + quantity.value) * 1e9) / 1e9 };
    else list.push({ name, quantity: { ...quantity }, certainty: "estimated", foodId });
  };
  for (const c of meal.pantryConsumes) {
    const food = foodOf(c.id);
    if (food === undefined) return undefined;
    const name = (food.name ?? lotNames.get(c.lotId) ?? "").trim();
    if (name === "") add(unnamed, UNNAMED, c.quantity, food.foodId);
    else add(named, name, c.quantity, food.foodId);
  }
  const copied = meal.items.map((i): MealItem => ({ ...i, quantity: { ...i.quantity }, certainty: "estimated" }));
  return [...named, ...unnamed, ...copied];
}

/** L'ultimo pasto del momento nei 14 giorni prima del primo giorno vuoto, se ha qualcosa da ripetere. */
export function lastMealBefore(meals: readonly MealWithPantry[], kind: CatchUpKind, firstDay: string): MealWithPantry | undefined {
  const from = addDays(firstDay, -REPEAT_DAYS);
  let last: MealWithPantry | undefined;
  for (const m of meals) {
    if (m.kind !== kind || m.date < from || m.date >= firstDay) continue;
    if (m.items.length + m.pantryConsumes.length === 0) continue;
    if (!last || m.date > last.date || (m.date === last.date && m.at >= last.at)) last = m;
  }
  return last;
}

/** Le scelte di un momento, nell'ordine in cui si mostrano. «Fuori casa» c'è quando la stima si può fare. */
export function momentOptions(sources: ChoiceSources, kind: CatchUpKind): CatchUpOption[] {
  const out: CatchUpOption[] = usualHabits(sources, kind).map((habit) => ({ id: habitId(habit), type: "habit" as const, label: habitLabel(habit.title), habit }));
  const last = lastMealBefore(sources.meals, kind, sources.firstDay);
  const items = last ? freeItemsOf(last, sources.lotNames, sources.foodOf) : undefined;
  if (last && items) {
    const title = last.title?.trim() || undefined;
    out.push({ id: "repeat", type: "repeat", label: repeatLabel(last.date, namesText(items.map((i) => i.name))), date: last.date, ...(title ? { title } : {}), items });
  }
  const history = sources.energyHistory(kind);
  if (history !== undefined) out.push({ id: "out", type: "out", label: OUT_OF_HOME_LABEL, sizes: outOfHomeChoices(kind, history) });
  out.push({ id: "skipped", type: "skipped", label: SKIPPED_LABEL }, { id: "unknown", type: "unknown", label: UNKNOWN_LABEL });
  return out;
}

/** La scelta di partenza: il solito, altrimenti come l'ultima volta, altrimenti «Non ricordo». Mai un fatto supposto. */
export function defaultOption(options: readonly CatchUpOption[]): CatchUpOption {
  return options.find((o) => o.type === "habit") ?? options.find((o) => o.type === "repeat") ?? (options.find((o) => o.type === "unknown") as CatchUpOption);
}

/** La scelta in vigore: quella fatta, se è ancora tra le scelte; altrimenti quella di partenza. */
export function chosenOption(options: readonly CatchUpOption[], pick: CatchUpPick | undefined): CatchUpOption {
  return (pick && options.find((o) => o.id === pick.option)) || defaultOption(options);
}

/** La voce del piano per un giorno e un momento. */
export function toEntry(date: string, kind: CatchUpKind, option: CatchUpOption, size: OutOfHomeSize = DEFAULT_SIZE): CatchUpEntry {
  switch (option.type) {
    case "habit":
      return {
        date,
        kind,
        choice: {
          kind: "meal",
          title: option.habit.title,
          items: option.habit.items.map((i) => ({ ...i, quantity: { ...i.quantity }, certainty: "estimated" })),
          habitId: option.habit.habitId,
          source: "habit",
        },
      };
    case "repeat":
      return { date, kind, choice: { kind: "meal", ...(option.title ? { title: option.title } : {}), items: option.items.map((i) => ({ ...i, quantity: { ...i.quantity } })), source: "manual" } };
    case "out": {
      const sized = option.sizes.find((s) => s.size === size) ?? option.sizes.find((s) => s.size === DEFAULT_SIZE) ?? option.sizes[0];
      // la stessa voce che scrive «Fuori casa» in Oggi (`buildOutOfHomeMeal`): una stima della sola energia
      const item: MealItem = { name: outOfHomeName(sized.size), quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: sized.estimate.energyKcal };
      return { date, kind, choice: { kind: "meal", items: [item], source: "manual" } };
    }
    case "skipped":
      return { date, kind, choice: { kind: "skipped" } };
    case "unknown":
      return { date, kind, choice: { kind: "unknown" } };
  }
}

/** La scelta scrive un pasto, cioè una stima: la riga del momento lo dice. */
export const isEstimate = (option: CatchUpOption): boolean => option.type === "habit" || option.type === "repeat" || option.type === "out";

/** Il testo della scelta in una riga, con la taglia per «Fuori casa»: «Fuori casa · normale». */
export function optionText(option: CatchUpOption, size: OutOfHomeSize = DEFAULT_SIZE): string {
  return option.type === "out" ? outOfHomeName(option.sizes.some((s) => s.size === size) ? size : DEFAULT_SIZE) : option.label;
}

/**
 * Dopo una scrittura entrata solo in parte: le voci del piano e gli eventi entrati, e le voci respinte. `events` è ciò
 * che `buildCatchUpEvents` ha costruito da `entries` (un evento per voce, nello stesso ordine); `rejected` le posizioni
 * respinte dall'archivio.
 */
export function splitWritten<E>(
  entries: readonly CatchUpEntry[],
  events: readonly E[],
  rejected: readonly number[],
): { entries: CatchUpEntry[]; events: E[]; refused: CatchUpEntry[] } {
  if (entries.length !== events.length) throw new Error("Un evento per voce del piano.");
  const out = new Set(rejected);
  return {
    entries: entries.filter((_, i) => !out.has(i)),
    events: events.filter((_, i) => !out.has(i)),
    refused: entries.filter((_, i) => out.has(i)),
  };
}
