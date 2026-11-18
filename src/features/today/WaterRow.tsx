"use client";

import { useState } from "react";
import type { AnyEvent } from "@/core/events";
import { Button, Label } from "@/design";
import { buildUndo } from "../actions";
import { formatMl } from "../health";
import { WaterCard } from "../health/WaterCard";
import ui from "../ui.module.css";
import type { WaterGlass } from "./dayRows";
import { entryElementId } from "./reveal";
import { useRemove } from "./useRemove";
import styles from "./Today.module.css";

/**
 * Il contenuto della riga «Acqua» del diario. Per oggi i comandi dell'acqua (senza scheda: stanno dentro una riga) e
 * sotto «Oggi» i bicchieri, dal più recente, ognuno con «Togli». Per un giorno passato solo i bicchieri.
 */
export function WaterRow({ glasses, log, controls }: { glasses: readonly WaterGlass[]; log: readonly AnyEvent[]; controls: boolean }) {
  const { remove, busy } = useRemove();
  const [error, setError] = useState<string | null>(null);

  async function removeGlass(glass: WaterGlass) {
    const event = log.find((e) => e.id === glass.eventId);
    if (!event) return;
    setError(null);
    const failure = await remove((deviceId, now) => buildUndo([event], { deviceId, now }), `${formatMl(glass.ml)} di acqua`);
    if (failure) setError(failure);
  }

  return (
    <div className={styles.rowContent}>
      {controls ? <WaterCard plain /> : null}
      {glasses.length > 0 ? (
        <div className={styles.entries}>
          {controls ? <Label>Oggi</Label> : null}
          <ul className={styles.lines}>
            {glasses.map((g) => (
              <li key={g.eventId} id={entryElementId(g.eventId)} className={styles.line}>
                <span className={styles.lineText}>{g.text}</span>
                <Button variant="text" disabled={busy} onClick={() => void removeGlass(g)}>
                  Togli
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
