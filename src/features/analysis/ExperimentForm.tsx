"use client";

import { useId, useState, type FormEvent } from "react";
import type { ExperimentMeasure } from "@/core/analysis";
import { Button, cx } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import {
  MEASURE_CHOICES,
  buildExperimentEvent,
  emptyExperimentForm,
  measureChoiceLabel,
  parseExperimentForm,
  referencePeriod,
  type ExperimentFormField,
  type ExperimentFormValues,
} from "./experimentsView";
import { isCalendarDate } from "@/core/ledger";
import styles from "./analysis.module.css";

interface Props {
  today: string;
  onDone: () => void;
}

export function ExperimentForm({ today, onDone }: Props) {
  const ids = useId();
  const { recordWith, busy } = useRecord();
  const [values, setValues] = useState<ExperimentFormValues>(() => emptyExperimentForm(today));
  const [errors, setErrors] = useState<Partial<Record<ExperimentFormField, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = <K extends keyof ExperimentFormValues>(key: K, value: ExperimentFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function toggleMeasure(m: ExperimentMeasure) {
    set("measures", values.measures.includes(m) ? values.measures.filter((x) => x !== m) : [...values.measures, m]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const read = parseExperimentForm(values, today);
    if (!read.ok) {
      setErrors(read.errors);
      return;
    }
    const result = await recordWith((deviceId) => ({
      events: [buildExperimentEvent(read.body, { deviceId })],
      message: `Esperimento «${read.body.title}» creato.`,
    }));
    if (result.ok) onDone();
    else setSaveError(result.error);
  }

  const datesOk = isCalendarDate(values.startDate) && isCalendarDate(values.endDate) && values.endDate >= values.startDate;
  const ref = datesOk ? referencePeriod(values.startDate, values.endDate) : undefined;
  const err = (field: ExperimentFormField) => (errors[field] ? `${ids}-${field}-error` : undefined);
  const invalid = (field: ExperimentFormField) => (errors[field] ? true : undefined);
  const errorLine = (field: ExperimentFormField) =>
    errors[field] ? (
      <p className={ui.error} id={`${ids}-${field}-error`}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className={ui.form} onSubmit={onSubmit} noValidate aria-label="Nuovo esperimento">
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-title`}>
          Titolo
        </label>
        <input
          id={`${ids}-title`}
          className={ui.input}
          type="text"
          autoComplete="off"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Due settimane senza caffè dopo pranzo"
          aria-invalid={invalid("title")}
          aria-describedby={err("title")}
        />
        {errorLine("title")}
      </div>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-change`}>
          Che cosa cambi
        </label>
        <textarea
          id={`${ids}-change`}
          className={cx(ui.input, styles.textarea)}
          value={values.change}
          onChange={(e) => set("change", e.target.value)}
          placeholder="Niente caffè dopo le 14"
          aria-invalid={invalid("change")}
          aria-describedby={err("change")}
        />
        {errorLine("change")}
      </div>

      <div className={styles.twoCols}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-start`}>
            Primo giorno
          </label>
          <input
            id={`${ids}-start`}
            className={ui.input}
            type="date"
            value={values.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            aria-invalid={invalid("startDate")}
            aria-describedby={err("startDate")}
          />
          {errorLine("startDate")}
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-end`}>
            Ultimo giorno
          </label>
          <input
            id={`${ids}-end`}
            className={ui.input}
            type="date"
            value={values.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            aria-invalid={invalid("endDate")}
            aria-describedby={err("endDate")}
          />
          {errorLine("endDate")}
        </div>
      </div>
      {ref ? (
        <p className={ui.hint}>
          Il periodo di riferimento sarà dal {formatCalendarDate(ref.from)} al {formatCalendarDate(ref.to)}: i {ref.days} giorni subito prima. Il confronto
          è affidabile solo se anche quei giorni sono tracciati.
        </p>
      ) : null}

      <fieldset className={ui.field} aria-describedby={err("measures")}>
        <legend className={ui.fieldLabel}>Misure osservate</legend>
        <div className={ui.choices}>
          {MEASURE_CHOICES.map((m) => (
            <label key={m} className={ui.choice}>
              <input type="checkbox" checked={values.measures.includes(m)} onChange={() => toggleMeasure(m)} />
              <span>{measureChoiceLabel(m)}</span>
            </label>
          ))}
        </div>
        {errorLine("measures")}
      </fieldset>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-foods`}>
          Alimenti da escludere <span className={ui.optional}>(facoltativo)</span>
        </label>
        <input
          id={`${ids}-foods`}
          className={ui.input}
          type="text"
          autoComplete="off"
          value={values.excludedFoods}
          onChange={(e) => set("excludedFoods", e.target.value)}
          placeholder="caffè, tè nero"
          aria-invalid={invalid("excludedFoods")}
          aria-describedby={err("excludedFoods") ?? `${ids}-foods-hint`}
        />
        <p className={ui.hint} id={`${ids}-foods-hint`}>
          Separati da virgola. Servono a controllare quanto hai seguito il cambiamento, guardando i pasti registrati.
        </p>
        {errorLine("excludedFoods")}
      </div>

      {saveError ? (
        <p className={ui.error} role="alert">
          {saveError}
        </p>
      ) : null}
      <div className={ui.row}>
        <Button type="submit" disabled={busy}>
          Crea l&apos;esperimento
        </Button>
        <Button variant="text" onClick={onDone}>
          Non ora
        </Button>
      </div>
    </form>
  );
}
