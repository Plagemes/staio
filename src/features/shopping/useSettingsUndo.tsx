"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./shopping.module.css";

interface Change {
  message: string;
  /** Valori di prima, per chiave: «Annulla» li rimette. */
  previous: Record<string, unknown>;
}

const VISIBLE_MS = 15_000;

/**
 * «Annulla» per le scelte che stanno nelle impostazioni locali (rifiuti, quantità, aggiunte a mano):
 * non sono eventi del registro, quindi l'avviso generale non le annulla.
 */
export function useSettingsUndo(save: (key: string, value: unknown) => Promise<boolean>) {
  const [change, setChange] = useState<Change | null>(null);

  useEffect(() => {
    if (!change) return;
    const timer = window.setTimeout(() => setChange(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [change]);

  const apply = useCallback(
    async (message: string, next: Record<string, unknown>, previous: Record<string, unknown>): Promise<boolean> => {
      for (const [key, value] of Object.entries(next)) {
        if (!(await save(key, value))) {
          setChange({ message: "Non sono riuscito a salvare sul telefono. Riprova.", previous: {} });
          return false;
        }
      }
      setChange({ message, previous });
      return true;
    },
    [save],
  );

  const undo = useCallback(async () => {
    if (!change) return;
    const { previous } = change;
    setChange(null);
    for (const [key, value] of Object.entries(previous)) await save(key, value);
    setChange({ message: "Annullato.", previous: {} });
  }, [change, save]);

  const node = change ? (
    <div className={styles.undo} role="status" aria-live="polite">
      <span>{change.message}</span>
      {Object.keys(change.previous).length > 0 ? (
        <button type="button" className={styles.undoButton} onClick={() => void undo()}>
          Annulla
        </button>
      ) : null}
    </div>
  ) : null;

  return { apply, node };
}
