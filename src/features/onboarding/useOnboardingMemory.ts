"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseOnboarding, type OnboardingMemory } from "./logic";
import { readOnboardingRaw, subscribeOnboarding } from "./store";

const readOnServer = () => undefined;

/** La memoria dell'introduzione; `undefined` finché non è stata letta (server, primo disegno). */
export function useOnboardingMemory(): OnboardingMemory | undefined {
  const raw = useSyncExternalStore<string | null | undefined>(subscribeOnboarding, readOnboardingRaw, readOnServer);
  return useMemo(() => (raw === undefined ? undefined : parseOnboarding(raw)), [raw]);
}
