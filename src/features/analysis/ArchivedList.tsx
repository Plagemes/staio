"use client";

import { useState } from "react";
import type { Experiment } from "@/core/analysis";
import { Button } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { buildExperimentUpdate, measureName, restorePatch } from "./experimentsView";
import { plural } from "./present";
import styles from "./analysis.module.css";

/** Esperimenti annullati: in una sezione a parte, chiusa. Si possono ripristinare (un nuovo evento, annullabile). */
export function ArchivedList({ experiments }: { experiments: readonly Experiment[] }) {
  const { recordWith, busy } = useRecord();
  const [error, setError] = useState<string | null>(null);

  async function restore(e: Experiment) {
    const result = await recordWith((deviceId) => ({
      events: [buildExperimentUpdate(e.experimentId, restorePatch(), { deviceId })],
      message: `Esperimento «${e.title}» ripristinato.`,
    }));
    setError(result.ok ? null : result.error);
  }

  return (
    <details className={ui.section}>
      <summary className={styles.summary}>
        {plural(experiments.length, "esperimento annullato", "esperimenti annullati")}
      </summary>
      <ul className={styles.rows}>
        {experiments.map((e) => (
          <li key={e.experimentId} className={styles.rowItem}>
            <span className={styles.rowName}>{e.title}</span>
            <p className={styles.basis}>
              {formatCalendarDate(e.startDate)} – {formatCalendarDate(e.endDate)} · {e.measures.map(measureName).join(", ")}
            </p>
            <p className={styles.note}>Cosa cambiava: {e.change}</p>
            <div className={ui.row}>
              <Button variant="outline" disabled={busy} onClick={() => restore(e)}>
                Ripristina
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
