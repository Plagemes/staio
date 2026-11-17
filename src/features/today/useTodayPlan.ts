"use client";

import { useMemo } from "react";
import type { MealKind } from "@/core/diary";
import { entriesOfDate, getWeek, weekStartOf, type AdherenceOptions, type LotRef, type PlannedEntry } from "@/core/plan";
import { itemLabel, type Catalog } from "../plan/describe";
import { nextWeekStart } from "../plan/moveMeal";
import { useShoppingData } from "../shopping/useShoppingData";

const NO_ENTRIES: PlannedEntry[] = [];

export interface TodayPlan {
  ready: boolean;
  /** Voci proposte nella lista della spesa. */
  shoppingCount: number;
  /** Pasti pianificati per oggi, già descritti; vuoto se non c'è un piano. */
  planned: { meal: PlannedEntry["meal"]; text: string; note?: string }[];
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
  const planned = useMemo(() => {
    if (!plan.plan || !plan.today) return [];
    const week = getWeek(plan.plan, weekStart);
    return entriesOfDate(week, plan.today).map((e) => ({
      meal: e.meal,
      text: itemLabel(e.item, plan.catalog),
      ...(e.note ? { note: e.note } : {}),
    }));
  }, [plan.plan, plan.today, plan.catalog, weekStart]);
  const kinds = useMemo(() => plan.plan?.structure?.meals.map((m) => m.kind), [plan.plan]);
  return { ready: data.ready, shoppingCount: data.view?.items.length ?? 0, planned, weekStart, weekEntries, nextWeekStart: nextStart, nextWeekEntries, adherence, kinds, catalog: plan.catalog };
}
