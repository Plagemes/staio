"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Location } from "@/core/ledger";
import { Button } from "@/design";
import type { RemoveManyKind } from "../actions";
import { LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import ui from "../ui.module.css";
import { packsText } from "./selectionActions";
import styles from "./Pantry.module.css";

interface SelectionBarProps {
  count: number;
  /** Quanti prodotti diversi tra le confezioni scelte. */
  products: number;
  busy: boolean;
  error: string | null;
  onRemove: (kind: RemoveManyKind) => void;
  onMove: (to: Location) => void;
  onAddToList: () => void;
  /** Si cambia passo: l'errore di prima non vale più. */
  onClearError: () => void;
}

const countText = (n: number, products: number) => (products > 1 ? `${packsText(n)} di ${products} prodotti` : packsText(n));

type Step = "main" | "move" | "remove";

/**
 * Barra in basso della modalità «Seleziona»: il numero degli alimenti scelti e tre comandi. «Sposta» e «Elimina» hanno
 * un passo breve con una sola conferma; «Aggiungi alla spesa» scrive subito.
 */
export function SelectionBar({ count, products, busy, error, onRemove, onMove, onAddToList, onClearError }: SelectionBarProps) {
  const ids = useId();
  const [step, setStep] = useState<Step>("main");
  const [kind, setKind] = useState<RemoveManyKind | null>(null);
  const [to, setTo] = useState<Location | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // cambiando passo la tastiera e il lettore dello schermo ripartono dall'inizio del passo (legenda o primo comando)
  useEffect(() => {
    if (!moved.current) return;
    root.current?.querySelector<HTMLElement>("legend, button:not(:disabled)")?.focus();
  }, [step]);
  const go = (next: Step) => {
    moved.current = true;
    onClearError();
    setStep(next);
  };

  return (
    <div ref={root} className={styles.bar} role="region" aria-label="Alimenti scelti">
      {step === "move" && count > 0 ? (
        <div className={styles.barChoice}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel} tabIndex={-1}>Sposta {countText(count, products)}</legend>
            <div className={ui.choices}>
              {LOCATION_ORDER.map((place) => (
                <label key={place} className={ui.choice}>
                  <input type="radio" name={`${ids}-to`} checked={to === place} onChange={() => setTo(place)} />
                  <span>{LOCATION_LABELS[place]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={ui.row}>
            <Button disabled={busy || to === null} onClick={() => to && onMove(to)}>
              {`Sposta ${packsText(count)}`}
            </Button>
            <Button variant="text" disabled={busy} onClick={() => go("main")}>
              Indietro
            </Button>
          </div>
        </div>
      ) : step === "remove" && count > 0 ? (
        <div className={styles.barChoice}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel} tabIndex={-1}>Elimina {countText(count, products)}</legend>
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
              {`Elimina ${packsText(count)}`}
            </Button>
            <Button variant="text" disabled={busy} onClick={() => go("main")}>
              Indietro
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.barMain}>
          <span className={styles.barCount} aria-live="polite">
            {countText(count, products)}
          </span>
          <div className={styles.barActions}>
            <Button disabled={count === 0 || busy} onClick={() => go("move")}>
              Sposta
            </Button>
            <Button variant="outline" disabled={count === 0 || busy} onClick={onAddToList}>
              Aggiungi alla spesa
            </Button>
            <button type="button" className={styles.barDanger} disabled={count === 0 || busy} onClick={() => go("remove")}>
              Elimina
            </button>
          </div>
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
