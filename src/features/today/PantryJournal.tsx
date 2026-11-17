"use client";

import { useState } from "react";
import type { AnyEvent } from "@/core/events";
import { Button, LedgerRow, Value } from "@/design";
import { buildUndo } from "../actions";
import type { JournalRow } from "../journal";
import ui from "../ui.module.css";
import { useRemove } from "./useRemove";
import styles from "./Today.module.css";

/**
 * Ciò che nel giorno è entrato in dispensa, è stato buttato, aperto, spostato o corretto: il contenuto della riga
 * «Dispensa» del diario. Una riga toccata mostra sotto di sé «Togli» (senza domanda: l'avviso ha «Annulla»), oppure
 * il motivo per cui da qui non si può.
 */
export function PantryJournal({ rows, log }: { rows: readonly JournalRow[]; log: readonly AnyEvent[] }) {
  const { remove, busy } = useRemove();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Una riga può raccontare più eventi uguali (tre confezioni arrivate insieme): si tolgono tutti. */
  async function removeRow(row: JournalRow) {
    const targets = log.filter((e) => row.ids.includes(e.id));
    if (targets.length === 0) return;
    setError(null);
    const failure = await remove((deviceId, now) => buildUndo(targets, { now, deviceId }), row.description);
    if (failure) setError(failure);
    else setOpenId(null);
  }

  return (
    <ul className={styles.list}>
      {rows.map((row) => {
        const open = openId === row.id;
        return (
          <li key={row.id}>
            <div className={styles.entry}>
              <LedgerRow time={row.time} description={row.description} value={row.estimated ? <Value certainty="estimated">{row.value}</Value> : row.value} />
              <button
                type="button"
                className={styles.entryTap}
                aria-label={`${row.time} ${row.description}`}
                aria-expanded={open}
                onClick={() => {
                  setError(null);
                  setOpenId(open ? null : row.id);
                }}
              />
            </div>
            {open ? (
              <div className={styles.entryMore}>
                {row.canUndo ? (
                  <Button variant="text" disabled={busy} onClick={() => void removeRow(row)}>
                    Togli
                  </Button>
                ) : (
                  <p className={ui.hint}>{row.undoBlocked}</p>
                )}
                {error ? (
                  <p className={ui.error} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
