"use client";

import { useCallback } from "react";
import type { AnyEvent } from "@/core/events";
import { appendEvents, getDeviceId } from "@/data";
import { useNotice } from "../notice";
import type { PlanContext } from "./edit";

export type WriteResult = { ok: true; events: AnyEvent[]; message: string } | { ok: false; error: string };

export interface WriteOptions {
  /**
   * Chi scrive da un foglio passa la sua chiusura: parte dopo la scrittura riuscita e prima dell'avviso, così l'avviso
   * non nasce mai sotto un foglio aperto.
   */
  beforeNotice?: () => void;
  /** Gli eventi scritti, a scrittura riuscita (per chi tiene un elenco di ciò che ha fatto). */
  onWritten?: (events: AnyEvent[], message: string) => void;
  /** Nessun avviso: il foglio resta aperto e darà un avviso solo, alla chiusura. */
  silent?: boolean;
}

/**
 * Scrive nel registro gli eventi che una funzione costruisce e mostra l'avviso con «Annulla».
 * Restituisce il testo dell'errore, oppure `null` se è andata bene.
 */
export function useWriter(): (build: (ctx: PlanContext) => WriteResult, options?: WriteOptions) => Promise<string | null> {
  const notice = useNotice();
  return useCallback(
    async (build, options) => {
      try {
        const result = build({ now: new Date().toISOString(), deviceId: await getDeviceId() });
        if (!result.ok) return result.error;
        const written = await appendEvents(result.events);
        if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
        options?.onWritten?.(result.events, result.message);
        options?.beforeNotice?.();
        if (!options?.silent) notice.show({ message: result.message, undo: result.events });
        return null;
      } catch {
        return "Non sono riuscito a salvare sul telefono. Riprova.";
      }
    },
    [notice],
  );
}
