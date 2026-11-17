"use client";

// Dati della nutrizione per le schermate. La tabella degli alimenti e i riferimenti si caricano solo qui,
// con un import dinamico: le pagine che non li usano non li scaricano. Il calcolo si rifà solo quando
// cambiano gli eventi, i prodotti o le scelte manuali, non a ogni disegno.
import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/core/catalog";
import type { FoodComposition, IntakeResult, ReferenceWithVariant } from "@/core/nutrition";
import { derivePantry } from "@/core/ledger";
import { computeIntake } from "@/core/nutrition";
import { listProductRecords, useEventLog } from "@/data";
import { setSetting, useSetting } from "../localSettings";
import { PROFILE_SETTING_KEY, isNutritionProfile, type NutritionProfile } from "./profile";
import { OVERRIDES_SETTING_KEY, buildResolver, isFoodOverrides, barcodesOfLots, type FoodOverrides } from "./resolver";

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

/** Prodotti letti dal codice a barre, per codice. */
export function useProducts(): ReadonlyMap<string, Product> | undefined {
  const [products, setProducts] = useState<ReadonlyMap<string, Product> | undefined>();
  useEffect(() => {
    const sub = liveQuery(() => listProductRecords()).subscribe({
      next: (records) => {
        const map = new Map<string, Product>();
        for (const r of records) {
          const p = r.data as Partial<Product> | null;
          if (p && typeof p.barcode === "string") map.set(r.barcode, p as Product);
        }
        setProducts(map);
      },
      error: () => setProducts(new Map()),
    });
    return () => sub.unsubscribe();
  }, []);
  return products;
}

const isProfileOrNull = (v: unknown): v is NutritionProfile | null => v === null || isNutritionProfile(v);

export function useNutritionProfile(): { profile: NutritionProfile | null; ready: boolean } {
  const { value, ready } = useSetting<NutritionProfile | null>(PROFILE_SETTING_KEY, isProfileOrNull, null);
  return { profile: value, ready };
}

export const saveNutritionProfile = (profile: NutritionProfile): Promise<void> => setSetting(PROFILE_SETTING_KEY, profile);

const NO_OVERRIDES: FoodOverrides = {};

export function useFoodOverrides(): FoodOverrides {
  return useSetting<FoodOverrides>(OVERRIDES_SETTING_KEY, isFoodOverrides, NO_OVERRIDES).value;
}

export const saveFoodOverrides = (overrides: FoodOverrides): Promise<void> => setSetting(OVERRIDES_SETTING_KEY, overrides);

export interface NutritionData {
  /** Vero quando tutto è pronto e `intake` è calcolato. */
  ready: boolean;
  intake?: IntakeResult;
  foods?: readonly FoodComposition[];
  overrides: FoodOverrides;
  error: boolean;
}

/** Nutrienti di tutti i giorni dal registro intero: si ricalcola solo quando cambia uno degli ingressi. */
export function useIntake(): NutritionData {
  const log = useEventLog();
  const foods = useFoods();
  const products = useProducts();
  const overrides = useFoodOverrides();

  const intake = useMemo(() => {
    if (!log.data || !foods || !products) return undefined;
    const resolver = buildResolver({ foods, products, barcodes: barcodesOfLots(derivePantry(log.data).lots), overrides });
    return computeIntake(log.data, resolver);
  }, [log.data, foods, products, overrides]);

  return { ready: intake !== undefined, intake, foods, overrides, error: Boolean(log.error) };
}
