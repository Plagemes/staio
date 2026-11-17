"use client";

import { useMemo, useState } from "react";
import { createWater, getDay, habitsToPropose, localMoment, type DiaryHabit, type DiaryState } from "@/core/diary";
import { activeLots, type PantryState } from "@/core/ledger";
import { Button, Label } from "@/design";
import { Sheet } from "../common";
import { drinkCounts } from "../drinks";
import { DRINK_PRESETS, formatMl, type DrinkPreset } from "../health";
import { DrinkPantrySuggestion, useDrinkSuggestion } from "../health/DrinkPantry";
import { DrinkPresetChips, useDrinkActions } from "../health/Drinks";
import { evaluateLots } from "../lots";
import { buildMealFromHabit, itemText } from "../meals";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { HABIT_WINDOW_MINUTES, nowAction, nowActionHref, nowActionLabel } from "./nowModel";
import { useWaterGoal } from "./useWaterGoal";
import styles from "./Now.module.css";

interface Props {
  now: string;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  diary: DiaryState;
  pantry: PantryState;
  /** «Acqua: un'altra quantità»: apre la riga «Acqua» del diario e la porta in vista. Assente finché il diario non c'è. */
  onShowWater?: () => void;
}

const WATER_ML = 200;
const COFFEE = DRINK_PRESETS.find((p) => p.id === "espresso");
const TEA = DRINK_PRESETS.find((p) => p.id === "tea");

/**
 * Il blocco d'azione di Oggi: che cosa registrare adesso. Un pulsante per il pasto del momento (con il pasto abituale,
 * se c'è, già pronto), quattro pastiglie per ciò che si beve, e sotto il conto del giorno, che cambia a ogni tocco.
 */
export function Now({ now, today, diary, pantry, onShowWater }: Props) {
  const timeZone = diary.timeZone;
  const { record, recordWith, busy: recording } = useRecord();
  const drinkActions = useDrinkActions(timeZone);
  const suggestion = useDrinkSuggestion();
  const goal = useWaterGoal();
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const busy = recording || drinkActions.busy;

  const day = getDay(diary, today);
  const habits = useMemo(() => habitsToPropose(diary, now, { windowMinutes: HABIT_WINDOW_MINUTES }), [diary, now]);
  const action = nowAction({ nowMinutes: localMoment(now, timeZone)?.minutes ?? 0, day, habits });
  const drinkLine = drinkCounts(day?.drinks ?? []);

  async function registerHabit(habit: DiaryHabit) {
    setError(null);
    // nell'ordine «da mangiare prima»: il pasto abituale scala per primo ciò che scade prima
    const lots = evaluateLots(activeLots(pantry), now).map((e) => e.lot);
    const result = await recordWith((deviceId) => {
      const built = buildMealFromHabit(habit, lots, { now: new Date().toISOString(), deviceId });
      return { events: built.events, message: built.message };
    });
    if (!result.ok) setError(result.error);
  }

  async function addWater() {
    setError(null);
    const result = await record((o) => [createWater({ ml: WATER_ML }, o)], `Aggiunta acqua: ${formatMl(WATER_ML)}.`);
    if (!result.ok) setError(result.error);
  }

  async function addDrink(preset: DrinkPreset) {
    setError(null);
    const result = await drinkActions.addPreset(preset);
    if (result.ok) suggestion.offer(preset.name, result.events);
    else setError(result.error);
  }

  return (
    <>
      <div className={`${styles.now} ${ui.tile} ${ui.tone}`} data-tone="today">
        <Label>Adesso</Label>

        {action.kind === "habit" ? (
          <>
            <Button className={styles.main} disabled={busy} onClick={() => void registerHabit(action.habit)}>
              {nowActionLabel(action)}
            </Button>
            <div className={styles.habit}>
              <p className={ui.hint}>{action.habit.items.map((i) => itemText(i.name, i.quantity)).join(", ")}</p>
              <Button variant="text" href={nowActionHref(action)}>
                Un altro pasto
              </Button>
            </div>
          </>
        ) : (
          <Button className={styles.main} variant={action.kind === "snack" ? "outline" : "primary"} href={nowActionHref(action)}>
            {nowActionLabel(action)}
          </Button>
        )}

        <div className={styles.chips} role="group" aria-label="Segna una bevanda">
          <button type="button" className={styles.chip} disabled={busy} onClick={() => void addWater()}>
            Acqua +{formatMl(WATER_ML)}
          </button>
          {COFFEE ? (
            <button type="button" className={styles.chip} disabled={busy} aria-label={COFFEE.name} onClick={() => void addDrink(COFFEE)}>
              Caffè
            </button>
          ) : null}
          {TEA ? (
            <button type="button" className={styles.chip} disabled={busy} onClick={() => void addDrink(TEA)}>
              Tè
            </button>
          ) : null}
          <button
            type="button"
            className={styles.chip}
            disabled={busy}
            onClick={() => {
              setSheetError(null);
              setSheet(true);
            }}
          >
            Altro
          </button>
        </div>

        <p className={ui.hint} aria-live="polite">
          Oggi: acqua {formatMl(day?.waterMl ?? 0)} di {formatMl(goal)}
          {drinkLine === "" ? "" : ` · ${drinkLine}`}
        </p>

        <DrinkPantrySuggestion suggestion={suggestion.suggestion} timeZone={timeZone} onDone={suggestion.dismiss} />

        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {/* fuori dal blocco tinto: il foglio non ne eredita i colori */}
      {sheet ? (
        <Sheet title="Bevande" onClose={() => setSheet(false)} busy={drinkActions.busy}>
          <DrinkPresetChips
            actions={drinkActions}
            onError={setSheetError}
            // un tocco segna e chiude: l'avviso non deve restare sotto il foglio
            onAdded={(name, events) => {
              setSheet(false);
              suggestion.offer(name, events);
            }}
          />
          {sheetError ? (
            <p className={ui.error} role="alert">
              {sheetError}
            </p>
          ) : null}
          {onShowWater ? (
            <div>
              <Button
                variant="text"
                onClick={() => {
                  setSheet(false);
                  onShowWater();
                }}
              >
                Acqua: un&apos;altra quantità
              </Button>
            </div>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}
