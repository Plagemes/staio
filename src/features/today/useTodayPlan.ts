"use client";

import { useMemo } from "react";
import { entriesOfDate, getWeek, weekStartOf, type PlannedEntry } from "@/core/plan";
import { itemLabel } from "../plan/describe";
import { useShoppingData } from "../shopping/useShoppingData";

export interface TodayPlan {
  ready: boolean;
  /** Voci proposte nella lista della spesa. */
  shoppingCount: number;
  /** Pasti pianificati per oggi, già descritti; vuoto se non c'è un piano. */
  planned: { meal: PlannedEntry["meal"]; text: string; note?: string }[];
}

/** Ciò che Oggi sa del piano e della spesa: quante voci propone la lista e che cosa è pianificato per oggi. */
export function useTodayPlan(): TodayPlan {
  const data = useShoppingData();
  const { plan } = data;
  const planned = useMemo(() => {
    if (!plan.plan || !plan.today) return [];
    const week = getWeek(plan.plan, weekStartOf(plan.today));
    return entriesOfDate(week, plan.today).map((e) => ({
      meal: e.meal,
      text: itemLabel(e.item, plan.catalog),
      ...(e.note ? { note: e.note } : {}),
    }));
  }, [plan.plan, plan.today, plan.catalog]);
  return { ready: data.ready, shoppingCount: data.view?.items.length ?? 0, planned };
}
