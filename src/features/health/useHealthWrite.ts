"use client";

import { useRef, useState } from "react";
import { InvalidDiaryEventError } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { appendEvents, getDeviceId } from "@/data";
import { useNotice } from "../notice";

type Built = { events: AnyEvent[]; message: string } | { error: string };

/**
 * Le scritture dei fogli di Salute: una sola `appendEvents` (una riga in «Ultime azioni»), poi il foglio si chiude
 * (`close`), poi nasce l'avviso con «Annulla» su tutti gli eventi scritti. Un secondo tocco mentre si salva non scrive
 * niente. Restituisce il testo dell'errore, da mostrare nel foglio che resta aperto, o `null`.
 */
export function useHealthWrite() {
  const notice = useNotice();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  async function write(build: (ctx: { deviceId: string; now: string }) => Built, close: () => void): Promise<string | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    try {
      const built = build({ deviceId: await getDeviceId(), now: new Date().toISOString() });
      if ("error" in built) return built.error;
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
      close();
      notice.show({ message: built.message, undo: built.events });
      return null;
    } catch (e) {
      if (e instanceof InvalidDiaryEventError) return "Questo valore non è accettabile: controlla il numero.";
      return "Non sono riuscito a salvare sul telefono. Riprova.";
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { write, busy };
}
