"use client";

// Tutto ciò che le schermate del piano leggono, pronto in un colpo solo: il registro derivato, il risolutore
// dei nutrienti e l'espansione di ricette e preparazioni. Si ricalcola solo quando cambiano gli ingressi.
import { useMemo } from "react";
import type { AnyEvent } from "@/core/events";
import type { DiaryState } from "@/core/diary";
import { activeLots, type Lot, type PantryState } from "@/core/ledger";
import type { CompositionResolver, FoodComposition } from "@/core/nutrition";
import type { ExpandRef, NutrientsOfEntry, PlanState } from "@/core/plan";
import type { PrepRecord, PrepState } from "@/core/prep";
import type { Recipe } from "@/core/recipes";
import { useDiary, useEventLog, usePantry, usePlan, usePreps, useRecipes } from "@/data";
import { useFoodOverrides, useFoods, useProducts } from "../nutrition/useNutrition";
import { barcodesOfLots, buildResolverWithInfo } from "../nutrition/resolver";
import { dayOf } from "../format";
import { useNow } from "../useNow";
import type { Catalog } from "./describe";
import { makeExpand } from "./expand";
import { makeNutrientsOf } from "./nutrients";

export interface PlanData {
  ready: boolean;
  error: boolean;
  now: string | null;
  today: string;
  plan: PlanState | undefined;
  recipes: Recipe[];
  preps: PrepRecord[];
  prepState: PrepState | undefined;
  pantry: PantryState | undefined;
  lots: Lot[];
  diary: DiaryState | undefined;
  log: AnyEvent[] | undefined;
  catalog: Catalog;
  expand: ExpandRef;
  foods: readonly FoodComposition[] | undefined;
  resolver: CompositionResolver | undefined;
  /** Disponibile quando la tabella degli alimenti è caricata. */
  nutrientsOf: NutrientsOfEntry | undefined;
}

const NO_RECIPES: Recipe[] = [];
const NO_PREPS: PrepRecord[] = [];

export function usePlanData(): PlanData {
  const now = useNow();
  const plan = usePlan();
  const recipesState = useRecipes();
  const prepsState = usePreps();
  const pantry = usePantry();
  const diary = useDiary();
  const log = useEventLog();
  const foods = useFoods();
  const products = useProducts();
  const overrides = useFoodOverrides();

  const recipes = recipesState.data?.recipes ?? NO_RECIPES;
  const preps = prepsState.data?.preps ?? NO_PREPS;
  const catalog = useMemo<Catalog>(() => ({ recipes, preps }), [recipes, preps]);
  const expand = useMemo(() => makeExpand(catalog), [catalog]);
  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);

  const built = useMemo(
    () =>
      foods && products && pantry.data
        ? buildResolverWithInfo({
            foods,
            products,
            barcodes: barcodesOfLots(pantry.data.lots),
            overrides,
            preps: new Map(preps.map((p) => [p.batchLotId, p])),
          })
        : undefined,
    [foods, products, pantry.data, overrides, preps],
  );
  const resolver = built?.resolve;
  const nutrientsOf = useMemo(() => {
    if (!built || !pantry.data) return undefined;
    const category = new Map(pantry.data.lots.map((l) => [l.lotId, l.category]));
    return makeNutrientsOf({ resolver: built.resolve, prepInfo: built.prepInfo, recipes, preps, lotCategory: (id) => category.get(id) });
  }, [built, pantry.data, recipes, preps]);

  const error = Boolean(plan.error || recipesState.error || prepsState.error || pantry.error || diary.error || log.error);
  return {
    ready: Boolean(now && plan.data && recipesState.data && prepsState.data && pantry.data && diary.data && log.data),
    error,
    now,
    today: now ? dayOf(now) : "",
    plan: plan.data,
    recipes,
    preps,
    prepState: prepsState.data,
    pantry: pantry.data,
    lots,
    diary: diary.data,
    log: log.data,
    catalog,
    expand,
    foods,
    resolver,
    nutrientsOf,
  };
}
