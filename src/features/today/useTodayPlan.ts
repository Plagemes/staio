"use client";

import { useMemo } from "react";
import type { MealKind } from "@/core/diary";
import { entriesOfDate, getWeek, missingFor, weekStartOf, type AdherenceOptions, type ExpandRef, type LotRef, type MissingResult, type PlannedEntry, type PlannedItem } from "@/core/plan";
import { itemLabel, itemName, type Catalog } from "../plan/describe";
import { cookHref } from "../plan/itemCommand";
import { portionsLeftOf, stockLines } from "../plan/missingView";
import type { PlanData } from "../plan/usePlanData";
import { nextWeekStart } from "../plan/moveMeal";
import { useShoppingData } from "../shopping/useShoppingData";

const NO_ENTRIES: PlannedEntry[] = [];

/** Una voce del piano di oggi, già descritta. */
export interface PlannedToday {
  meal: PlannedEntry["meal"];
  text: string;
  note?: string;
  item: PlannedItem;
  date: string;
  entry: PlannedEntry;
  /** «Cucina», solo per una ricetta ancora nel ricettario. */
  href?: string;
}

export interface TodayPlan {
  ready: boolean;
  /** Voci proposte nella lista della spesa. */
  shoppingCount: number;
  /** Nomi di ciò che manca in dispensa per il piano di oggi (voci della spesa nate dal piano e già necessarie oggi). */
  missingToday: string[];
  /** Pasti pianificati per oggi, già descritti; vuoto se non c'è un piano. */
  planned: PlannedToday[];
  /** Che cosa manca per i pasti di oggi, uno per pasto che ha voci (da `missingFor`, con la dispensa di adesso). */
  missingByMeal: Partial<Record<MealKind, MissingResult>>;
  /** Per rileggere «che cosa manca» prima di scrivere sulla spesa. */
  expand: ExpandRef | undefined;
  preps: PlanData["preps"];
  /** Lunedì della settimana in corso. */
  weekStart: string;
  /** Tutte le voci pianificate della settimana in corso. */
  weekEntries: readonly PlannedEntry[];
  /** Lunedì della settimana dopo e le sue voci pianificate (nessuna se non c'è ancora un piano). */
  nextWeekStart: string;
  nextWeekEntries: readonly PlannedEntry[];
  /** Per l'aderenza del piano: registro, lotti e ricette; assente finché i dati non sono pronti. */
  adherence: AdherenceOptions | undefined;
  /** I momenti del piano (quelli della struttura); assente se non c'è una struttura. */
  kinds: MealKind[] | undefined;
  catalog: Catalog | undefined;
}

/** «Da comprare (N)» della Spesa: voci con quantità più voci senza quantità. Oggi deve dire lo stesso numero. */
export function shoppingListCount(view: { items: readonly unknown[]; noQuantity: readonly unknown[] } | null | undefined): number {
  return view ? view.items.length + view.noQuantity.length : 0;
}

/** Ciò che Oggi sa del piano e della spesa: quante voci propone la lista e che cosa è pianificato per oggi. */
export function useTodayPlan(): TodayPlan {
  const data = useShoppingData();
  const { plan } = data;
  const weekStart = plan.today ? weekStartOf(plan.today) : "";
  const weekEntries = useMemo(() => (plan.plan && weekStart ? (getWeek(plan.plan, weekStart)?.entries ?? NO_ENTRIES) : NO_ENTRIES), [plan.plan, weekStart]);
  const nextStart = weekStart ? nextWeekStart(weekStart) : "";
  const nextWeekEntries = useMemo(() => (plan.plan && nextStart ? (getWeek(plan.plan, nextStart)?.entries ?? NO_ENTRIES) : NO_ENTRIES), [plan.plan, nextStart]);
  const adherence = useMemo<AdherenceOptions | undefined>(() => {
    if (!plan.log) return undefined;
    const lots = new Map<string, LotRef>(plan.lots.map((l) => [l.lotId, { productRef: l.productRef }]));
    for (const p of plan.preps) lots.set(p.batchLotId, { productRef: p.title, prepId: p.prepId });
    return { events: plan.log, lots, expand: plan.expand };
  }, [plan.log, plan.lots, plan.preps, plan.expand]);
  const planned = useMemo<PlannedToday[]>(() => {
    if (!plan.plan || !plan.today) return [];
    const week = getWeek(plan.plan, weekStart);
    return entriesOfDate(week, plan.today).map((e) => ({
      meal: e.meal,
      text: itemLabel(e.item, plan.catalog),
      ...(e.note ? { note: e.note } : {}),
      item: e.item,
      date: e.date,
      entry: e,
      ...cookLink(e.item, plan.catalog),
    }));
  }, [plan.plan, plan.today, plan.catalog, weekStart]);
  // un calcolo per pasto; la dispensa è quella dei lotti attivi di adesso
  const missingByMeal = useMemo(() => {
    const out: Partial<Record<MealKind, MissingResult>> = {};
    if (planned.length === 0) return out;
    const stock = stockLines(plan.lots);
    const portionsLeft = portionsLeftOf(plan.preps, plan.lots);
    const nameOf = (item: PlannedItem) => itemName(item, plan.catalog);
    for (const meal of new Set(planned.map((p) => p.meal))) {
      out[meal] = missingFor(
        planned.filter((p) => p.meal === meal).map((p) => p.entry),
        { expand: plan.expand, stock, portionsLeft, nameOf },
      );
    }
    return out;
  }, [planned, plan.lots, plan.preps, plan.catalog, plan.expand]);
  const missingToday = useMemo(
    () =>
      plan.today
        ? (data.view?.items ?? []).filter((i) => i.item.reasons.some((r) => r.kind === "plan" && r.earliestDate <= plan.today)).map((i) => i.name)
        : [],
    [data.view, plan.today],
  );
  const kinds = useMemo(() => plan.plan?.structure?.meals.map((m) => m.kind), [plan.plan]);
  return { ready: data.ready, shoppingCount: shoppingListCount(data.view), missingToday, planned, missingByMeal, expand: plan.expand, preps: plan.preps, weekStart, weekEntries, nextWeekStart: nextStart, nextWeekEntries, adherence, kinds, catalog: plan.catalog };
}

function cookLink(item: PlannedItem, catalog: Catalog): { href: string } | Record<string, never> {
  if (item.kind !== "recipe" || !catalog.recipes.some((r) => r.recipeId === item.recipeId)) return {};
  return { href: cookHref(item.recipeId, item.servings) };
}
