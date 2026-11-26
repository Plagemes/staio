"use client";

import { useEffect, useState } from "react";
import { liveSyncOverview } from "@/data/sync";
import type { SyncStamp } from "./settingsSummary";

/**
 * Le ultime sincronizzazioni (con Drive e con un file), vive. `undefined` finché non sono lette o se la lettura fallisce:
 * in quel caso la riga di Impostazioni resta senza valore.
 */
export function useSyncStamps(): readonly (SyncStamp | undefined)[] | undefined {
  const [stamps, setStamps] = useState<readonly (SyncStamp | undefined)[] | undefined>(undefined);
  useEffect(() => {
    const sub = liveSyncOverview().subscribe({
      next: (overview) => setStamps([overview.drive, overview.file]),
      error: () => setStamps(undefined),
    });
    return () => sub.unsubscribe();
  }, []);
  return stamps;
}
