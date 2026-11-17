"use client";

import { useCallback, useEffect, useState } from "react";
import type { Observable } from "dexie";
import type { AnyEvent } from "@/core/events";
import type { DiaryState } from "@/core/diary";
import type { PlanState } from "@/core/plan";
import type { PrepState } from "@/core/prep";
import type { RecipesState } from "@/core/recipes";
import type { PantryState } from "@/core/ledger";
import { liveEvents } from "./eventStore";
import { liveDiary } from "./diary";
import { livePlan, livePreps, liveRecipes } from "./derived";
import { liveSetting } from "./settings";
import { livePantry } from "./pantry";

export interface LiveValue<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
}

function useObservable<T>(create: () => Observable<T>): LiveValue<T> {
  const [state, setState] = useState<LiveValue<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  });
  useEffect(() => {
    const sub = create().subscribe({
      next: (data) => setState({ data, loading: false, error: undefined }),
      error: (error) => setState({ data: undefined, loading: false, error }),
    });
    return () => sub.unsubscribe();
  }, [create]);
  return state;
}

export function usePantry(): LiveValue<PantryState> {
  return useObservable(livePantry);
}

export function useEventLog(): LiveValue<AnyEvent[]> {
  return useObservable(liveEvents);
}

export function useDiary(): LiveValue<DiaryState> {
  return useObservable(liveDiary);
}

export function usePlan(): LiveValue<PlanState> {
  return useObservable(livePlan);
}

export function useRecipes(): LiveValue<RecipesState> {
  return useObservable(liveRecipes);
}

export function usePreps(): LiveValue<PrepState> {
  return useObservable(livePreps);
}

export function useSetting<T = unknown>(key: string): LiveValue<T | undefined> {
  const create = useCallback(() => liveSetting<T>(key), [key]);
  return useObservable(create);
}
