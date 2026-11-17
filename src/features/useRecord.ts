"use client";

import { useState } from "react";
import { InvalidDiaryEventError, type DiaryEventOptions } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { appendEvents, getDeviceId } from "@/data";
import { useNotice } from "./notice";

export type RecordResult = { ok: true } | { ok: false; error: string };

/**
 * Scrive nuovi eventi e mostra la conferma con «Annulla». Gli errori tornano a chi chiama,
 * che li mostra accanto al campo: il core rifiuta i valori implausibili.
 */
export function useRecord() {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);

  /** `build` riceve il dispositivo e restituisce gli eventi e il testo della conferma. */
  async function recordWith(build: (deviceId: string) => { events: AnyEvent[]; message: string }): Promise<RecordResult> {
    if (busy) return { ok: false, error: "Un attimo, sto ancora salvando." };
    setBusy(true);
    try {
      const { events, message } = build(await getDeviceId());
      const written = await appendEvents(events);
      if (written.added === 0 || written.rejected.length > 0) return { ok: false, error: "Non sono riuscito a salvare. Riprova." };
      notice.show({ message, undo: events });
      return { ok: true };
    } catch (e) {
      if (e instanceof InvalidDiaryEventError) return { ok: false, error: "Questo valore non è accettabile: controlla il numero." };
      return { ok: false, error: "Non sono riuscito a salvare sul telefono. Riprova." };
    } finally {
      setBusy(false);
    }
  }

  async function record(build: (options: DiaryEventOptions) => AnyEvent[], message: string): Promise<RecordResult> {
    return recordWith((deviceId) => ({ events: build({ deviceId }), message }));
  }

  return { record, recordWith, busy };
}
