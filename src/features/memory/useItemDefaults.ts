"use client";

import { useCallback } from "react";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { ITEM_DEFAULTS_KEY, withItemDefault, type ItemDefault } from "./itemDefaults";

const isMemory = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const EMPTY: Record<string, unknown> = {};

/** La memoria per nome, aggiornata quando cambia, e il modo di ricordare una scelta. Scrivere non lancia mai. */
export function useItemDefaults(): { memory: Record<string, unknown>; remember: (value: Omit<ItemDefault, "at">) => Promise<void> } {
  const { value } = useSetting(ITEM_DEFAULTS_KEY, isMemory, EMPTY);
  const remember = useCallback(async (item: Omit<ItemDefault, "at">) => {
    try {
      // si rilegge al momento di scrivere: un'altra scheda può aver ricordato qualcosa nel frattempo
      const current = await getSetting(ITEM_DEFAULTS_KEY);
      await setSetting(ITEM_DEFAULTS_KEY, withItemDefault(current, item, new Date().toISOString()));
    } catch {
      // la memoria è un aiuto: se non si scrive, il salvataggio dell'alimento resta valido
    }
  }, []);
  return { memory: value, remember };
}
