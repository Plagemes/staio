"use client";

import { useEffect } from "react";
import { appendEvents, getAllEvents, getDeviceId } from "@/data";
import { getSetting, setSetting } from "../localSettings";
import { BARCODE_MIGRATION_KEY, legacyBarcodeUpdates } from "../migrations";

let started = false;

/**
 * Una sola volta all'avvio: i lotti vecchi, nati prima del campo `barcode`, hanno il codice solo nella nota.
 * Si scrive il campo e si segna nelle impostazioni locali che è fatto. Se qualcosa va storto non si segna,
 * e si riprova al prossimo avvio. Non rende niente.
 */
export function BarcodeMigration() {
  useEffect(() => {
    if (started) return;
    started = true;
    void (async () => {
      try {
        if ((await getSetting(BARCODE_MIGRATION_KEY)) === true) return;
        const updates = legacyBarcodeUpdates(await getAllEvents(), { now: new Date().toISOString(), deviceId: await getDeviceId() });
        if (updates.length > 0) {
          const written = await appendEvents(updates);
          if (written.rejected.length > 0) return;
        }
        await setSetting(BARCODE_MIGRATION_KEY, true);
      } catch {
        started = false;
      }
    })();
  }, []);
  return null;
}
