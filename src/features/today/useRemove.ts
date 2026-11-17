"use client";

import { useState } from "react";
import type { VoidEvent } from "@/core/ledger";
import { appendEvents, getDeviceId } from "@/data";
import { useNotice } from "../notice";

/**
 * «Togli» nel diario: nessuna domanda prima. Scrive gli annullamenti e mostra «Tolto: …» con «Annulla», che annulla
 * l'annullamento e riporta tutto com'era. Restituisce il testo dell'errore, o `null` se è andata bene.
 */
export function useRemove() {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);

  /** `make` riceve il dispositivo e l'istante, e restituisce gli annullamenti da scrivere. */
  async function remove(make: (deviceId: string, now: string) => VoidEvent[], description: string): Promise<string | null> {
    if (busy) return null;
    setBusy(true);
    try {
      const voids = make(await getDeviceId(), new Date().toISOString());
      if (voids.length === 0) return null;
      const written = await appendEvents(voids);
      if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a toglierlo. Riprova.";
      notice.show({ message: `Tolto: ${description}.`, undo: voids });
      return null;
    } catch {
      return "Non sono riuscito a toglierlo. Riprova.";
    } finally {
      setBusy(false);
    }
  }

  return { remove, busy };
}
