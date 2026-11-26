"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isStorageAvailable } from "@/design";
import { useEventLog, useSetting } from "@/data";
import { dayOf } from "../format";
import { isStyleChoicePath } from "../settings/firstRunStyle";
import { PROFILE_SETTING_KEY, isNutritionProfile } from "../nutrition/profile";
import { useDietDeclarations } from "../allergens";
import { decideOnboarding } from "./logic";
import { markOnboardingDone, readOnboardingRaw, subscribeOnboarding } from "./store";

const subscribeNothing = () => () => {};
const readOnServer = () => undefined;
let storageOkCache: boolean | undefined;
const readStorageOk = () => (storageOkCache ??= isStorageAvailable());

/**
 * Decide sul client se proporre l'introduzione. Sul server e al primo disegno vale «no».
 * Una volta partito resta acceso fino a «fine» anche se nel frattempo compaiono dei dati (allergeni, profilo):
 * li ha scritti lui stesso.
 */
export function useOnboardingGate(pathname: string): { show: boolean; close: () => void } {
  const log = useEventLog();
  const profile = useSetting<unknown>(PROFILE_SETTING_KEY);
  const diet = useDietDeclarations();
  const raw = useSyncExternalStore<string | null | undefined>(subscribeOnboarding, readOnboardingRaw, readOnServer);
  const storageOk = useSyncExternalStore(subscribeNothing, readStorageOk, () => false);
  const [latched, setLatched] = useState(false);

  const declared = diet.state ? diet.state.allergens.length + diet.state.excludedFoods.length : 0;
  const hasData = (log.data?.length ?? 0) > 0 || isNutritionProfile(profile.data) || declared > 0;

  const decision = decideOnboarding({
    pathname,
    raw,
    storageOk,
    existing: { loading: log.loading || profile.loading || (!diet.ready && diet.error === undefined), error: log.error ?? profile.error ?? diet.error ?? (diet.state && !diet.state.complete ? "incomplete" : undefined), hasData },
  });

  if (decision === "offer" && !latched) setLatched(true);

  useEffect(() => {
    if (decision === "skip-mark" && !latched) markOnboardingDone();
  }, [decision, latched]);

  function close() {
    markOnboardingDone(dayOf(new Date().toISOString()));
    setLatched(false);
  }

  return { show: latched && isStyleChoicePath(pathname), close };
}
