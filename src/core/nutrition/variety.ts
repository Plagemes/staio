// Varietà vegetale degli ultimi giorni e monotonia dei pasti, contate dal diario con gli alimenti
// che la tabella riconosce. Solo descrizione: nessuna soglia, nessun obiettivo. Vedi FONTI.md.

import { addDays, daysBetween } from "../diary";
import type { DayIntake, IntakeLine, MealIntake } from "./intake";
import type { FoodComposition } from "./types";

export const PLANT_GROUPS = ["vegetables", "fruit", "legumes", "wholeGrains", "nutsSeeds", "herbs"] as const;
export type PlantGroup = (typeof PLANT_GROUPS)[number];

export interface PlantKind {
  /** Chiave dell'alimento: stati diversi dello stesso alimento (secco, cotto) hanno la stessa chiave. */
  key: string;
  /** Nome mostrato, senza lo stato («Lenticchie», non «Lenticchie, cotte»). */
  name: string;
  group: PlantGroup;
}

/** Alimenti della tabella che contano come un altro alimento (stessa pianta, forma diversa). */
const SAME_AS: Readonly<Record<string, { key: string; name: string }>> = {
  "burro-di-arachidi": { key: "arachidi", name: "Arachidi" },
  hummus: { key: "ceci", name: "Ceci" },
  "tofu-crudo": { key: "soia", name: "Soia" },
  tempeh: { key: "soia", name: "Soia" },
  "pomodoro-ciliegino-crudo": { key: "pomodoro", name: "Pomodoro" },
  "pomodori-pelati": { key: "pomodoro", name: "Pomodoro" },
  "pomodori-a-pezzi": { key: "pomodoro", name: "Pomodoro" },
  "passata-di-pomodoro": { key: "pomodoro", name: "Pomodoro" },
  "concentrato-di-pomodoro": { key: "pomodoro", name: "Pomodoro" },
  "pomodori-secchi": { key: "pomodoro", name: "Pomodoro" },
  "pomodoro-crudo": { key: "pomodoro", name: "Pomodoro" },
  "cetrioli-sottaceto": { key: "cetriolo", name: "Cetriolo" },
  "cetriolo-crudo": { key: "cetriolo", name: "Cetriolo" },
  "fichi-secchi": { key: "fico", name: "Fichi" },
  "fico-crudo": { key: "fico", name: "Fichi" },
  "albicocche-secche": { key: "albicocca", name: "Albicocche" },
  "albicocca-cruda": { key: "albicocca", name: "Albicocche" },
  "prugne-secche": { key: "prugna", name: "Prugne" },
  "prugna-cruda": { key: "prugna", name: "Prugne" },
  "uvetta-sultanina": { key: "uva", name: "Uva" },
  "uva-cruda": { key: "uva", name: "Uva" },
};

/** Voci dei gruppi vegetali che l'app non conta: piatti misti e patate (scelta dell'app, vedi FONTI.md). */
const NOT_COUNTED: ReadonlySet<string> = new Set(["patata-cruda", "patata-lessa", "minestrone-in-scatola"]);

/** Cereali integrali riconosciuti, per chiave (`variantOf` o id). */
const WHOLE_GRAIN_KEYS: ReadonlySet<string> = new Set([
  "pasta-integrale",
  "riso-integrale",
  "farina-integrale",
  "pane-integrale",
  "avena-fiocchi",
  "bulgur",
  "quinoa",
  "miglio",
]);

/** Erbe aromatiche della tabella. Le spezie non sono incluse. */
const HERB_IDS: ReadonlySet<string> = new Set([
  "basilico-fresco",
  "prezzemolo-fresco",
  "rosmarino-fresco",
  "timo-fresco",
  "origano-secco",
  "alloro",
]);

const baseName = (food: FoodComposition): string => food.name.split(",")[0]!.trim();

function groupOf(food: FoodComposition, key: string): PlantGroup | undefined {
  switch (food.group) {
    case "verdura":
      return "vegetables";
    case "frutta":
      return "fruit";
    case "legumi":
      return "legumes";
    case "frutta-secca":
      return "nutsSeeds";
    case "cereali":
      return WHOLE_GRAIN_KEYS.has(key) ? "wholeGrains" : undefined;
    case "condimenti":
      return HERB_IDS.has(food.id) ? "herbs" : undefined;
    default:
      return undefined;
  }
}

/** Che vegetale è un alimento della tabella, se lo è per le regole dell'app. */
export function plantKindOf(food: FoodComposition): PlantKind | undefined {
  if (NOT_COUNTED.has(food.id)) return undefined;
  const same = SAME_AS[food.id];
  const key = same?.key ?? food.variantOf ?? food.id;
  const group = groupOf(food, key);
  if (!group) return undefined;
  return { key, name: same?.name ?? baseName(food), group };
}

/** Gruppi di alimenti di base (olio, condimenti, bevande): non contano nella monotonia dei pasti. */
const STAPLE_GROUPS: ReadonlySet<string> = new Set(["oli-e-grassi", "condimenti", "bevande"]);

export interface PlantEntry {
  key: string;
  name: string;
  /** In quanti giorni diversi della finestra è stato mangiato. */
  days: number;
}

export interface VarietyWindow {
  from: string;
  to: string;
  /** Giorni della finestra con almeno una voce registrata. Un giorno senza dati non conta come niente mangiato. */
  daysWithData: number;
  /** Quanti di quei giorni sono completi secondo le regole della nutrizione. */
  completeDays: number;
  /** Vegetali diversi riconosciuti nella finestra. Con dati parziali è un minimo. */
  count: number;
  byGroup: Record<PlantGroup, PlantEntry[]>;
  /** Voci con dati che l'app non ha saputo riconoscere come alimento della tabella (prodotti, preparazioni) o senza dati. */
  unrecognizedLines: number;
  /** Il conteggio è un minimo: giorni incompleti o voci non riconosciute. */
  partial: boolean;
}

export interface AbsentGroup {
  group: PlantGroup;
  /** Giorni dall'ultimo registrato; assente se nei dati non c'è mai stato. */
  daysSince?: number;
}

export interface Monotony {
  key: string;
  name: string;
  /** Pasti della finestra in cui compare. */
  meals: number;
  /** Pasti registrati nella finestra. */
  totalMeals: number;
}

export interface VarietyReport {
  current: VarietyWindow;
  previous: VarietyWindow;
  /** Gruppi senza alcun alimento negli ultimi 7 giorni, dal più lontano. Solo se c'è almeno un giorno con dati. */
  absent: AbsentGroup[];
  /** Alimenti presenti in più di metà dei pasti registrati (con almeno `MIN_MEALS_FOR_MONOTONY` pasti). */
  monotony: Monotony[];
}

export const VARIETY_DAYS = 7;
/** Sotto questo numero di pasti la «metà dei pasti» non dice niente: un solo pasto sarebbe sempre al 100%. */
export const MIN_MEALS_FOR_MONOTONY = 4;

export type FoodLookup = ReadonlyMap<string, FoodComposition>;

export function foodLookup(foods: Iterable<FoodComposition>): FoodLookup {
  return new Map([...foods].map((f) => [f.id, f]));
}

function allLines(day: DayIntake): IntakeLine[] {
  return [...day.meals.flatMap((m) => m.lines), ...day.standalone];
}

/** L'alimento della tabella a cui una riga è stata associata. Prodotti e preparazioni non lo sono. */
function foodOfLine(line: IntakeLine, foods: FoodLookup): FoodComposition | undefined {
  if (line.status !== "ok" || line.composition.ref === undefined) return undefined;
  return foods.get(line.composition.ref);
}

function emptyGroups(): Record<PlantGroup, PlantEntry[]> {
  return { vegetables: [], fruit: [], legumes: [], wholeGrains: [], nutsSeeds: [], herbs: [] };
}

function windowOf(days: readonly DayIntake[], foods: FoodLookup, from: string, to: string): VarietyWindow {
  const inside = days.filter((d) => d.date >= from && d.date <= to && allLines(d).length + d.drinks.length > 0);
  const seen = new Map<string, { kind: PlantKind; dates: Set<string> }>();
  let unrecognized = 0;
  for (const day of inside) {
    for (const line of allLines(day)) {
      const food = foodOfLine(line, foods);
      if (!food) {
        unrecognized++;
        continue;
      }
      const kind = plantKindOf(food);
      if (!kind) continue;
      const entry = seen.get(kind.key) ?? { kind, dates: new Set<string>() };
      entry.dates.add(day.date);
      seen.set(kind.key, entry);
    }
  }
  const byGroup = emptyGroups();
  for (const { kind, dates } of seen.values()) {
    byGroup[kind.group].push({ key: kind.key, name: kind.name, days: dates.size });
  }
  for (const g of PLANT_GROUPS) {
    byGroup[g].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "it"));
  }
  const completeDays = inside.filter((d) => d.complete).length;
  return {
    from,
    to,
    daysWithData: inside.length,
    completeDays,
    count: seen.size,
    byGroup,
    unrecognizedLines: unrecognized,
    partial: completeDays < inside.length || unrecognized > 0,
  };
}

function monotonyOf(days: readonly DayIntake[], foods: FoodLookup, from: string, to: string): Monotony[] {
  const meals: MealIntake[] = days
    .filter((d) => d.date >= from && d.date <= to)
    .flatMap((d) => d.meals)
    .filter((m) => m.lines.length > 0);
  if (meals.length < MIN_MEALS_FOR_MONOTONY) return [];
  const counts = new Map<string, { name: string; meals: number }>();
  for (const meal of meals) {
    const inMeal = new Map<string, string>();
    for (const line of meal.lines) {
      const food = foodOfLine(line, foods);
      if (!food || STAPLE_GROUPS.has(food.group)) continue;
      const plant = plantKindOf(food);
      const key = plant?.key ?? food.variantOf ?? food.id;
      inMeal.set(key, plant?.name ?? baseName(food));
    }
    for (const [key, name] of inMeal) {
      const c = counts.get(key) ?? { name, meals: 0 };
      c.meals++;
      counts.set(key, c);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c.meals * 2 > meals.length)
    .map(([key, c]) => ({ key, name: c.name, meals: c.meals, totalMeals: meals.length }))
    .sort((a, b) => b.meals - a.meals || a.name.localeCompare(b.name, "it"));
}

/**
 * Varietà vegetale degli ultimi 7 giorni (fino a `today` compreso) e della settimana prima.
 * - Conta alimenti diversi della tabella, non voci: «pasta integrale» secca e cotta è un alimento.
 * - Un giorno senza dati non è un giorno senza vegetali: i giorni con dati sono dichiarati e un
 *   conteggio su giorni incompleti o con voci non riconosciute è un minimo (`partial`).
 * - I gruppi assenti si cercano in tutta la storia passata ricevuta.
 */
export function analyzeVariety(days: readonly DayIntake[], foods: FoodLookup, today: string): VarietyReport {
  const from = addDays(today, -(VARIETY_DAYS - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(VARIETY_DAYS - 1));
  const current = windowOf(days, foods, from, today);
  const previous = windowOf(days, foods, prevFrom, prevTo);

  const last = new Map<PlantGroup, string>();
  for (const day of days) {
    if (day.date > today) continue;
    for (const line of allLines(day)) {
      const food = foodOfLine(line, foods);
      const kind = food ? plantKindOf(food) : undefined;
      if (kind && (last.get(kind.group) ?? "") < day.date) last.set(kind.group, day.date);
    }
  }
  const absent: AbsentGroup[] =
    current.daysWithData === 0
      ? []
      : PLANT_GROUPS.filter((g) => current.byGroup[g].length === 0).map((group) => {
          const date = last.get(group);
          return date === undefined ? { group } : { group, daysSince: daysBetween(date, today) };
        });
  absent.sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));

  return { current, previous, absent, monotony: monotonyOf(days, foods, from, today) };
}
