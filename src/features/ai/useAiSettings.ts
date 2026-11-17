"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/data/db";
import { AI_SETTINGS_KEY, defaultAiSettings, normalizeSettings, type AiSettings } from "./settings";

/** Impostazioni dell'intelligenza artificiale, aggiornate quando cambiano. `ready` è falso finché non sono state lette. */
export function useAiSettings(): { settings: AiSettings; ready: boolean } {
  const [state, setState] = useState<{ settings: AiSettings; ready: boolean }>(() => ({
    settings: defaultAiSettings("0000-00"),
    ready: false,
  }));
  useEffect(() => {
    const sub = liveQuery(() => getDb().settings.get(AI_SETTINGS_KEY)).subscribe({
      next: (row) => setState({ settings: normalizeSettings(row?.value, new Date().toISOString()), ready: true }),
      error: () => setState({ settings: defaultAiSettings("0000-00"), ready: true }),
    });
    return () => sub.unsubscribe();
  }, []);
  return state;
}
