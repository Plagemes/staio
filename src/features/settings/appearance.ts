"use client";

import { useSyncExternalStore } from "react";
import { setSetting, useSetting } from "@/data";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_SETTING_KEY,
  SYSTEM_DARK_QUERY,
  THEME_SETTING_KEY,
  applyTheme,
  isThemeId,
  isThemeMode,
  readStoredChoice,
  writeStoredChoice,
  type ThemeChoice,
} from "@/design";

/** Tema e modalità salvati in archivio (preferenza del dispositivo, esportata con le altre impostazioni non riservate). */
export function useAppearance(): { choice: ThemeChoice; ready: boolean } {
  const theme = useSetting<unknown>(THEME_SETTING_KEY);
  const mode = useSetting<unknown>(MODE_SETTING_KEY);
  return {
    choice: {
      theme: isThemeId(theme.data) ? theme.data : DEFAULT_THEME,
      mode: isThemeMode(mode.data) ? mode.data : DEFAULT_MODE,
    },
    ready: !theme.loading && !mode.loading,
  };
}

/** Applica subito, aggiorna la copia sincrona per il prossimo avvio (con il segno di stile scelto), poi salva in archivio. */
export async function chooseAppearance(patch: Partial<ThemeChoice>): Promise<void> {
  const next = { ...readStoredChoice(), ...patch };
  applyTheme(next);
  writeStoredChoice(next, { chosen: true });
  if (patch.theme) await setSetting(THEME_SETTING_KEY, next.theme);
  if (patch.mode) await setSetting(MODE_SETTING_KEY, next.mode);
}

function subscribeSystemDark(onChange: () => void): () => void {
  const mq = window.matchMedia(SYSTEM_DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemDark,
    () => window.matchMedia(SYSTEM_DARK_QUERY).matches,
    () => false,
  );
}
