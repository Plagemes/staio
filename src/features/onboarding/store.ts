"use client";

// Memoria del percorso d'ingresso nella copia locale del telefono. Un solo valore, con ascoltatori per la stessa pagina.
import {
  ONBOARDING_STORAGE_KEY,
  parseOnboarding,
  serializeOnboarding,
  type OnboardingMemory,
  type StartChoice,
} from "./logic";

const listeners = new Set<() => void>();
/** «Fatto» tenuto anche in memoria: se la copia locale non si scrive, il percorso si chiude lo stesso fino al ricaricamento. */
let sessionDone: OnboardingMemory | null = null;

export function subscribeOnboarding(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Testo grezzo salvato (stabile tra due letture uguali, come vuole useSyncExternalStore). */
export function readOnboardingRaw(): string | null {
  if (sessionDone) return serializeOnboarding(sessionDone);
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readOnboarding(): OnboardingMemory {
  return parseOnboarding(readOnboardingRaw());
}

function write(memory: OnboardingMemory): void {
  sessionDone = memory.phase === "done" ? memory : null;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, serializeOnboarding(memory));
  } catch {
    // copia locale non disponibile: il percorso non viene più proposto da solo (vedi decideOnboarding)
  }
  listeners.forEach((l) => l());
}

/** Fatto o saltato: non si ripropone. Se si sa dove si voleva cominciare, lo si ricorda. */
export function markOnboardingDone(start?: StartChoice): void {
  const current = readOnboarding();
  const keep = start ?? current.start;
  write(keep ? { phase: "done", start: keep } : { phase: "done" });
}

/** «Rifai l'introduzione»: alla prossima apertura di Oggi il percorso riparte, anche con dei dati. */
export function requestOnboardingRedo(): void {
  const current = readOnboarding();
  write(current.start ? { phase: "redo", start: current.start } : { phase: "redo" });
}
