"use client";

// Tutto ciò che le schermate della spesa leggono: dispensa, piano, impostazioni locali e la vista già composta.
import { useCallback, useMemo } from "react";
import { getDay } from "@/core/diary";
import { emptyRejections, emptyStockConfig, type CompletedTrip, type RejectionMemory, type StockConfig, type TripState } from "@/core/shopping";
import { setSetting, useSetting } from "@/data";
import { usePlanData, type PlanData } from "../plan/usePlanData";
import { prune } from "./decisions";
import type { ManualItem } from "./manual";
import { expiringPairs } from "./pairs";
import { planNeedsFor, type CoveredPrep, type PlanNeedsResult } from "./planNeeds";
import {
  SETTING_KEYS,
  emptyDecisions,
  isBudget,
  isDecisions,
  isHistory,
  isManualList,
  isRejectionMemory,
  isStockConfig,
  isTrip,
  type Decisions,
} from "./settings";
import { buildShoppingView, type ShoppingView } from "./view";

const NO_MANUAL: ManualItem[] = [];
const NO_HISTORY: CompletedTrip[] = [];
const NO_REJECTIONS: RejectionMemory = emptyRejections();
const NO_STOCK: StockConfig = emptyStockConfig();
const NO_DECISIONS: Decisions = emptyDecisions();

function useChecked<T>(key: string, guard: (v: unknown) => v is T, fallback: T): { value: T; loading: boolean } {
  const live = useSetting<unknown>(key);
  const value = !live.loading && guard(live.data) ? live.data : fallback;
  return { value, loading: live.loading };
}

const isTripOrNull = (v: unknown): v is TripState | null => v === null || isTrip(v);

export interface ShoppingData {
  ready: boolean;
  error: boolean;
  plan: PlanData;
  view: ShoppingView | undefined;
  rejections: RejectionMemory;
  manual: ManualItem[];
  stock: StockConfig;
  history: CompletedTrip[];
  trip: TripState | null;
  lastTrip: TripState | null;
  budgetCents: number | null;
  decisions: Decisions;
  /** Ricette o preparazioni del piano di cui non si sono potuti contare gli ingredienti. */
  planUnresolved: number;
  /** Preparazioni del piano coperte, in tutto o in parte, da porzioni già pronte. */
  coveredPreps: CoveredPrep[];
  save: (key: string, value: unknown) => Promise<boolean>;
}

export function useShoppingData(store?: string): ShoppingData {
  const plan = usePlanData();
  const rejections = useChecked(SETTING_KEYS.rejections, isRejectionMemory, NO_REJECTIONS);
  const manual = useChecked(SETTING_KEYS.manual, isManualList, NO_MANUAL);
  const stock = useChecked(SETTING_KEYS.stock, isStockConfig, NO_STOCK);
  const history = useChecked(SETTING_KEYS.history, isHistory, NO_HISTORY);
  const trip = useChecked<TripState | null>(SETTING_KEYS.trip, isTripOrNull, null);
  const lastTrip = useChecked<TripState | null>(SETTING_KEYS.lastTrip, isTripOrNull, null);
  const budget = useChecked<number | null>(SETTING_KEYS.budget, isBudget, null);
  const decisions = useChecked(SETTING_KEYS.decisions, isDecisions, NO_DECISIONS);

  const settingsReady = ![rejections, manual, stock, history, trip, lastTrip, budget, decisions].some((s) => s.loading);
  const ready = plan.ready && settingsReady;

  const needs = useMemo<PlanNeedsResult>(
    () =>
      plan.plan && plan.prepState && plan.today
        ? planNeedsFor({
            today: plan.today,
            plan: plan.plan,
            expand: plan.expand,
            preps: plan.prepState,
            isLogged: (date, meal) => plan.diary !== undefined && (getDay(plan.diary, date)?.meals.some((m) => m.kind === meal) ?? false),
          })
        : { needs: [], unresolved: 0, covered: [] },
    [plan.plan, plan.prepState, plan.today, plan.expand, plan.diary],
  );
  const pairs = useMemo(() => (plan.today ? expiringPairs(plan.recipes, plan.lots, plan.today) : []), [plan.recipes, plan.lots, plan.today]);

  const view = useMemo(
    () =>
      ready && plan.pantry
        ? buildShoppingView({
            today: plan.today,
            pantry: plan.pantry,
            planNeeds: needs.needs,
            manual: manual.value,
            pairs,
            stock: stock.value,
            rejections: rejections.value,
            decisions: decisions.value,
            budgetCents: budget.value,
            ...(store ? { store } : {}),
          })
        : undefined,
    [ready, plan.today, plan.pantry, needs, manual.value, pairs, stock.value, rejections.value, decisions.value, budget.value, store],
  );

  const save = useCallback(async (key: string, value: unknown) => {
    try {
      await setSetting(key, value);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    ready,
    error: plan.error,
    plan,
    view,
    rejections: rejections.value,
    manual: manual.value,
    stock: stock.value,
    history: history.value,
    trip: trip.value,
    lastTrip: lastTrip.value,
    budgetCents: budget.value,
    decisions: decisions.value,
    planUnresolved: needs.unresolved,
    coveredPreps: needs.covered,
    save,
  };
}

/** Voci ancora vive: serve a togliere dalle scelte quelle che non esistono più. */
export function pruneDecisions(decisions: Decisions, view: ShoppingView): Decisions {
  return prune(decisions, new Set([...view.items, ...view.suppressed].map((i) => i.id)), view.today);
}
