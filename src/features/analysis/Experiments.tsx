"use client";

import { useMemo, useState } from "react";
import { deriveExperiments } from "@/core/analysis";
import { useEventLog } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { ExperimentCard } from "./ExperimentCard";
import { ArchivedList } from "./ArchivedList";
import { ExperimentForm } from "./ExperimentForm";
import { anomalyText, splitExperiments } from "./experimentsView";
import { AnalysisDisclaimer } from "./shared";
import { useAnalysisBase } from "./useAnalysisBase";
import styles from "./analysis.module.css";

export function Experiments() {
  const { diary, intakeDays, today, error, ready } = useAnalysisBase();
  const log = useEventLog();
  const [creating, setCreating] = useState(false);
  const state = useMemo(() => (log.data ? deriveExperiments(log.data) : undefined), [log.data]);
  const groups = useMemo(() => (state && today ? splitExperiments(state.experiments, today) : undefined), [state, today]);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Esperimenti</h1>
        <Label>Confronti</Label>
      </div>
      <p className={ui.lead}>
        Cambi una cosa per un periodo e guardi alcune misure. Il confronto è con i giorni immediatamente prima, di pari durata: dice se la differenza si distingue
        dalla variabilità abituale dei tuoi dati, non perché ci sia.
      </p>
      <AnalysisDisclaimer />

      {error || log.error ? <StorageError /> : null}
      {!error && !log.error && (!ready || !groups || !diary || !intakeDays || !today) ? <LoadingLine text="Apro gli esperimenti…" /> : null}

      {groups && diary && intakeDays && today ? (
        <>
          {creating ? (
            <section className={ui.section}>
              <SectionHeader label="Nuovo esperimento" />
              <div className={styles.card}>
                <ExperimentForm today={today} onDone={() => setCreating(false)} />
              </div>
            </section>
          ) : (
            <div className={ui.row}>
              <Button onClick={() => setCreating(true)}>Nuovo esperimento</Button>
            </div>
          )}

          <section className={ui.section}>
            <SectionHeader label="In corso e programmati" />
            {groups.active.length === 0 ? (
              <p className={ui.hint}>Nessun esperimento in corso. Un esperimento ha senso se cambi una sola cosa alla volta.</p>
            ) : (
              <ul className={styles.rows}>
                {groups.active.map((e) => (
                  <ExperimentCard key={e.experimentId} experiment={e} today={today} diary={diary} intakeDays={intakeDays} />
                ))}
              </ul>
            )}
          </section>

          <section className={ui.section}>
            <SectionHeader label="Conclusi" />
            {groups.ended.length === 0 ? (
              <p className={ui.hint}>Nessun esperimento concluso.</p>
            ) : (
              <ul className={styles.rows}>
                {groups.ended.map((e) => (
                  <ExperimentCard key={e.experimentId} experiment={e} today={today} diary={diary} intakeDays={intakeDays} />
                ))}
              </ul>
            )}
          </section>
          {state && state.archived.length > 0 ? <ArchivedList experiments={state.archived} /> : null}
          {state && state.anomalies.length > 0 ? (
            <div role="status">
              {state.anomalies.map((a, i) => (
                <p key={`${a.code}-${a.eventId ?? a.experimentId ?? i}`} className={ui.hint}>
                  {anomalyText(a, (id) => [...state.experiments, ...state.archived].find((e) => e.experimentId === id)?.title)}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
