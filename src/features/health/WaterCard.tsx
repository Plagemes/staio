"use client";

import { useId, useState, type FormEvent, type ReactElement } from "react";
import { createWater } from "@/core/diary";
import { Button } from "@/design";
import {
  DEFAULT_WATER_GOAL_ML,
  WATER_PRESETS,
  formatMl,
  parseWaterAmount,
  parseWaterGoal,
} from "../health";
import { setSetting, useSetting } from "../localSettings";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import styles from "./health.module.css";

export const WATER_GOAL_KEY = "waterGoalMl";
const isGoal = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * I comandi dell'acqua nella riga «Acqua» del diario di Oggi: aggiunta rapida, un'altra quantità, obiettivo. Senza
 * scheda né conto: il conto lo dice già la riga. L'acqua si segna solo da Oggi e dal «+».
 */
function WaterControls() {
  const goal = useSetting(WATER_GOAL_KEY, isGoal, DEFAULT_WATER_GOAL_ML);
  const { record, busy } = useRecord();
  const ids = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);

  const total = goal.value;

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
    <div className={ui.form}>
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
            Segna
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
    </div>
  );
}

/** `plain` non cambia più niente (i comandi sono sempre senza scheda): resta per chi la monta già così. */
export const WaterCard: (props: { plain?: boolean }) => ReactElement = WaterControls;
