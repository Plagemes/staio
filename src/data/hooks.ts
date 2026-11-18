"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Observable } from "dexie";
import type { AnyEvent } from "@/core/events";
import type { DiaryState } from "@/core/diary";
import type { PlanState } from "@/core/plan";
import type { PrepState } from "@/core/prep";
import type { RecipesState } from "@/core/recipes";
import type { PantryState } from "@/core/ledger";
import { liveSetting } from "./settings";
import { LOADING_LOG, derivedOf, sharedLog, type Derived, type LogSnapshot } from "./shared";

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

const subscribeToLog = (listener: () => void) => sharedLog().subscribe(listener);
const logSnapshot = () => sharedLog().getSnapshot();
// sul server e nel primo disegno dopo l'idratazione: «in caricamento», come prima della prima risposta dell'archivio
const serverSnapshot = () => LOADING_LOG;

/** Che cosa un gancio legge dal registro: l'elenco degli eventi o una delle sue derivazioni. */
export type LogView = "events" | keyof Derived;

const LOADING: LiveValue<never> = Object.freeze({ data: undefined, loading: true, error: undefined });

function readView(snapshot: LogSnapshot, view: LogView): LiveValue<unknown> {
  const { events } = snapshot;
  if (events === undefined) return snapshot.error === undefined ? LOADING : { data: undefined, loading: false, error: snapshot.error };
  try {
    return { data: view === "events" ? events : derivedOf(events)[view], loading: false, error: undefined };
  } catch (error) {
    // una derivazione che lancia (un evento rotto) resta sua: gli altri ganci hanno i loro dati
    return { data: undefined, loading: false, error };
  }
}

const liveBySnapshot = new WeakMap<LogSnapshot, Map<LogView, LiveValue<unknown>>>();

/**
 * Ciò che un gancio restituisce per uno stato del registro: lo stesso oggetto per tutte le schermate finché lo stato
 * è quello (un oggetto nuovo a ogni disegno farebbe ridisegnare chi lo mette tra le dipendenze di un effetto).
 */
export function liveValueOf<T = unknown>(snapshot: LogSnapshot, view: LogView): LiveValue<T> {
  let views = liveBySnapshot.get(snapshot);
  if (views === undefined) {
    views = new Map();
    liveBySnapshot.set(snapshot, views);
  }
  let live = views.get(view);
  if (live === undefined) {
    live = readView(snapshot, view);
    views.set(view, live);
  }
  return live as LiveValue<T>;
}

/**
 * Tutti i ganci del registro leggono lo stesso stato del registro condiviso, nello stesso disegno: mai la dispensa di dopo
 * con il diario di prima. I dati sono condivisi tra le schermate: non si modificano sul posto.
 */
function useLogView<T>(view: LogView): LiveValue<T> {
  return liveValueOf<T>(useSyncExternalStore(subscribeToLog, logSnapshot, serverSnapshot), view);
}

export function usePantry(): LiveValue<PantryState> {
  return useLogView("pantry");
}

export function useEventLog(): LiveValue<AnyEvent[]> {
  return useLogView("events");
}

export function useDiary(): LiveValue<DiaryState> {
  return useLogView("diary");
}

export function usePlan(): LiveValue<PlanState> {
  return useLogView("plan");
}

export function useRecipes(): LiveValue<RecipesState> {
  return useLogView("recipes");
}

export function usePreps(): LiveValue<PrepState> {
  return useLogView("preps");
}

export function useSetting<T = unknown>(key: string): LiveValue<T | undefined> {
  const create = useCallback(() => liveSetting<T>(key), [key]);
  return useObservable(create);
}
