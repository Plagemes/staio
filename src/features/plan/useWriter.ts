"use client";

import { useCallback } from "react";
import type { AnyEvent } from "@/core/events";
import { appendEvents, getDeviceId } from "@/data";
import { useNotice } from "../notice";
import type { PlanContext } from "./edit";

export type WriteResult = { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string };

/**
 * Scrive nel registro gli eventi che una funzione costruisce e mostra l'avviso con «Annulla».
 * Restituisce il testo dell'errore, oppure `null` se è andata bene.
 */
export function useWriter(): (build: (ctx: PlanContext) => WriteResult) => Promise<string | null> {
  const notice = useNotice();
  return useCallback(
    async (build) => {
      try {
        const result = build({ now: new Date().toISOString(), deviceId: await getDeviceId() });
        if (!result.ok) return result.error;
        const written = await appendEvents(result.events);
        if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
        notice.show({ message: result.message, undo: result.events });
        return null;
      } catch {
        return "Non sono riuscito a salvare sul telefono. Riprova.";
      }
    },
    [notice],
  );
}
