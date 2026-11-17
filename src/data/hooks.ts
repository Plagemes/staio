"use client";

import { useEffect, useState } from "react";
import type { Observable } from "dexie";
import type { LedgerEvent, PantryState } from "@/core/ledger";
import { liveEvents } from "./eventStore";
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

export function useEventLog(): LiveValue<LedgerEvent[]> {
  return useObservable(liveEvents);
}
