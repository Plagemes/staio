"use client";

import { useState } from "react";
import { createMood, createSymptom, getDay, type DiaryDay } from "@/core/diary";
import { useDiary } from "@/data";
import { Label } from "@/design";
import { dayOf, formatTime } from "../format";
import { SCORES, SYMPTOM_LABELS, SYMPTOM_ORDER } from "../health";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import styles from "./health.module.css";

function useToday(): { day: DiaryDay | undefined; ready: boolean } {
  const diary = useDiary();
  const now = useNow();
  if (!diary.data || !now) return { day: undefined, ready: false };
  return { day: getDay(diary.data, dayOf(now)), ready: true };
}

function Scores({ label, disabled, onPick }: { label: string; disabled: boolean; onPick: (score: number) => void }) {
  return (
    <div className={styles.scores} role="group" aria-label={label}>
      {SCORES.map((s) => (
        <button key={s} type="button" className={styles.score} disabled={disabled} onClick={() => onPick(s)} aria-label={`${label}: ${s} su 5`}>
          {s}
        </button>
      ))}
    </div>
  );
}

export function MoodCard() {
  const { day, ready } = useToday();
  const { record, busy } = useRecord();
  const [error, setError] = useState<string | null>(null);
  if (!ready) return null;

  async function pick(score: number) {
    setError(null);
    const result = await record((o) => [createMood({ score }, o)], `Umore di oggi: ${score} su 5.`);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className={styles.card}>
      <Label>Come stai oggi</Label>
      <Scores label="Umore" disabled={busy} onPick={(s) => void pick(s)} />
      <p className={ui.hint}>Da 1 (molto male) a 5 (molto bene). Un tocco e fatto.</p>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      {day && day.moods.length > 0 ? (
        <ul className={styles.todayList}>
          {day.moods.map((m) => (
            <li key={m.eventId}>
              {formatTime(m.at)} · umore {m.score} su 5
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SymptomsCard() {
  const { day, ready } = useToday();
  const { record, busy } = useRecord();
  const [error, setError] = useState<string | null>(null);
  if (!ready) return null;

  async function pick(kind: (typeof SYMPTOM_ORDER)[number], score: number) {
    setError(null);
    const result = await record(
      (o) => [createSymptom({ kind, score }, o)],
      `${SYMPTOM_LABELS[kind]} di oggi: ${score} su 5.`,
    );
    if (!result.ok) setError(result.error);
  }

  return (
    <div className={styles.card}>
      {SYMPTOM_ORDER.map((kind) => (
        <div key={kind} className={styles.group}>
          <Label>{SYMPTOM_LABELS[kind]}</Label>
          <Scores label={SYMPTOM_LABELS[kind]} disabled={busy} onPick={(s) => void pick(kind, s)} />
          {day?.symptoms.some((s) => s.kind === kind) ? (
            <ul className={styles.todayList}>
              {day.symptoms
                .filter((s) => s.kind === kind)
                .map((s) => (
                  <li key={s.eventId}>
                    {formatTime(s.at)} · {s.score} su 5
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ))}
      <p className={ui.hint}>Da 1 (molto male) a 5 (molto bene). Sono note tue: Staio non ne ricava diagnosi.</p>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
