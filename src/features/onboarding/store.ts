"use client";

// Memoria dell'introduzione nella copia locale del telefono. Un solo valore, con ascoltatori per la stessa pagina.
import { ONBOARDING_STORAGE_KEY, parseOnboarding, serializeOnboarding, type OnboardingMemory } from "./logic";

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

/**
 * Fatto o saltato: non si ripropone. Con `since` (il giorno di oggi) comincia anche la settimana di «Primi passi», e
 * l'eventuale «Lascia così» di prima non vale più. Senza `since` (chi aveva già dei dati) si tiene ciò che c'era.
 */
export function markOnboardingDone(since?: string): void {
  const current = readOnboarding();
  if (since !== undefined) {
    write({ phase: "done", since });
    return;
  }
  write({ phase: "done", ...(current.since ? { since: current.since } : {}), ...(current.stepsHidden ? { stepsHidden: true } : {}) });
}

/** «Lascia così» in «Primi passi»: le righe non tornano. */
export function hideFirstSteps(): void {
  write({ ...readOnboarding(), stepsHidden: true });
}

/** «Rifai l'introduzione»: alla prossima apertura di Oggi riparte, anche con dei dati; i sette giorni si rinnovano alla fine. */
export function requestOnboardingRedo(): void {
  write({ phase: "redo" });
}
