"use client";

// La qualità di ciò che mangi per le schermate: quadri delle settimane, consigli, segni delle righe di Oggi. Come
// `features/nutrition/useNutrition.ts`, il calcolo sta in memoria a livello di modulo: si rifà solo quando cambia
// un ingresso (registro, tabella, prodotti, correzioni, livello, giorno di oggi), una volta per tutte le schermate.
// Il classificatore resta lo stesso finché tabella, prodotti, correzioni e preparazioni restano gli stessi: dopo una
// scrittura si classificano solo le voci nuove. Il lotto di ogni consumo viene da `Lot.history`.
import { useMemo } from "react";
import type { ConfirmationMap } from "@/core/allergens";
import { DISMISSED_SETTING_KEY, normalizeDismissed } from "@/core/briefing";
import type { Product } from "@/core/catalog";
import type { AdherenceOptions, LotRef } from "@/core/plan";
import {
  PORTIONS,
  buildAdvice,
  buildDietHistory,
  computeOutcomes,
  createClassifier,
  lotsByConsume,
  mondayOf,
  plannedDiet,
  recipeDietFacts,
  type Advice,
  type AdviceOutcome,
  type AdviceResult,
  type ClassOverrides,
  type Classifier,
  type ClassifierSources,
  type DietGroup,
  type DietHistory,
  type EnergyLevel,
  type LineClass,
  type PlannedDiet,
  type PrepForDiet,
  type RecipeDietFacts,
} from "@/core/diet";
import type { AnyEvent } from "@/core/events";
import { activeLots, type Lot, type PantryState } from "@/core/ledger";
import type { CompositionResolver, DayIntake, FoodComposition, IntakeResult } from "@/core/nutrition";
import type { PrepRecord } from "@/core/prep";
import type { Recipe } from "@/core/recipes";
import { derivedOf, useEventLog, useSetting as useStoredSetting } from "@/data";
import { declaredLists, useDietDeclarations } from "../allergens";
import { dayOf } from "../format";
import { buildResolverWithInfo, barcodesOfLots, type FoodOverrides } from "../nutrition/resolver";
import { useIntake, useProducts } from "../nutrition/useNutrition";
import { makeExpand } from "../plan/expand";
import { buildCandidates } from "../quality/candidates";
import { makeLinkOf, pantryFoods as linkFoods, type LinkOf } from "../recipes/allergenLinks";
import { useConfirmations } from "../recipes/useConfirmations";
import { SETTING_KEYS, isManualList } from "../shopping/settings";
import { useNow } from "../useNow";
import {
  dietGaps,
  knownAlternatives,
  knownRecipes,
  lineMarkOf,
  pantryFoods,
  plannedEntriesFrom,
  prepsForDiet,
  recentProductShares,
  shoppingNames,
  type LineMark,
} from "./inputs";
import { LEVEL_KEY, levelOf, saveDietLevel } from "./level";
import { CLASS_OVERRIDES_KEY, normalizeClassOverrides } from "./overrides";

// ---------------------------------------------------------------------------------------------- classificatore

const foodsMaps = new WeakMap<readonly FoodComposition[], ReadonlyMap<string, FoodComposition>>();

function foodsMapOf(foods: readonly FoodComposition[]): ReadonlyMap<string, FoodComposition> {
  let map = foodsMaps.get(foods);
  if (!map) {
    map = new Map(foods.map((f) => [f.id, f]));
    foodsMaps.set(foods, map);
  }
  return map;
}

const consumeMaps = new WeakMap<PantryState, ReadonlyMap<string, Lot>>();
const lotMaps = new WeakMap<PantryState, ReadonlyMap<string, Lot>>();
const prepMaps = new WeakMap<readonly PrepRecord[], ReadonlyMap<string, PrepForDiet>>();

/** Consumo → lotto: una volta per stato della dispensa (O(consumi)). */
function consumeMapOf(pantry: PantryState): ReadonlyMap<string, Lot> {
  let map = consumeMaps.get(pantry);
  if (!map) {
    map = lotsByConsume(pantry.lots);
    consumeMaps.set(pantry, map);
  }
  return map;
}

function lotMapOf(pantry: PantryState): ReadonlyMap<string, Lot> {
  let map = lotMaps.get(pantry);
  if (!map) {
    map = new Map(pantry.lots.map((l) => [l.lotId, l]));
    lotMaps.set(pantry, map);
  }
  return map;
}

function prepMapOf(preps: readonly PrepRecord[]): ReadonlyMap<string, PrepForDiet> {
  let map = prepMaps.get(preps);
  if (!map) {
    map = prepsForDiet(preps);
    prepMaps.set(preps, map);
  }
  return map;
}

/**
 * Ciò che il classificatore ricorda delle preparazioni (le parti di un lotto di porzioni, l'elenco per `prepId`) dipende
 * dalle preparazioni e dai lotti dei loro ingredienti: se cambiano, serve un classificatore nuovo.
 */
function prepsKeyOf(preps: ReadonlyMap<string, PrepForDiet>, lots: ReadonlyMap<string, Lot>): string {
  const rows: unknown[] = [];
  for (const p of preps.values()) {
    rows.push([
      p.prepId,
      p.batchLotId,
      p.portions,
      p.ingredients.map((i) => {
        const lot = lots.get(i.lotId);
        return [i.lotId, i.productRef, i.quantity.value, i.quantity.unit, lot?.productRef, lot?.barcode, lot?.category];
      }),
    ]);
  }
  return JSON.stringify(rows);
}

/** Lo stato del registro che il classificatore legge al momento: cambia a ogni scrittura, il classificatore no. */
interface Holder {
  byConsume: ReadonlyMap<string, Lot>;
  lots: ReadonlyMap<string, Lot>;
  preps: ReadonlyMap<string, PrepForDiet>;
}

interface ClassifierEntry {
  foods: readonly FoodComposition[];
  products: ReadonlyMap<string, Product>;
  classOverridesKey: string;
  foodOverridesKey: string;
  prepsKey: string;
  holder: Holder;
  classifier: Classifier;
}

let lastClassifier: ClassifierEntry | undefined;
let classifierBuilds = 0;

/** Quante volte si è costruito un classificatore nuovo (per i test della memoria). */
export const classifierBuildCount = (): number => classifierBuilds;

interface ClassifierArgs {
  foods: readonly FoodComposition[];
  products: ReadonlyMap<string, Product>;
  foodOverrides: FoodOverrides;
  classOverrides: ClassOverrides;
  pantry: PantryState;
  preps: readonly PrepRecord[];
}

function classifierFor(args: ClassifierArgs): Classifier {
  const lots = lotMapOf(args.pantry);
  const preps = prepMapOf(args.preps);
  const holder: Holder = { byConsume: consumeMapOf(args.pantry), lots, preps };
  const classOverridesKey = JSON.stringify(args.classOverrides);
  const foodOverridesKey = JSON.stringify(args.foodOverrides);
  const prepsKey = prepsKeyOf(preps, lots);
  const last = lastClassifier;
  if (
    last !== undefined &&
    last.foods === args.foods &&
    last.products === args.products &&
    last.classOverridesKey === classOverridesKey &&
    last.foodOverridesKey === foodOverridesKey &&
    last.prepsKey === prepsKey
  ) {
    // stesso classificatore: legge la dispensa di adesso
    last.holder.byConsume = holder.byConsume;
    last.holder.lots = holder.lots;
    last.holder.preps = holder.preps;
    return last.classifier;
  }
  const foods = foodsMapOf(args.foods);
  // il risolutore di `intakeFor` (preparazioni, prodotto, scelte manuali, tabella), solo per gli ingredienti delle
  // preparazioni: si costruisce alla prima domanda
  let built: CompositionResolver | undefined;
  const resolve: CompositionResolver = (subject) => {
    built ??= buildResolverWithInfo({
      foods: args.foods,
      products: args.products,
      barcodes: barcodesOfLots([...holder.lots.values()]),
      overrides: args.foodOverrides,
      preps: new Map(args.preps.map((p) => [p.batchLotId, p])),
    }).resolve;
    return built(subject);
  };
  const sources: ClassifierSources = {
    foods,
    products: args.products,
    overrides: args.classOverrides,
    lotOfConsume: (id) => holder.byConsume.get(id),
    get lots() {
      return holder.lots;
    },
    get preps() {
      return holder.preps;
    },
    resolve,
  };
  classifierBuilds++;
  const classifier = createClassifier(sources);
  lastClassifier = { foods: args.foods, products: args.products, classOverridesKey, foodOverridesKey, prepsKey, holder, classifier };
  return classifier;
}

// ---------------------------------------------------------------------------------------------- quadri

export interface DietInputs {
  intake: IntakeResult;
  /** Il registro intero: dispensa e preparazioni vengono da `derivedOf(events)`, già calcolate per quello stato. */
  events: readonly AnyEvent[];
  foods: readonly FoodComposition[];
  products: ReadonlyMap<string, Product>;
  foodOverrides: FoodOverrides;
  classOverrides: ClassOverrides;
  level: EnergyLevel;
  /** Giorno di oggi `YYYY-MM-DD`: il tempo entra solo così, non con i minuti. */
  today: string;
  /** Data da cui riempire `daily` per le associazioni (fino a 90 giorni). */
  dailyFrom?: string;
}

export interface DayMarks {
  classOf: ReadonlyMap<string, LineClass>;
  markOf: ReadonlyMap<string, LineMark>;
}

export interface DietOutput {
  history: DietHistory;
  /** Il classificatore, con la memoria dei giorni già classificati in questo stato. */
  classifier: Classifier;
  /** Classi e segni delle righe di un giorno, una mappa per giorno. */
  dayMarks(date: string): DayMarks;
}

interface DietEntry {
  inputs: DietInputs;
  keys: { classOverrides: string; foodOverrides: string };
  output: DietOutput;
}

/** Al massimo due calcoli ricordati: quello delle schermate e quello dell'analisi (con `dailyFrom`). */
const lastDiet = new Map<string, DietEntry>();

const NO_MARKS: DayMarks = { classOf: new Map(), markOf: new Map() };

/** Primo indice con `date >= wanted` (i giorni di `computeIntake` sono in ordine di data). */
function dayAt(days: readonly DayIntake[], wanted: string): DayIntake | undefined {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date < wanted) lo = mid + 1;
    else hi = mid;
  }
  const day = days[lo];
  return day?.date === wanted ? day : days.find((d) => d.date === wanted);
}

function makeOutput(inputs: DietInputs, base: Classifier): DietOutput {
  // i giorni classificati valgono per questo stato: il quadro e le righe di Oggi non li rifanno
  const byDay = new WeakMap<DayIntake, LineClass[]>();
  const classifier: Classifier = {
    line: base.line,
    drink: base.drink,
    name: base.name,
    day: (d) => {
      let lines = byDay.get(d);
      if (!lines) {
        lines = base.day(d);
        byDay.set(d, lines);
      }
      return lines;
    },
  };
  const history = buildDietHistory({
    days: inputs.intake.days,
    today: inputs.today,
    classifier,
    level: inputs.level,
    foods: foodsMapOf(inputs.foods),
    ...(inputs.dailyFrom ? { dailyFrom: inputs.dailyFrom } : {}),
  });
  const marks = new Map<string, DayMarks>();
  return {
    history,
    classifier,
    dayMarks(date) {
      let m = marks.get(date);
      if (!m) {
        const day = dayAt(inputs.intake.days, date);
        if (!day) return NO_MARKS;
        const classOf = new Map<string, LineClass>();
        const markOf = new Map<string, LineMark>();
        for (const c of classifier.day(day)) {
          classOf.set(c.lineKey, c);
          const mark = lineMarkOf(c);
          if (mark) markOf.set(c.lineKey, mark);
        }
        m = { classOf, markOf };
        marks.set(date, m);
      }
      return m;
    },
  };
}

/**
 * I quadri delle settimane dal registro intero. Ricorda l'ultimo calcolo: con gli stessi ingressi (stessi intake,
 * registro, tabella e prodotti; per le correzioni conta il contenuto; stesso livello e giorno) restituisce lo stesso
 * risultato. Il risultato è condiviso: non si modifica.
 */
export function dietFor(inputs: DietInputs): DietOutput {
  const slot = inputs.dailyFrom ?? "";
  const keys = { classOverrides: JSON.stringify(inputs.classOverrides), foodOverrides: JSON.stringify(inputs.foodOverrides) };
  const last = lastDiet.get(slot);
  if (
    last !== undefined &&
    last.inputs.intake === inputs.intake &&
    last.inputs.events === inputs.events &&
    last.inputs.foods === inputs.foods &&
    last.inputs.products === inputs.products &&
    last.inputs.level === inputs.level &&
    last.inputs.today === inputs.today &&
    last.keys.classOverrides === keys.classOverrides &&
    last.keys.foodOverrides === keys.foodOverrides
  ) {
    return last.output;
  }
  const derived = derivedOf(inputs.events);
  const classifier = classifierFor({
    foods: inputs.foods,
    products: inputs.products,
    foodOverrides: inputs.foodOverrides,
    classOverrides: inputs.classOverrides,
    pantry: derived.pantry,
    preps: derived.preps.preps,
  });
  const output = makeOutput(inputs, classifier);
  if (slot === "") lastDiet.set(slot, { inputs, keys, output });
  else {
    // un solo calcolo esteso alla volta, oltre a quello delle schermate
    for (const k of [...lastDiet.keys()]) if (k !== "") lastDiet.delete(k);
    lastDiet.set(slot, { inputs, keys, output });
  }
  return output;
}

// ---------------------------------------------------------------------------------------------- consigli

export interface AdviceInputs {
  diet: DietOutput;
  intake: IntakeResult;
  events: readonly AnyEvent[];
  products: ReadonlyMap<string, Product>;
  level: EnergyLevel;
  today: string;
  /** Istante per le scadenze della dispensa; conta solo il giorno (`today`) per la memoria. */
  now: string;
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  /** Falso se un posto delle dichiarazioni non si legge: nessuna alternativa si propone (`productIsClear`). */
  declaredComplete: boolean;
  confirmations?: ConfirmationMap;
  /** Voci della lista della spesa scritte a mano. */
  manual: readonly { product: string }[];
  /** Chiavi lasciate così (`briefing.dismissed`). */
  dismissed: readonly string[];
}

export interface DietAdviceOutput {
  result: AdviceResult;
  outcomes: AdviceOutcome[];
  /** Porzioni che mancano nella settimana in corso, per gruppo, tolto ciò che è già nel piano da oggi. */
  gaps: Partial<Record<DietGroup, number>>;
  /** Ciò che il piano porta da oggi alla fine della settimana. */
  planned: PlannedDiet;
  /** I gruppi di una porzione di ogni ricetta, per `recipeId`. */
  recipeFacts: ReadonlyMap<string, RecipeDietFacts>;
}

let lastAdvice: { inputs: AdviceInputs; key: string; output: DietAdviceOutput } | undefined;
let factsMemo: { classifier: Classifier; byEvent: Map<string, RecipeDietFacts> } | undefined;
const outcomesMemo = new WeakMap<DietHistory, AdviceOutcome[]>();
const confirmationsKeys = new WeakMap<ConfirmationMap, string>();

/**
 * Il contenuto delle conferme, non la mappa: ogni istanza di `useConfirmations` ne crea una nuova dallo stesso registro,
 * e confrontarle per identità farebbe rifare i consigli a ogni consumatore del gancio.
 */
function confirmationsKey(confirmations: ConfirmationMap | undefined): string {
  if (!confirmations) return "";
  let key = confirmationsKeys.get(confirmations);
  if (key === undefined) {
    key = JSON.stringify([...confirmations.values()].map((c) => [c.key, c.eventIds, c.confirmedAt, c.allergens, c.excludedFoods]).sort());
    confirmationsKeys.set(confirmations, key);
  }
  return key;
}

/** I gruppi di una ricetta, ricordati per `Recipe.eventId` finché il classificatore è lo stesso. */
function factsOfRecipe(classifier: Classifier): (r: Recipe) => RecipeDietFacts {
  if (factsMemo?.classifier !== classifier) factsMemo = { classifier, byEvent: new Map() };
  const byEvent = factsMemo.byEvent;
  return (r) => {
    let f = byEvent.get(r.eventId);
    if (!f) {
      f = recipeDietFacts(r, classifier, PORTIONS);
      byEvent.set(r.eventId, f);
    }
    return f;
  };
}

function outcomesOf(history: DietHistory): AdviceOutcome[] {
  let o = outcomesMemo.get(history);
  if (!o) {
    o = computeOutcomes(history);
    outcomesMemo.set(history, o);
  }
  return o;
}

/** I consigli della settimana, con la stessa memoria dei quadri: si rifanno solo se cambia un ingresso. */
export function adviceFor(inputs: AdviceInputs): DietAdviceOutput {
  const key = JSON.stringify([
    inputs.declared,
    inputs.declaredComplete,
    confirmationsKey(inputs.confirmations),
    inputs.manual.map((m) => m.product),
    inputs.dismissed,
    inputs.level,
    inputs.today,
  ]);
  const last = lastAdvice;
  if (
    last !== undefined &&
    last.key === key &&
    last.inputs.diet === inputs.diet &&
    last.inputs.intake === inputs.intake &&
    last.inputs.events === inputs.events &&
    last.inputs.products === inputs.products
  ) {
    return last.output;
  }
  const { diet, today } = inputs;
  const history = diet.history;
  const derived = derivedOf(inputs.events);
  const allLots = derived.pantry.lots;
  const lots = activeLots(derived.pantry);
  const preps = prepMapOf(derived.preps.preps);
  const recipes = derived.recipes.recipes;
  const factsOf = factsOfRecipe(diet.classifier);
  const recipeFacts = new Map(recipes.map((r) => [r.recipeId, factsOf(r)]));
  const linkOf: LinkOf = makeLinkOf(linkFoods(lots, inputs.products));

  const weekStart = mondayOf(today);
  // le voci di oggi già mangiate non si contano due volte: il diario le ha già nel quadro
  const lotRefs = new Map<string, LotRef>(allLots.map((l) => [l.lotId, { productRef: l.productRef }]));
  for (const p of derived.preps.preps) lotRefs.set(p.batchLotId, { productRef: p.title, prepId: p.prepId });
  const adherence: AdherenceOptions = { events: inputs.events, lots: lotRefs, expand: makeExpand({ recipes, preps: derived.preps.preps }) };
  const planned = plannedDiet(plannedEntriesFrom(derived.plan, weekStart, today, { diary: derived.diary, adherence }), {
    recipes: recipeFacts,
    preps,
    classifier: diet.classifier,
    portions: PORTIONS,
    weekStart,
  });

  const result = buildAdvice({
    today,
    history,
    pantry: pantryFoods(lots, diet.classifier, inputs.now, { preps }),
    recipes: knownRecipes({
      recipes,
      declared: inputs.declared,
      ...(inputs.confirmations ? { confirmations: inputs.confirmations } : {}),
      linkOf,
      classifier: diet.classifier,
      lots,
      factsOf,
    }),
    alternatives: knownAlternatives(buildCandidates(inputs.products.values(), allLots), recentProductShares(inputs.intake.days, today), {
      declared: inputs.declared,
      complete: inputs.declaredComplete,
    }),
    planned,
    shoppingNames: shoppingNames(inputs.manual),
    dismissed: inputs.dismissed,
  });
  const output: DietAdviceOutput = {
    result,
    outcomes: outcomesOf(history),
    gaps: dietGaps(history, planned, inputs.level),
    planned,
    recipeFacts,
  };
  lastAdvice = { inputs, key, output };
  return output;
}

// ---------------------------------------------------------------------------------------------- ganci

const NO_EVENTS: readonly AnyEvent[] = [];

/** Le correzioni di classificazione dell'utente (`quality.classOverrides`). */
export function useClassOverrides(): { overrides: ClassOverrides; ready: boolean } {
  const live = useStoredSetting<unknown>(CLASS_OVERRIDES_KEY);
  const overrides = useMemo(() => normalizeClassOverrides(live.data), [live.data]);
  return { overrides, ready: !live.loading };
}

/** Il livello energetico di esempio (predefinito 2000 kcal) e come cambiarlo, con «Annulla». */
export function useDietLevel(): { level: EnergyLevel; ready: boolean; save: (level: EnergyLevel) => Promise<{ undo(): Promise<void> }> } {
  const live = useStoredSetting<unknown>(LEVEL_KEY);
  return { level: levelOf(live.data), ready: !live.loading, save: saveDietLevel };
}

interface DietData {
  ready: boolean;
  error: boolean;
  today: string | null;
  now: string | null;
  output?: DietOutput;
  intake?: IntakeResult;
  events: readonly AnyEvent[];
  products?: ReadonlyMap<string, Product>;
  level: EnergyLevel;
}

function useDietData(dailyFrom?: string): DietData {
  const nutrition = useIntake();
  const log = useEventLog();
  const products = useProducts();
  const { overrides: classOverrides, ready: overridesReady } = useClassOverrides();
  const { level, ready: levelReady } = useDietLevel();
  const now = useNow();
  const today = now ? dayOf(now) : null;
  const { intake, foods } = nutrition;
  const events = log.data;

  const output = useMemo(() => {
    if (!intake || !foods || !products || !events || !today || !overridesReady || !levelReady) return undefined;
    return dietFor({
      intake,
      events,
      foods,
      products,
      foodOverrides: nutrition.overrides,
      classOverrides,
      level,
      today,
      ...(dailyFrom ? { dailyFrom } : {}),
    });
  }, [intake, foods, products, events, today, overridesReady, levelReady, nutrition.overrides, classOverrides, level, dailyFrom]);

  return {
    ready: output !== undefined,
    error: nutrition.error || Boolean(log.error),
    today,
    now,
    ...(output ? { output } : {}),
    ...(intake ? { intake } : {}),
    events: events ?? NO_EVENTS,
    ...(products ? { products } : {}),
    level,
  };
}

/** I quadri delle settimane (8 chiuse più quella in corso). `dailyFrom` estende `daily` per l'analisi. */
export function useDietHistory(options: { dailyFrom?: string } = {}): { ready: boolean; error: boolean; history?: DietHistory } {
  const data = useDietData(options.dailyFrom);
  return { ready: data.ready, error: data.error, ...(data.output ? { history: data.output.history } : {}) };
}

const NO_ADVICE: Advice[] = [];
const NO_OUTCOMES: AdviceOutcome[] = [];
const NO_MANUAL: readonly { product: string }[] = [];

export interface DietAdviceView {
  ready: boolean;
  error: boolean;
  /** Al massimo 3, per priorità. */
  advice: Advice[];
  /** Settimane passate: confronti, non consigli visti. */
  outcomes: AdviceOutcome[];
  history?: DietHistory;
  today: string | null;
  gaps: Partial<Record<DietGroup, number>>;
  planned?: PlannedDiet;
  recipeFacts?: ReadonlyMap<string, RecipeDietFacts>;
}

/** I consigli della settimana, con le azioni pratiche, e gli esiti delle settimane passate. */
export function useDietAdvice(): DietAdviceView {
  const data = useDietData();
  const diet = useDietDeclarations();
  const { byKey: confirmations } = useConfirmations();
  const manualLive = useStoredSetting<unknown>(SETTING_KEYS.manual);
  const dismissedLive = useStoredSetting<unknown>(DISMISSED_SETTING_KEY);
  const declared = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  const manual = isManualList(manualLive.data) ? manualLive.data : NO_MANUAL;
  const dismissed = useMemo(() => normalizeDismissed(dismissedLive.data), [dismissedLive.data]);

  const { output, intake, products, today, now, level, events } = data;
  const advice = useMemo(() => {
    if (!output || !intake || !products || !today || !now || !declared || manualLive.loading || dismissedLive.loading) return undefined;
    return adviceFor({
      diet: output,
      intake,
      events,
      products,
      level,
      today,
      now,
      declared,
      declaredComplete: diet.state?.complete !== false,
      ...(confirmations ? { confirmations } : {}),
      manual,
      dismissed,
    });
  }, [output, intake, products, today, now, level, events, declared, diet.state?.complete, confirmations, manual, dismissed, manualLive.loading, dismissedLive.loading]);

  return {
    ready: advice !== undefined,
    error: data.error || diet.error !== undefined,
    advice: advice?.result.advice ?? NO_ADVICE,
    outcomes: advice?.outcomes ?? NO_OUTCOMES,
    ...(output ? { history: output.history } : {}),
    today,
    gaps: advice?.gaps ?? {},
    ...(advice ? { planned: advice.planned, recipeFacts: advice.recipeFacts } : {}),
  };
}

export interface LineMarksView {
  ready: boolean;
  /** Il segno della riga (solo per ciò che è molto lavorato). O(1). */
  markOf(lineKey: string): LineMark | undefined;
  /** Gruppo, lavorazione e origine della classificazione della riga. O(1). */
  classOf(lineKey: string): LineClass | undefined;
}

/** Segni e classi delle righe di un giorno di Oggi: una mappa per giorno, nessun calcolo per riga. */
export function useLineMarks(date: string): LineMarksView {
  const data = useDietData();
  const output = data.output;
  return useMemo(() => {
    const marks = output ? output.dayMarks(date) : NO_MARKS;
    return {
      ready: output !== undefined,
      markOf: (lineKey: string) => marks.markOf.get(lineKey),
      classOf: (lineKey: string) => marks.classOf.get(lineKey),
    };
  }, [output, date]);
}
