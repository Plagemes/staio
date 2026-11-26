"use client";

import { useId, useState } from "react";
import type { Experiment, ExperimentPatch } from "@/core/analysis";
import type { DiaryState } from "@/core/diary";
import type { DayIntake } from "@/core/nutrition";
import { Button } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { ComparisonView } from "./ComparisonView";
import {
  ADHERENCE_CHOICES,
  STATUS_LABELS,
  adherencePatch,
  archivePatch,
  buildExperimentUpdate,
  canCloseEarly,
  closeEarlyPatch,
  experimentStatus,
  measureName,
  progressText,
  referencePeriod,
  renamePatch,
} from "./experimentsView";
import { formatPercent } from "./present";
import styles from "./analysis.module.css";

interface Props {
  experiment: Experiment;
  today: string;
  diary: DiaryState;
  intakeDays: readonly DayIntake[];
}

type Confirming = "close" | "cancel" | null;

export function ExperimentCard({ experiment, today, diary, intakeDays }: Props) {
  const ids = useId();
  const { recordWith, busy } = useRecord();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);
  const [adherence, setAdherence] = useState<string>(experiment.declaredAdherence !== undefined ? String(experiment.declaredAdherence) : "");

  const [titleDraft, setTitleDraft] = useState(experiment.title);
  const [changeDraft, setChangeDraft] = useState(experiment.change);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function onRename() {
    const result = renamePatch(experiment, titleDraft, changeDraft);
    if (!result.ok) {
      setRenameError(Object.values(result.errors)[0] ?? null);
      return;
    }
    setRenameError(null);
    await write(result.patch, "Esperimento aggiornato.");
  }

  const status = experimentStatus(experiment, today);
  const reference = referencePeriod(experiment.startDate, experiment.endDate);

  // Ogni modifica è un evento parziale che dichiara solo il campo che cambia.
  async function write(patch: ExperimentPatch, message: string) {
    const result = await recordWith((deviceId) => ({
      events: [buildExperimentUpdate(experiment.experimentId, patch, { deviceId })],
      message,
    }));
    if (result.ok) {
      setConfirming(null);
      setError(null);
    } else setError(result.error);
    return result.ok;
  }

  async function onClose() {
    const patch = closeEarlyPatch(experiment, today);
    if (!patch) return;
    await write(patch, `Esperimento «${experiment.title}» concluso oggi.`);
  }

  async function onCancel() {
    await write(archivePatch(), `Esperimento «${experiment.title}» annullato.`);
  }

  async function onAdherence() {
    const value = adherence === "" ? undefined : Number(adherence);
    await write(adherencePatch(value), "Aderenza salvata.");
  }

  const panelId = `${ids}-panel`;
  return (
    <li className={styles.experiment}>
      <div className={styles.rowHead}>
        <h3 className={styles.experimentTitle}>{experiment.title}</h3>
        <span className={status === "ongoing" ? styles.tagAccent : styles.tag}>{STATUS_LABELS[status]}</span>
      </div>
      <p className={ui.paragraph}>
        <strong>Cosa cambia:</strong> {experiment.change}
      </p>
      <p className={styles.basis}>
        {formatCalendarDate(experiment.startDate)} – {formatCalendarDate(experiment.endDate)} · {progressText(experiment, today)}
      </p>
      {experiment.closedEarly ? (
        <p className={styles.basis}>
          Concluso in anticipo: era previsto fino al {formatCalendarDate(experiment.plannedEndDate)}.
        </p>
      ) : null}
      <p className={styles.basis}>
        Misure: {experiment.measures.map(measureName).join(", ")}. Riferimento: {formatCalendarDate(reference.from)} – {formatCalendarDate(reference.to)}.
      </p>
      {experiment.excludedFoods.length > 0 ? <p className={styles.basis}>Alimenti esclusi: {experiment.excludedFoods.join(", ")}</p> : null}
      {experiment.declaredAdherence !== undefined ? (
        <p className={styles.basis}>Aderenza dichiarata: {formatPercent(experiment.declaredAdherence)}</p>
      ) : null}

      <div className={ui.row}>
        <Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          {open ? "Nascondi il confronto" : "Vedi il confronto"}
        </Button>
      </div>
      <div id={panelId} hidden={!open}>
        {open ? <ComparisonView experiment={experiment} diary={diary} intakeDays={intakeDays} today={today} /> : null}
      </div>

      {status !== "upcoming" ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-adh`}>
            Quanto l&apos;hai seguito? <span className={ui.optional}>(facoltativo)</span>
          </label>
          <div className={ui.row}>
            <select id={`${ids}-adh`} className={`${ui.input} ${styles.grow}`} value={adherence} onChange={(e) => setAdherence(e.target.value)}>
              <option value="">Non lo dichiaro</option>
              {ADHERENCE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({formatPercent(c.value)})
                </option>
              ))}
            </select>
            <Button variant="outline" disabled={busy} onClick={onAdherence}>
              Salva
            </Button>
          </div>
          <p className={ui.hint}>Sotto l&apos;80% il confronto resta poco affidabile.</p>
        </div>
      ) : null}

      <details>
        <summary className={styles.summary}>Cambia titolo o descrizione</summary>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-title`}>
            Titolo
          </label>
          <input id={`${ids}-title`} className={ui.input} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-change`}>
            Cosa cambia
          </label>
          <input id={`${ids}-change`} className={ui.input} value={changeDraft} onChange={(e) => setChangeDraft(e.target.value)} />
        </div>
        {renameError ? (
          <p className={ui.error} role="alert">
            {renameError}
          </p>
        ) : null}
        <div className={ui.row}>
          <Button variant="outline" disabled={busy} onClick={onRename}>
            Salva
          </Button>
        </div>
      </details>

      {confirming === "close" ? (
        <div className={styles.confirm} role="group" aria-label="Conferma la chiusura">
          <p>
            Concludere «{experiment.title}» oggi? Il confronto userà i giorni fino a oggi e il periodo di riferimento si accorcerà della stessa durata. Potrai
            annullare subito dopo.
          </p>
          <div className={ui.row}>
            <button type="button" className={ui.dangerSolid} disabled={busy} onClick={onClose}>
              Concludi oggi
            </button>
            <Button variant="text" onClick={() => setConfirming(null)}>
              Non ora
            </Button>
          </div>
        </div>
      ) : null}
      {confirming === "cancel" ? (
        <div className={styles.confirm} role="group" aria-label="Conferma: togli l'esperimento">
          <p>
            Togliere «{experiment.title}»? Scompare dall&apos;elenco e dal confronto; i dati registrati nel diario restano. Potrai tornare indietro subito dopo
            con «Annulla».
          </p>
          <div className={ui.row}>
            <button type="button" className={ui.dangerSolid} disabled={busy} onClick={onCancel}>
              Togli l&apos;esperimento
            </button>
            <Button variant="text" onClick={() => setConfirming(null)}>
              Non ora
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {confirming === null ? (
        <div className={ui.row}>
          {canCloseEarly(experiment, today) ? (
            <button type="button" className={ui.danger} onClick={() => setConfirming("close")}>
              Concludi oggi
            </button>
          ) : null}
          <button type="button" className={ui.danger} onClick={() => setConfirming("cancel")}>
            Togli l&apos;esperimento
          </button>
        </div>
      ) : null}
    </li>
  );
}
