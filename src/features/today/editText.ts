// Correggere il diario di Oggi dal posto: i testi degli avvisi e le piccole regole delle righe dei momenti
// (riga compatta, voci di «Altro», momenti in cui spostare una voce, titolo degli spuntini). Funzioni pure.
import { dayBefore, type MealKind } from "@/core/diary";
import type { Quantity } from "@/core/ledger";
import type { OutOfHomeSize } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { outOfHomeSentence, type OutOfHomeChoice } from "../meals";
import { MOMENT_CHOICES } from "../pantry/eaten";
import { inSentence } from "./summaries";

/** Dove sta una voce: «80 g a cena», «1 pz nello spuntino». */
const IN_MOMENT: Record<MealKind, string> = { breakfast: "a colazione", lunch: "a pranzo", dinner: "a cena", snack: "nello spuntino" };
/** Dove va una voce spostata, con le parole che usa già la Dispensa: «Ora a cena», «Ora come spuntino». */
const TO_MOMENT: Record<MealKind, string> = { breakfast: "a colazione", lunch: "a pranzo", dinner: "a cena", snack: "come spuntino" };
/** Che cosa diventa un pasto spostato: «ora è a cena», «ora è uno spuntino». */
const MEAL_IS: Record<MealKind, string> = { breakfast: "a colazione", lunch: "a pranzo", dinner: "a cena", snack: "uno spuntino" };

/** Il giorno, solo se non è oggi: « di ieri», « di lunedì 16». */
export function dayTail(date: string, today: string): string {
  if (date === today) return "";
  if (date === dayBefore(today)) return " di ieri";
  const day = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  return ` di ${day}`;
}

/** «alle 20:30», «all'1:05». */
export const atTime = (time: string): string => (/^0?1[:.]/.test(time) ? `all'${time.replace(/^0/, "")}` : `alle ${time}`);

interface Place {
  kind: MealKind;
  /** Il giorno del pasto, `YYYY-MM-DD`. */
  date: string;
  today: string;
}

/** «Corretto: spinaci, 80 g a cena.», con la tilde se la quantità è una stima. */
export function quantityCorrectedText(args: Place & { name: string; quantity: Quantity; estimated: boolean }): string {
  const amount = `${args.estimated ? "~" : ""}${formatQuantity(args.quantity)}`;
  return `Corretto: ${inSentence(args.name)}, ${amount} ${IN_MOMENT[args.kind]}${dayTail(args.date, args.today)}.`;
}

/** «Corretto: pranzo fuori casa, abbondante (~1200 kcal, stima).»: la taglia nuova e la stima che ora vale. */
export function outOfHomeCorrectedText(args: { kind: MealKind; size: OutOfHomeSize; energyKcal: number }): string {
  return `Corretto: ${outOfHomeSentence(args.kind, args.size, args.energyKcal)}.`;
}

/** «Ora a cena: pizza»: lo stesso testo che la Dispensa dà per un alimento spostato. */
export function itemMovedText(args: Place & { name: string }): string {
  return `Ora ${TO_MOMENT[args.kind]}${dayTail(args.date, args.today)}: ${inSentence(args.name)}`;
}

/** «Tolto: 75 g di spinaci. Sono tornati in dispensa.» */
export function consumeRemovedText(name: string, quantity: Quantity): string {
  return `Tolto: ${formatQuantity(quantity)} di ${inSentence(name)}. Sono tornati in dispensa.`;
}

/** «Tolto: pizza.» */
export const itemRemovedText = (name: string): string => `Tolto: ${inSentence(name)}.`;

/** «Pasto spostato: ora è a cena, alle 20:30.»; in un altro giorno «… a cena di ieri, alle 20:30.» */
export function mealMovedText(args: Place & { time: string }): string {
  return `Pasto spostato: ora è ${MEAL_IS[args.kind]}${dayTail(args.date, args.today)}, ${atTime(args.time)}.`;
}

/** «Tolto: cena.» */
export const mealRemovedText = (title: string): string => `Tolto: ${inSentence(title)}.`;

/** Il titolo del foglio «Pasto»: «Cena, 22:40». */
export const mealSheetTitle = (title: string, time: string): string => (time === "" ? title : `${title}, ${time}`);

const MAX_NAMES = 3;

/** Gli alimenti di un pasto in una riga: «pasta, insalata, mela e altri 2». Senza ripetizioni. */
export function namesHint(names: readonly string[]): string {
  const unique = [...new Set(names.map(inSentence).filter((n) => n !== ""))];
  const more = unique.length - MAX_NAMES;
  return unique.slice(0, MAX_NAMES).join(", ") + (more === 1 ? " e un altro" : more > 1 ? ` e altri ${more}` : "");
}

/** Di un pasto, ciò che serve per sapere che cosa se ne può ripetere. */
export interface RepeatSource {
  pantryConsumes: readonly { lotId: string }[];
  items: readonly { name: string }[];
}

/**
 * I nomi di ciò che si può registrare di nuovo da un pasto: le voci libere e gli alimenti della dispensa di cui si
 * conosce ancora il nome (`lotNames`: dal lotto al nome). Vuoto se non c'è niente da ripetere.
 */
export function repeatableNames(meal: RepeatSource, lotNames: ReadonlyMap<string, string>): string[] {
  const fromPantry = meal.pantryConsumes.map((c) => (lotNames.get(c.lotId) ?? "").trim());
  return [...fromPantry, ...meal.items.map((i) => i.name.trim())].filter((n) => n !== "");
}

export interface MomentRowFacts {
  /** Si sta guardando un giorno già passato. */
  pastDay: boolean;
  /** Il momento è quello dell'ora. */
  current: boolean;
  /** Niente di segnato: né pasto né dichiarazione. */
  empty: boolean;
  drinks: number;
  loose: number;
  /** Nel piano c'è un pasto per questo momento. */
  planned: boolean;
}

/**
 * Un momento di oggi già passato e senza niente sta in una riga sola. Il momento in corso, i giorni passati e un
 * momento con una bevanda, una voce sciolta o un pasto pianificato tengono la riga intera.
 */
export function isCompactMoment(facts: MomentRowFacts): boolean {
  return !facts.pastDay && !facts.current && facts.empty && facts.drinks === 0 && facts.loose === 0 && !facts.planned;
}

export interface MomentChoice {
  id: "repeat" | "skipped" | "untracked" | OutOfHomeChoice["id"];
  label: string;
  hint?: string;
}

/**
 * Le voci di «Altro» per un momento senza pasto, nell'ordine. «Come ieri» c'è solo guardando oggi e solo se ieri in
 * quel momento c'era un pasto con qualcosa da ripetere (`yesterdayNames`). Le tre voci «Fuori casa» (`outOfHome`,
 * da `outOfHomeChoices`) vengono dopo «Come ieri» e prima di «Saltato», anche nei giorni passati; mancano finché la
 * stima non si può calcolare.
 */
export function momentChoices(args: {
  viewingToday: boolean;
  yesterdayNames: readonly string[];
  outOfHome?: readonly OutOfHomeChoice[];
}): MomentChoice[] {
  const hint = args.viewingToday ? namesHint(args.yesterdayNames) : "";
  return [
    ...(hint !== "" ? [{ id: "repeat" as const, label: "Come ieri", hint }] : []),
    ...(args.outOfHome ?? []).map((choice) => ({ id: choice.id, label: choice.label, hint: choice.hint })),
    { id: "skipped", label: "Saltato" },
    { id: "untracked", label: "Mangiato, senza dettagli" },
  ];
}

/**
 * Il titolo del quarto blocco. Un solo spuntino registrato non ne ha: basta la sua riga richiusa. Con più cose
 * (spuntini, bevande, voci sciolte) il titolo è «Spuntini»; una cosa sola che non è un pasto si chiama «Spuntino».
 */
export function snackBlockTitle(counts: { meals: number; others: number }): string | null {
  const total = counts.meals + counts.others;
  if (total <= 1 && counts.others === 0) return null;
  return total === 1 ? "Spuntino" : "Spuntini";
}

/** Un pasto tolto su un altro dispositivo a cui è rimasta almeno una voce della dispensa. */
export function revivedMealText(entries: number): string {
  return `Questo pasto era stato tolto su un altro dispositivo: ${entries === 1 ? "è rimasta questa voce" : "sono rimaste queste voci"}.`;
}

export const OTHER_VERSION_NOTE = "Questo pasto è stato corretto anche da un altro dispositivo.";
export const VERSION_KEPT_TEXT = "Tenuta la versione che vedi nel diario.";
export const OTHER_VERSION_USED_TEXT = "Ora vale l'altra versione del pasto.";

/** Prima di quest'ora (le 4 del mattino) ciò che si è mangiato può appartenere alla sera prima. */
const NIGHT_UNTIL_MINUTES = 4 * 60;

export interface MomentTarget {
  kind: MealKind;
  /** Il giorno in cui la voce va: sempre scritto, mai lasciato all'ora del consumo. */
  date: string;
  label: string;
}

/**
 * I momenti in cui si può spostare una voce. Giorno e ora sono quelli del pasto in cui sta (`date`, `minutes` dalla
 * mezzanotte), non quelli del consumo: un pasto registrato per un giorno passato ha consumi con l'ora di adesso, e
 * spostandone uno la voce deve restare nel giorno del pasto. Il momento in cui sta già (`kind`) non è tra le scelte.
 * Con `withNight`, se il pasto è di notte (prima delle 4) si offrono anche pranzo, cena e spuntino del giorno prima,
 * e l'etichetta lo dice: «Ieri · cena», o «Il giorno prima · cena» se non si sta guardando oggi.
 */
export function momentTargets(args: { date: string; minutes?: number; today: string; kind?: MealKind }, withNight: boolean): MomentTarget[] {
  const { date, minutes, today, kind } = args;
  const out: MomentTarget[] = MOMENT_CHOICES.filter((m) => m.kind !== kind).map((m) => ({ kind: m.kind, date, label: m.label }));
  if (withNight && minutes !== undefined && minutes < NIGHT_UNTIL_MINUTES) {
    const before = dayBefore(date);
    const word = date === today ? "Ieri" : "Il giorno prima";
    for (const m of MOMENT_CHOICES) if (m.kind !== "breakfast") out.push({ kind: m.kind, date: before, label: `${word} · ${m.label.toLowerCase()}` });
  }
  return out;
}
