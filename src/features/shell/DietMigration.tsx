"use client";

import { useEffect } from "react";
import { appendEvents, getAllEvents, getDeviceId } from "@/data";
import { legacyOf } from "../allergens";
import { getSetting, setSetting } from "../localSettings";
import { DIET_MERGED_NOTICE_KEY, DIET_MIGRATION_KEY, dietDeclarationsMigration } from "../migrations";
import { RECIPE_PREFS_KEY } from "../recipes/prefs";

let started = false;

/**
 * Una sola volta: allergeni ed esclusioni scritti nel ricettario e nel piano diventano dichiarazioni. Se uno dei due
 * posti non si legge non si scrive e non si segna: si riprova alla prossima apertura. Non rende niente.
 */
export function DietMigration() {
  useEffect(() => {
    if (started) return;
    started = true;
    void (async () => {
      try {
        if ((await getSetting(DIET_MIGRATION_KEY)) === true) return;
        const events = await getAllEvents();
        let rawPrefs: unknown;
        try {
          rawPrefs = await getSetting<unknown>(RECIPE_PREFS_KEY);
        } catch {
          started = false;
          return;
        }
        const legacy = legacyOf(events, rawPrefs);
        if (legacy.recipePrefs === "unreadable" || legacy.planStructure === "unreadable") {
          started = false;
          return;
        }
        const adds = dietDeclarationsMigration(events, legacy, { now: new Date().toISOString(), deviceId: await getDeviceId() });
        if (adds.length > 0) {
          const written = await appendEvents(adds);
          if (written.rejected.length > 0) {
            started = false;
            return;
          }
          await setSetting(DIET_MERGED_NOTICE_KEY, false);
        }
        await setSetting(DIET_MIGRATION_KEY, true);
      } catch {
        started = false;
      }
    })();
  }, []);
  return null;
}
