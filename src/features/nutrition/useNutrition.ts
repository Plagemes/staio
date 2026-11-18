"use client";

// Dati della nutrizione per le schermate. La tabella degli alimenti e i riferimenti si caricano solo qui,
// con un import dinamico: le pagine che non li usano non li scaricano. Il calcolo si rifà solo quando
// cambiano gli eventi, i prodotti o le scelte manuali, non a ogni disegno, e una volta sola per tutte le
// schermate che lo chiedono insieme.
import { liveQuery } from "dexie";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Product } from "@/core/catalog";
import type { AnyEvent } from "@/core/events";
import type { CompositionResolver, FoodComposition, IntakeResult, IntakeSubject, ReferenceWithVariant, ResolverResult } from "@/core/nutrition";
import { computeIntake } from "@/core/nutrition";
import type { PrepState } from "@/core/prep";
import {
  LOADING_VALUE,
  createSharedValue,
  derivedOf,
  freezeShared,
  listProductRecords,
  useEventLog,
  usePreps,
  type ProductRecord,
  type SharedSnapshot,
  type SharedValue,
} from "@/data";
import { setSetting, useSetting } from "../localSettings";
import { PROFILE_SETTING_KEY, isNutritionProfile, type NutritionProfile } from "./profile";
import { markPrepPartials } from "./prepare";
import type { PrepPortionInfo } from "./prepPortion";
import { OVERRIDES_SETTING_KEY, buildResolverWithInfo, isFoodOverrides, barcodesOfLots, type FoodOverrides } from "./resolver";

let foodsPromise: Promise<readonly FoodComposition[]> | undefined;
let referencesPromise: Promise<readonly ReferenceWithVariant[]> | undefined;

export function loadFoods(): Promise<readonly FoodComposition[]> {
  foodsPromise ??= import("@/core/nutrition/data/foods").then((m) => m.FOODS);
  return foodsPromise;
}

export function loadReferences(): Promise<readonly ReferenceWithVariant[]> {
  // i dati portano `variant` anche dove il tipo esportato non lo dichiara
  referencesPromise ??= import("@/core/nutrition/data/reference").then((m) => m.REFERENCE_VALUES as readonly ReferenceWithVariant[]);
  return referencesPromise;
}

function useLoaded<T>(load: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T | undefined>();
  useEffect(() => {
    let alive = true;
    load().then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, [load]);
  return value;
}

export const useFoods = () => useLoaded(loadFoods);
export const useReferences = () => useLoaded(loadReferences);

type ProductsByBarcode = ReadonlyMap<string, Product>;

function productsByBarcode(records: readonly ProductRecord[]): ProductsByBarcode {
  const map = new Map<string, Product>();
  for (const r of records) {
    const p = r.data as Partial<Product> | null;
    if (p && typeof p.barcode === "string") map.set(r.barcode, p as Product);
  }
  return map;
}

const NO_PRODUCTS: ProductsByBarcode = new Map();

let productsStore: SharedValue<ProductsByBarcode> | undefined;

/** Una sola osservazione dei prodotti per tutta l'app: la stessa mappa per tutti finché l'archivio non cambia. */
function sharedProducts(): SharedValue<ProductsByBarcode> {
  productsStore ??= createSharedValue(() => liveQuery(() => listProductRecords()), productsByBarcode);
  return productsStore;
}

const subscribeToProducts = (listener: () => void) => sharedProducts().subscribe(listener);
const productsSnapshot = () => sharedProducts().getSnapshot();
const loadingProducts = (): SharedSnapshot<ProductsByBarcode> => LOADING_VALUE;

/** Prodotti letti dal codice a barre, per codice. La mappa è condivisa tra le schermate: non si modifica. */
export function useProducts(): ReadonlyMap<string, Product> | undefined {
  const snapshot = useSyncExternalStore(subscribeToProducts, productsSnapshot, loadingProducts);
  // se non si riescono a leggere valgono come nessuno
  return snapshot.error !== undefined ? NO_PRODUCTS : snapshot.value;
}

const isProfileOrNull = (v: unknown): v is NutritionProfile | null => v === null || isNutritionProfile(v);

export function useNutritionProfile(): { profile: NutritionProfile | null; ready: boolean } {
  const { value, ready } = useSetting<NutritionProfile | null>(PROFILE_SETTING_KEY, isProfileOrNull, null);
  return { profile: value, ready };
}

export const saveNutritionProfile = (profile: NutritionProfile): Promise<void> => setSetting(PROFILE_SETTING_KEY, profile);

const NO_OVERRIDES: FoodOverrides = {};

const useFoodOverridesSetting = () => useSetting<FoodOverrides>(OVERRIDES_SETTING_KEY, isFoodOverrides, NO_OVERRIDES);

export function useFoodOverrides(): FoodOverrides {
  return useFoodOverridesSetting().value;
}

export const saveFoodOverrides = (overrides: FoodOverrides): Promise<void> => setSetting(OVERRIDES_SETTING_KEY, overrides);

export interface NutritionData {
  /** Vero quando tutto è pronto e `intake` è calcolato. */
  ready: boolean;
  intake?: IntakeResult;
  foods?: readonly FoodComposition[];
  overrides: FoodOverrides;
  /** Che cosa si sa delle porzioni di preparazione usate nel calcolo, per `ref` (`prep:<id>`). */
  prepInfo: ReadonlyMap<string, PrepPortionInfo>;
  error: boolean;
}

const NO_PREP_INFO: ReadonlyMap<string, PrepPortionInfo> = new Map();

export interface IntakeInputs {
  /** Il registro intero, nell'ordine in cui lo dà l'archivio. */
  events: readonly AnyEvent[];
  foods: readonly FoodComposition[];
  products: ReadonlyMap<string, Product>;
  overrides: FoodOverrides;
  /** Le preparazioni dello stesso registro; `undefined` se non si sono potute leggere (valgono come nessuna). */
  preps: PrepState | undefined;
}

export interface IntakeOutput {
  intake: IntakeResult;
  prepInfo: ReadonlyMap<string, PrepPortionInfo>;
}

let lastIntake: { inputs: IntakeInputs; overridesKey: string; output: IntakeOutput } | undefined;

/** Ciò che il risolutore ha risposto nell'ultimo calcolo, voce per voce: vale finché tabella, prodotti e scelte manuali sono quelli. */
let lastAnswers: { foods: IntakeInputs["foods"]; products: IntakeInputs["products"]; overridesKey: string; byKey: Map<string, ResolverResult> } | undefined;

/**
 * La chiave di una voce: tutto ciò che il risolutore guarda per rispondere. Del lotto guarda solo il codice a barre
 * (e se è il lotto di porzioni di una preparazione, che qui non passa); del pasto niente. Così due confezioni dello
 * stesso prodotto, o la stessa voce libera in due pasti, sono una domanda sola.
 */
function answerKey(subject: IntakeSubject, barcodes: ReadonlyMap<string, string>): string {
  if (subject.kind === "pantry") {
    const { lotId, ...asked } = subject;
    return `${JSON.stringify(asked)}|${barcodes.get(lotId) ?? ""}`;
  }
  const { mealId: _mealId, ...asked } = subject;
  void _mealId;
  return JSON.stringify(asked);
}

/**
 * Cercare un nome nella tabella è la parte lenta del calcolo, e le voci si ripetono, nello stesso registro e da una
 * scrittura all'altra: la risposta già data si riusa. Vale solo se niente di ciò che il risolutore guarda è cambiato:
 * sta tutto nella chiave (`answerKey`); tabella, prodotti e scelte manuali diversi svuotano la memoria. La porzione
 * di una preparazione passa sempre dal risolutore: si calcola dai suoi ingredienti e lascia traccia in `prepInfo`.
 * Se il risolutore (`resolver.ts`) comincia a guardare altro del lotto o del pasto, va aggiunto alla chiave.
 */
function rememberAnswers(
  resolve: CompositionResolver,
  inputs: IntakeInputs,
  overridesKey: string,
  barcodes: ReadonlyMap<string, string>,
  preps: ReadonlyMap<string, unknown>,
): CompositionResolver {
  const last = lastAnswers;
  const before = last !== undefined && last.foods === inputs.foods && last.products === inputs.products && last.overridesKey === overridesKey ? last.byKey : undefined;
  // solo le voci di questo registro: ciò che non c'è più non resta in memoria
  const byKey = new Map<string, ResolverResult>();
  lastAnswers = { foods: inputs.foods, products: inputs.products, overridesKey, byKey };
  return (subject) => {
    if (subject.kind === "pantry" && preps.has(subject.lotId)) return resolve(subject);
    const key = answerKey(subject, barcodes);
    const answer = byKey.has(key) ? byKey.get(key) : before?.has(key) ? before.get(key) : resolve(subject);
    byKey.set(key, answer);
    return answer;
  };
}

/**
 * Nutrienti di tutti i giorni dal registro intero. Ricorda l'ultimo calcolo: con gli stessi ingressi (stesso elenco
 * di eventi, stessa tabella, stessa mappa dei prodotti, stesse preparazioni; per le scelte manuali conta il contenuto)
 * restituisce lo stesso risultato, così le schermate che lo chiedono insieme fanno un calcolo solo. Il risultato è
 * condiviso: non si modifica sul posto. Dopo una scrittura si ricalcola tutto, ma il risolutore si interroga solo per
 * le voci nuove (`rememberAnswers`).
 */
export function intakeFor(inputs: IntakeInputs): IntakeOutput {
  const overridesKey = JSON.stringify(inputs.overrides);
  const last = lastIntake;
  if (
    last !== undefined &&
    last.inputs.events === inputs.events &&
    last.inputs.foods === inputs.foods &&
    last.inputs.products === inputs.products &&
    last.inputs.preps === inputs.preps &&
    last.overridesKey === overridesKey
  ) {
    return last.output;
  }
  const { events, foods, products, overrides } = inputs;
  const preps = new Map((inputs.preps?.preps ?? []).map((p) => [p.batchLotId, p]));
  // dispensa e diario sono quelli già calcolati per questo stato del registro: `computeIntake` non li rifà
  const derived = derivedOf(events);
  const barcodes = barcodesOfLots(derived.pantry.lots);
  const built = buildResolverWithInfo({ foods, products, barcodes, overrides, preps });
  const prepInfo = built.prepInfo;
  const resolve = rememberAnswers(built.resolve, inputs, overridesKey, barcodes, preps);
  const raw = computeIntake(events, resolve, {}, { diary: derived.diary, pantry: derived.pantry });
  // le porzioni calcolate dagli ingredienti con dato mancante rendono parziali i nutrienti dei loro giorni
  const output = freezeShared({ intake: { ...raw, days: markPrepPartials(raw.days, prepInfo) }, prepInfo });
  lastIntake = { inputs, overridesKey, output };
  return output;
}

/** Nutrienti di tutti i giorni dal registro intero: si ricalcola solo quando cambia uno degli ingressi. */
export function useIntake(): NutritionData {
  const log = useEventLog();
  const foods = useFoods();
  const products = useProducts();
  const { value: overrides, ready: overridesReady } = useFoodOverridesSetting();
  const prepsState = usePreps();
  // senza l'elenco delle preparazioni (o con un errore: valgono come nessuna) non si calcola, per non rifarlo subito dopo
  const prepsReady = prepsState.data !== undefined || Boolean(prepsState.error);

  const computed = useMemo(() => {
    // né prima di aver letto le scelte manuali: con quelle vuote si calcolerebbe per niente, e le scelte vere
    // svuoterebbero la memoria delle risposte appena riempita
    if (!log.data || !foods || !products || !prepsReady || !overridesReady) return undefined;
    return intakeFor({ events: log.data, foods, products, overrides, preps: prepsState.data });
  }, [log.data, foods, products, overrides, prepsState.data, prepsReady, overridesReady]);

  return {
    ready: computed !== undefined,
    intake: computed?.intake,
    foods,
    overrides,
    prepInfo: computed?.prepInfo ?? NO_PREP_INFO,
    error: Boolean(log.error),
  };
}
