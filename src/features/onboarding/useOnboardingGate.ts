"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isStorageAvailable } from "@/design";
import { useEventLog, useSetting } from "@/data";
import { isStyleChoicePath } from "../settings/firstRunStyle";
import { PROFILE_SETTING_KEY, isNutritionProfile } from "../nutrition/profile";
import { RECIPE_PREFS_KEY, readPrefs } from "../recipes/prefs";
import { decideOnboarding } from "./logic";
import { markOnboardingDone, readOnboardingRaw, subscribeOnboarding } from "./store";

const subscribeNothing = () => () => {};
const readOnServer = () => undefined;
let storageOkCache: boolean | undefined;
const readStorageOk = () => (storageOkCache ??= isStorageAvailable());

/**
 * Decide sul client se proporre il percorso d'ingresso. Sul server e al primo disegno vale «no».
 * Una volta partito resta acceso fino a «fine» anche se nel frattempo compaiono dei dati (allergeni, profilo):
 * li ha scritti lui stesso.
 */
export function useOnboardingGate(pathname: string): { show: boolean; close: () => void } {
  const log = useEventLog();
  const profile = useSetting<unknown>(PROFILE_SETTING_KEY);
  const prefs = useSetting<unknown>(RECIPE_PREFS_KEY);
  const raw = useSyncExternalStore<string | null | undefined>(subscribeOnboarding, readOnboardingRaw, readOnServer);
  const storageOk = useSyncExternalStore(subscribeNothing, readStorageOk, () => false);
  const [latched, setLatched] = useState(false);

  const saved = readPrefs(prefs.data);
  const hasData =
    (log.data?.length ?? 0) > 0 ||
    isNutritionProfile(profile.data) ||
    saved.allergens.length + saved.excludedFoods.length > 0;

  const decision = decideOnboarding({
    pathname,
    raw,
    storageOk,
    existing: { loading: log.loading || profile.loading || prefs.loading, error: log.error ?? profile.error ?? prefs.error, hasData },
  });

  if (decision === "offer" && !latched) setLatched(true);

  useEffect(() => {
    if (decision === "skip-mark" && !latched) markOnboardingDone();
  }, [decision, latched]);

  function close(start?: Parameters<typeof markOnboardingDone>[0]) {
    markOnboardingDone(start);
    setLatched(false);
  }

  return { show: latched && isStyleChoicePath(pathname), close };
}
