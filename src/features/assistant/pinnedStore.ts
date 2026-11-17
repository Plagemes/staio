"use client";

// Le viste fissate nelle impostazioni locali: solo la descrizione. Ogni modifica rilegge prima l'archivio, così due
// schede aperte non si cancellano a vicenda.
import { useMemo } from "react";
import { PINNED_SETTING_KEY, normalizePinned, pinView, removePinned, renamePinned, toStore, type PinnedView, type PinResult } from "@/core/views";
import type { ViewSpec } from "@/core/views";
import { generateId } from "@/core/ledger";
import { getSetting, setSetting, useSetting } from "@/data";

/** Le viste fissate, aggiornate quando cambiano. `loading` è vero finché non sono state lette. */
export function usePinnedViews(): { views: PinnedView[]; loading: boolean } {
  const live = useSetting<unknown>(PINNED_SETTING_KEY);
  const views = useMemo(() => normalizePinned(live.data), [live.data]);
  return { views, loading: live.loading };
}

async function mutate<T>(change: (views: PinnedView[]) => { views: PinnedView[]; result: T }): Promise<T> {
  const current = normalizePinned(await getSetting<unknown>(PINNED_SETTING_KEY));
  const { views, result } = change(current);
  await setSetting(PINNED_SETTING_KEY, toStore(views));
  return result;
}

export function pinSpec(spec: ViewSpec, question: string | undefined, now: string = new Date().toISOString()): Promise<PinResult> {
  return mutate((views) => {
    const result = pinView(views, { id: generateId(), spec, now, ...(question !== undefined ? { question } : {}) });
    return { views: result.ok ? result.views : views, result };
  });
}

export const renamePinnedView = (id: string, name: string): Promise<void> => mutate((views) => ({ views: renamePinned(views, id, name), result: undefined }));

export const removePinnedView = (id: string): Promise<void> => mutate((views) => ({ views: removePinned(views, id), result: undefined }));
