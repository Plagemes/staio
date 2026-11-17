"use client";

import Link from "next/link";
import { useState } from "react";
import { appendEvents, getDeviceId } from "@/data";
import { buildMove } from "../actions";
import { useNotice } from "../notice";
import type { PantryEntry } from "../lots";
import ui from "../ui.module.css";
import { SAVE_LABELS, cookHref, pairHref, saveActions } from "./saveActions";
import styles from "./SaveExpiring.module.css";

interface LinksProps {
  entry: PantryEntry;
  /** Cosa succede toccando «Sposta in freezer»; senza, l'azione non compare. */
  onFreeze: () => void;
  disabled?: boolean;
}

/** Le azioni per salvare un lotto in scadenza, in riga. Non compare se non ce ne sono. */
export function SaveExpiringLinks({ entry, onFreeze, disabled }: LinksProps) {
  const actions = saveActions(entry);
  if (actions.length === 0) return null;
  return (
    <div className={styles.links}>
      {actions.map((action) => {
        switch (action) {
          case "freeze":
            return (
              <button key={action} type="button" className={styles.linkButton} disabled={disabled} onClick={onFreeze}>
                {SAVE_LABELS.freeze}
              </button>
            );
          case "cook":
            return (
              <Link key={action} href={cookHref(entry.lot.productRef)} className={ui.textLink}>
                {SAVE_LABELS.cook}
              </Link>
            );
          case "pair":
            return (
              <Link key={action} href={pairHref(entry.lot.productRef)} className={ui.textLink}>
                {SAVE_LABELS.pair}
              </Link>
            );
        }
      })}
    </div>
  );
}

/**
 * Sotto una riga di «Da mangiare prima» in Oggi: il freezer è un solo tocco, con avviso e «Annulla»
 * (stessa scrittura dello spostamento in Dispensa). Sulle confezioni uguali raggruppate sposta la prima a scadere.
 */
export function SaveExpiringRow({ entry }: { entry: PantryEntry }) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function freeze() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = buildMove(entry.lot, "freezer", { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      notice.show({ message: result.message, undo: result.events });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  if (saveActions(entry).length === 0) return null;
  return (
    <div className={styles.box}>
      <SaveExpiringLinks entry={entry} onFreeze={() => void freeze()} disabled={busy} />
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
