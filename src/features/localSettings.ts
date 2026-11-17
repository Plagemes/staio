"use client";

// Impostazioni locali (per esempio l'obiettivo dell'acqua): stanno nella tabella `settings` dell'archivio,
// quindi «Cancella tutti i dati» le toglie insieme al resto. Si legge `getDb` direttamente perché
// `@/data` non espone ancora un accesso alle impostazioni.
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/data/db";

export async function getSetting(key: string): Promise<unknown> {
  return (await getDb().settings.get(key))?.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().settings.put({ key, value });
}

/** Valore di un'impostazione, aggiornato quando cambia. `ready` è falso finché non è stato letto. */
export function useSetting<T>(key: string, isValid: (value: unknown) => value is T, fallback: T): { value: T; ready: boolean } {
  const [state, setState] = useState<{ value: T; ready: boolean }>({ value: fallback, ready: false });
  useEffect(() => {
    const sub = liveQuery(() => getDb().settings.get(key)).subscribe({
      next: (row) => {
        const stored: unknown = row?.value;
        setState({ value: isValid(stored) ? stored : fallback, ready: true });
      },
      error: () => setState({ value: fallback, ready: true }),
    });
    return () => sub.unsubscribe();
    // isValid e fallback sono costanti del chiamante
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
