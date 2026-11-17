"use client";

import { useId, useState, type FormEvent } from "react";
import { createWater, dayFluids, getDay } from "@/core/diary";
import { useDiary } from "@/data";
import { Button, Label, ProgressLine, Value } from "@/design";
import { dayOf } from "../format";
import {
  DEFAULT_WATER_GOAL_ML,
  WATER_PRESETS,
  formatMl,
  parseWaterAmount,
  parseWaterGoal,
} from "../health";
import { setSetting, useSetting } from "../localSettings";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import styles from "./health.module.css";

export const WATER_GOAL_KEY = "waterGoalMl";
const isGoal = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Acqua di oggi con aggiunta rapida e obiettivo modificabile. Serve sia a Oggi sia a Salute. */
export function WaterCard() {
  const diary = useDiary();
  const now = useNow();
  const goal = useSetting(WATER_GOAL_KEY, isGoal, DEFAULT_WATER_GOAL_ML);
  const { record, busy } = useRecord();
  const ids = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);

  if (!diary.data || !now) return null;
  const day = getDay(diary.data, dayOf(now));
  const ml = day?.waterMl ?? 0;
  const total = goal.value;
  const fluids = dayFluids(day);

  async function add(amount: number) {
    setError(null);
    const result = await record((o) => [createWater({ ml: amount }, o)], `Aggiunta acqua: ${formatMl(amount)}.`);
    if (!result.ok) setError(result.error);
    return result.ok;
  }

  async function onCustom(event: FormEvent) {
    event.preventDefault();
    const read = parseWaterAmount(text);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    if (await add(read.value)) setText("");
  }

  async function onGoal(event: FormEvent) {
    event.preventDefault();
    const read = parseWaterGoal(goalText);
    if (!read.ok) {
      setGoalError(read.error);
      return;
    }
    try {
      await setSetting(WATER_GOAL_KEY, read.value);
      setEditingGoal(false);
      setGoalError(null);
    } catch {
      setGoalError("Non sono riuscito a salvare l'obiettivo.");
    }
  }

  return (
    <div className={styles.card}>
      <Label>Acqua di oggi</Label>
      <div className={styles.big}>
        <span className={styles.bigNumber}>
          <Value certainty={ml > 0 ? "estimated" : "measured"}>{formatMl(ml)}</Value>
        </span>
        <span className={styles.of}>di {formatMl(total)}</span>
      </div>
      {fluids.otherMl > 0 || fluids.alcoholicMl > 0 ? (
        <p className={styles.fluids}>
          Acqua {formatMl(ml)}
          {fluids.otherMl > 0 ? ` · altre bevande ${formatMl(fluids.otherMl)}` : ""}
          {fluids.alcoholicMl > 0 ? ` · bevande alcoliche ${formatMl(fluids.alcoholicMl)}` : ""}. L&apos;obiettivo conta solo l&apos;acqua.
        </p>
      ) : null}
      <ProgressLine value={Math.min(ml, total)} max={total} label={`Acqua di oggi: ${formatMl(ml)} su ${formatMl(total)}`} />

      <div className={styles.buttons}>
        {WATER_PRESETS.map((p) => (
          <button key={p.ml} type="button" className={styles.chip} disabled={busy} onClick={() => void add(p.ml)}>
            {p.label}
            <span className={styles.chipHint}>+{formatMl(p.ml)}</span>
          </button>
        ))}
      </div>

      <form className={ui.field} onSubmit={onCustom} noValidate>
        <label className={ui.fieldLabel} htmlFor={`${ids}-water`}>
          Un&apos;altra quantità
        </label>
        <div className={styles.inline}>
          <input
            id={`${ids}-water`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="300 ml o 0,5 l"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-water-error` : undefined}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            Aggiungi
          </Button>
        </div>
        {error ? (
          <p className={ui.error} id={`${ids}-water-error`}>
            {error}
          </p>
        ) : null}
      </form>

      {editingGoal ? (
        <form className={ui.field} onSubmit={onGoal} noValidate>
          <label className={ui.fieldLabel} htmlFor={`${ids}-goal`}>
            Obiettivo giornaliero
          </label>
          <div className={styles.inline}>
            <input
              id={`${ids}-goal`}
              className={ui.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={goalText}
              onChange={(e) => {
                setGoalText(e.target.value);
                setGoalError(null);
              }}
              placeholder="2 l"
              aria-invalid={goalError ? true : undefined}
              aria-describedby={goalError ? `${ids}-goal-error` : undefined}
            />
            <Button type="submit" variant="outline">
              Salva
            </Button>
            <Button variant="text" onClick={() => setEditingGoal(false)}>
              Chiudi
            </Button>
          </div>
          {goalError ? (
            <p className={ui.error} id={`${ids}-goal-error`}>
              {goalError}
            </p>
          ) : (
            <p className={ui.hint}>Lo scegli tu: è un obiettivo personale, non una prescrizione.</p>
          )}
        </form>
      ) : (
        <div>
          <Button
            variant="text"
            onClick={() => {
              setGoalText(String(total / 1000).replace(".", ","));
              setEditingGoal(true);
            }}
          >
            Cambia obiettivo
          </Button>
        </div>
      )}
      {ml > 0 ? <p className={ui.hint}>L&apos;acqua si scrive a occhio: vale come stima.</p> : null}
    </div>
  );
}
