"use client";

import { useId, useState } from "react";
import { Button } from "@/design";
import type { RemoveManyKind } from "../actions";
import ui from "../ui.module.css";
import styles from "./Pantry.module.css";

interface SelectionBarProps {
  count: number;
  busy: boolean;
  error: string | null;
  onRemove: (kind: RemoveManyKind) => void;
}

const countText = (n: number) => (n === 1 ? "1 selezionato" : `${n} selezionati`);

/** Barra in basso della modalità «Seleziona»: il numero degli alimenti scelti, poi la scelta breve e una sola conferma. */
export function SelectionBar({ count, busy, error, onRemove }: SelectionBarProps) {
  const ids = useId();
  const [choosing, setChoosing] = useState(false);
  const [kind, setKind] = useState<RemoveManyKind | null>(null);

  return (
    <div className={styles.bar} role="region" aria-label="Elimina gli alimenti scelti">
      {choosing && count > 0 ? (
        <div className={styles.barChoice}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Elimina {count === 1 ? "1 alimento" : `${count} alimenti`}</legend>
            <div className={ui.choices}>
              <label className={ui.choice}>
                <input type="radio" name={`${ids}-kind`} checked={kind === "mistaken"} onChange={() => setKind("mistaken")} />
                <span>Inseriti per sbaglio</span>
              </label>
              <label className={ui.choice}>
                <input type="radio" name={`${ids}-kind`} checked={kind === "finished"} onChange={() => setKind("finished")} />
                <span>Finiti</span>
              </label>
            </div>
            <p className={ui.hint}>
              {kind === "mistaken"
                ? "Li tolgo come se non li avessi mai aggiunti, senza contarli come acquisto, spreco o spesa."
                : kind === "finished"
                  ? "Li segno finiti, senza contarli come spreco."
                  : "Per segnare qualcosa come buttato, aprilo dalla sua scheda."}
            </p>
          </fieldset>
          <div className={ui.row}>
            <Button disabled={busy || kind === null} onClick={() => kind && onRemove(kind)}>
              {count === 1 ? "Elimina 1 alimento" : `Elimina ${count} alimenti`}
            </Button>
            <Button variant="text" disabled={busy} onClick={() => setChoosing(false)}>
              Indietro
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.barMain}>
          <span className={styles.barCount} aria-live="polite">
            {countText(count)}
          </span>
          <Button disabled={count === 0} onClick={() => setChoosing(true)}>
            Elimina
          </Button>
        </div>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
