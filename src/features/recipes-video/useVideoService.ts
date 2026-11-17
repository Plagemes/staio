"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/data/db";
import { EMPTY_VIDEO_SERVICE, VIDEO_SERVICE_KEY, normalizeVideoService, type VideoServiceSettings } from "./settings";

/** Impostazioni del servizio di estrazione, aggiornate quando cambiano. `ready` è falso finché non sono state lette. */
export function useVideoService(): { service: VideoServiceSettings; ready: boolean } {
  const [state, setState] = useState<{ service: VideoServiceSettings; ready: boolean }>({ service: EMPTY_VIDEO_SERVICE, ready: false });
  useEffect(() => {
    const sub = liveQuery(() => getDb().settings.get(VIDEO_SERVICE_KEY)).subscribe({
      next: (row) => setState({ service: normalizeVideoService(row?.value), ready: true }),
      error: () => setState({ service: EMPTY_VIDEO_SERVICE, ready: true }),
    });
    return () => sub.unsubscribe();
  }, []);
  return state;
}
