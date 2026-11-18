"use client";

// I tre fogli di «Segna»: Peso, Come sto, Integratore. Ognuno fa una sola scrittura, poi si chiude, poi nasce l'avviso.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createSupplement, createWeight, getDay, weightSeries, type DiaryState } from "@/core/diary";
import { Button } from "@/design";
import { ActionList, Sheet, type ActionItem } from "../common";
import { formatTime } from "../format";
import {
  SCORES,
  SCORE_LABELS,
  SCORE_MEASURES,
  buildScoreEvents,
  formatKg,
  lastSupplementDose,
  parseWeightKg,
  pickedMeasures,
  recentSupplementNames,
  supplementKey,
  type ScoreMeasure,
  type ScorePicks,
} from "../health";
import ui from "../ui.module.css";
import { lastWeightText, scoresNotice, scoresText, supplementHint, supplementNotice, weightNotice } from "./healthText";
import { useHealthWrite } from "./useHealthWrite";
import styles from "./health.module.css";

export type HealthSheetKind = "weight" | "feeling" | "supplement";

interface SheetProps {
  diary: DiaryState;
  /** Oggi, `YYYY-MM-DD`, nel fuso del diario. */
  today: string;
  onClose: () => void;
}

function ErrorLine({ id, text }: { id?: string; text: string | null }) {
  return text ? (
    <p className={ui.error} id={id} role="alert">
      {text}
    </p>
  ) : null;
}

/** Il foglio «Peso»: una pesata nuova, adesso. Una pesata già segnata si corregge toccandola in «Oggi». */
export function WeightEntrySheet({ diary, today, onClose }: SheetProps) {
  const ids = useId();
  const { write, busy } = useHealthWrite();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const last = useMemo(() => weightSeries(diary).at(-1), [diary]);

  // il foglio serve solo a scrivere un numero: il campo è pronto appena si apre
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function save() {
    const read = parseWeightKg(text);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    setError(null);
    const failure = await write(
      ({ deviceId, now }) => ({ events: [createWeight({ kg: read.value }, { deviceId, now: () => now })], message: weightNotice(read.value) }),
      onClose,
    );
    if (failure) setError(failure);
  }

  return (
    <Sheet
      title="Peso"
      onClose={onClose}
      busy={busy}
      footer={
        <Button type="submit" form={`${ids}-form`} disabled={busy}>
          Segna
        </Button>
      }
    >
      <form
        id={`${ids}-form`}
        className={ui.field}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className={ui.fieldLabel} htmlFor={`${ids}-kg`}>
          Peso
        </label>
        <div className={styles.inline}>
          <input
            ref={inputRef}
            id={`${ids}-kg`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={last ? formatKg(last.kg).replace(" kg", "") : "71,4"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : last ? `${ids}-last` : undefined}
          />
          <span className={styles.unit}>kg</span>
        </div>
        <ErrorLine id={`${ids}-error`} text={error} />
        {last ? (
          <p className={ui.hint} id={`${ids}-last`}>
            {lastWeightText(last, today)}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

/** Il foglio «Come sto»: da una a quattro misure, scritte insieme. */
export function FeelingSheet({ onClose }: Pick<SheetProps, "onClose">) {
  const ids = useId();
  const { write, busy } = useHealthWrite();
  const [picks, setPicks] = useState<ScorePicks>({});
  const [error, setError] = useState<string | null>(null);
  const chosen = pickedMeasures(picks).length;

  const toggle = (measure: ScoreMeasure, score: number) => {
    setError(null);
    setPicks((current) => {
      const next = { ...current };
      if (next[measure] === score) delete next[measure];
      else next[measure] = score;
      return next;
    });
  };

  async function save() {
    if (chosen === 0) return;
    setError(null);
    const failure = await write((ctx) => ({ events: buildScoreEvents(picks, ctx), message: scoresNotice(picks) }), onClose);
    if (failure) setError(failure);
  }

  return (
    <Sheet
      title="Come sto"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button disabled={busy || chosen === 0} onClick={() => void save()}>
            Segna
          </Button>
          {/* la riga c'è sempre: se sparisse alla prima scelta le pastiglie si sposterebbero sotto il dito */}
          <p className={ui.hint} aria-live="polite">
            {chosen === 0 ? "Scegli almeno un valore" : `Da segnare: ${scoresText(picks)}`}
          </p>
        </>
      }
    >
      <div className={styles.scoreRows}>
        {SCORE_MEASURES.map((measure) => {
          const label = SCORE_LABELS[measure];
          return (
            <div key={measure} className={styles.scoreRow}>
              <span className={styles.scoreLabel} id={`${ids}-${measure}`}>
                {label}
              </span>
              <div className={styles.scores} role="group" aria-labelledby={`${ids}-${measure}`}>
                {SCORES.map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={styles.score}
                    aria-pressed={picks[measure] === score}
                    aria-label={`${label}: ${score} su 5`}
                    onClick={() => toggle(measure, score)}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className={ui.hint}>Da 1 (molto male) a 5 (molto bene). Scegli solo quelle che vuoi.</p>
      <ErrorLine text={error} />
    </Sheet>
  );
}

/** Il foglio «Integratore»: quelli presi di recente con un tocco, con la dose dell'ultima volta; oppure «Un altro». */
export function SupplementSheet({ diary, today, onClose }: SheetProps) {
  const ids = useId();
  const { write, busy } = useHealthWrite();
  const nameRef = useRef<HTMLInputElement>(null);
  const doseRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"main" | "other">("main");
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recent = useMemo(() => recentSupplementNames(diary, today), [diary, today]);
  // senza integratori recenti non c'è niente da scegliere: si scrive subito
  const other = step === "other" || recent.length === 0;
  const canGoBack = other && recent.length > 0;

  useEffect(() => {
    if (other) nameRef.current?.focus();
  }, [other]);

  async function take(supplementName: string, supplementDose: string | undefined) {
    setError(null);
    const failure = await write(
      ({ deviceId, now }) => ({
        events: [createSupplement({ name: supplementName, ...(supplementDose ? { dose: supplementDose } : {}) }, { deviceId, now: () => now })],
        message: supplementNotice(supplementName, supplementDose),
      }),
      onClose,
    );
    if (failure) setError(failure);
  }

  function submitOther() {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed === "") {
      setError("Scrivi il nome dell'integratore.");
      nameRef.current?.focus();
      return;
    }
    void take(trimmed, dose.trim() || undefined);
  }

  const back = () => {
    setError(null);
    setStep("main");
  };

  let body;
  let footer;
  if (other) {
    body = (
      <form
        id={`${ids}-form`}
        className={ui.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submitOther();
        }}
      >
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Nome
          </label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            className={ui.input}
            type="text"
            autoComplete="off"
            enterKeyHint="next"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            // Invio nel nome passa alla dose; conferma solo dalla dose
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              doseRef.current?.focus();
            }}
            placeholder="Vitamina D"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-dose`}>
            Dose <span className={ui.optional}>(facoltativa)</span>
          </label>
          <input
            ref={doseRef}
            id={`${ids}-dose`}
            className={ui.input}
            type="text"
            autoComplete="off"
            enterKeyHint="done"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="1 capsula"
          />
        </div>
        <ErrorLine id={`${ids}-error`} text={error} />
      </form>
    );
    const confirm = (
      <Button type="submit" form={`${ids}-form`} disabled={busy}>
        Segna
      </Button>
    );
    footer = canGoBack ? (
      <div className={styles.stepFooter}>
        <Button variant="text" disabled={busy} onClick={back}>
          Indietro
        </Button>
        {confirm}
      </div>
    ) : (
      confirm
    );
  } else {
    const takenToday = [...(getDay(diary, today)?.supplements ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const items: ActionItem[] = recent.map((recentName) => {
      const recentDose = lastSupplementDose(diary, recentName);
      const key = supplementKey(recentName);
      const lastToday = takenToday.filter((s) => supplementKey(s.name) === key).at(-1);
      const hint = supplementHint(recentDose, lastToday ? formatTime(lastToday.at, diary.timeZone) : undefined);
      return {
        id: key,
        label: recentName,
        ...(hint !== "" ? { hint } : {}),
        disabled: busy,
        onSelect: () => void take(recentName, recentDose),
      };
    });
    body = (
      <>
        <ActionList items={items} />
        <ActionList
          items={[
            {
              id: "other",
              label: "Un altro",
              disabled: busy,
              onSelect: () => {
                setError(null);
                setStep("other");
              },
            },
          ]}
        />
        <ErrorLine text={error} />
      </>
    );
  }

  return (
    <Sheet title="Integratore" onClose={onClose} busy={busy} footer={footer} onBack={canGoBack ? back : undefined}>
      {body}
    </Sheet>
  );
}
