"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_PREFS, previewNotices, type NoticeFact, type NotifyPrefs } from "@/core/notify";
import { DEFAULT_TIME_ZONE } from "@/core/diary";
import { useDiary, usePantry, usePlan, usePreps } from "@/data";
import { useNow } from "../useNow";
import type { RunData } from "./delivery";
import { createNotifyStore, type NotifyStore } from "./store";

let sharedStore: NotifyStore | undefined;
/** Un solo archivio per tutta l'app. */
export function getNotifyStore(): NotifyStore {
  sharedStore ??= createNotifyStore();
  return sharedStore;
}

const listeners = new Set<(prefs: NotifyPrefs) => void>();

export interface PrefsState {
  /** Null finché non sono lette; predefinite se l'archivio non c'è. */
  prefs: NotifyPrefs | null;
  /** L'archivio del dispositivo non è disponibile: le scelte non si ricordano. */
  unavailable: boolean;
  update(change: (current: NotifyPrefs) => NotifyPrefs): Promise<NotifyPrefs>;
}

/** Preferenze degli avvisi, condivise tra le schermate. Restano sul dispositivo. */
export function useNotifyPrefs(): PrefsState {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    const listener = (next: NotifyPrefs) => {
      if (alive) setPrefs(next);
    };
    listeners.add(listener);
    getNotifyStore()
      .loadPrefs()
      .then((p) => alive && setPrefs(p))
      .catch(() => {
        if (!alive) return;
        setUnavailable(true);
        setPrefs((cur) => cur ?? DEFAULT_PREFS);
      });
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback(
    async (change: (current: NotifyPrefs) => NotifyPrefs) => {
      const next = change(prefs ?? DEFAULT_PREFS);
      setPrefs(next);
      listeners.forEach((l) => l(next));
      try {
        await getNotifyStore().savePrefs(next);
      } catch {
        setUnavailable(true);
      }
      return next;
    },
    [prefs],
  );

  return { prefs, unavailable, update };
}

/** Dati del telefono che servono al calcolo; undefined finché non sono tutti letti. */
export function useNotifyData(): RunData | undefined {
  const pantry = usePantry().data;
  const preps = usePreps().data;
  const plan = usePlan().data;
  const diary = useDiary().data;
  return useMemo(
    () => (pantry && preps && plan && diary ? { pantry, preps, plan, diary } : undefined),
    [pantry, preps, plan, diary],
  );
}

/** Avvisi di oggi dei tipi attivi (anche se gli avvisi sul telefono sono spenti). Null se i dati non ci sono ancora. */
export function useTodayNotices(): NoticeFact[] | null {
  const { prefs } = useNotifyPrefs();
  const data = useNotifyData();
  const now = useNow();
  return useMemo(() => {
    if (!prefs || !data || !now) return null;
    try {
      return previewNotices({ ...data, now, timeZone: DEFAULT_TIME_ZONE, prefs });
    } catch {
      return [];
    }
  }, [prefs, data, now]);
}
