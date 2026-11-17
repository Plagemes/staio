"use client";

import { useEffect, useLayoutEffect } from "react";
import { SYSTEM_DARK_QUERY, applyTheme, readStoredChoice, writeStoredChoice } from "@/design";
import { useAppearance } from "./appearance";

/**
 * Tiene allineati archivio, copia sincrona (localStorage) e documento. Il primo disegno lo ha già fatto lo script in <head>;
 * qui si gestiscono i cambi che arrivano dopo: importazione delle impostazioni, cancellazione dei dati, preferenza del sistema.
 */
export function ThemeSync() {
  const {
    choice: { theme, mode },
    ready,
  } = useAppearance();

  // Riapplica la copia locale: in sviluppo React, rimontando, azzera gli attributi che lo script aveva messo sulla radice.
  useLayoutEffect(() => {
    applyTheme(readStoredChoice());
  }, []);

  useEffect(() => {
    if (!ready) return;
    const choice = { theme, mode };
    writeStoredChoice(choice);
    applyTheme(choice);
  }, [ready, theme, mode]);

  useEffect(() => {
    const mq = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = () => applyTheme(readStoredChoice());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return null;
}
