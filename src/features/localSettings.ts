"use client";

// Impostazioni locali (per esempio l'obiettivo dell'acqua): stanno nella tabella `settings` dell'archivio,
// quindi «Cancella tutti i dati» le toglie insieme al resto. L'accesso passa da `@/data`.
import { getSetting, setSetting, useSetting as useStoredSetting } from "@/data";

export { getSetting, setSetting };

/** Valore di un'impostazione, aggiornato quando cambia. `ready` è falso finché non è stato letto. */
export function useSetting<T>(key: string, isValid: (value: unknown) => value is T, fallback: T): { value: T; ready: boolean } {
  const live = useStoredSetting<unknown>(key);
  const stored = live.data;
  return { value: !live.loading && isValid(stored) ? stored : fallback, ready: !live.loading };
}
