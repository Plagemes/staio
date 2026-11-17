"use client";

import { useState } from "react";
import type { DiaryState, MealKind } from "@/core/diary";
import type { MissedMeal, PlannedEntry } from "@/core/plan";
import { Button, SectionHeader } from "@/design";
import { MEAL_KIND_LABELS } from "../meals";
import { dayHeading } from "../plan/dates";
import { itemLabel, type Catalog } from "../plan/describe";
import { MoveSheet } from "../plan/MoveSheet";
import { buildDropMeal, buildMoveMeal, slotsToMoveTo } from "../plan/moveMeal";
import { useWriter } from "../plan/useWriter";
import ui from "../ui.module.css";
import styles from "./Today.module.css";

interface Props {
  missed: readonly MissedMeal[];
  weekStart: string;
  weekEntries: readonly PlannedEntry[];
  kinds: readonly MealKind[] | undefined;
  catalog: Catalog | undefined;
  diary: DiaryState;
  now: string;
  timeZone: string;
  today: string;
}

const REASON_TEXT = { skipped: "saltato", not_logged: "non registrato" } as const;

/**
 * Pasti del piano di questa settimana, fino a oggi, che risultano saltati o non registrati. Non è una domanda che
 * blocca: ognuno si può spostare su un posto libero della settimana oppure togliere dal piano, e restare dov'è.
 * Gli ingredienti seguono il pasto: la spesa e l'aderenza lo contano una volta sola, nel posto nuovo.
 */
export function MissedPlanned({ missed, weekStart, weekEntries, kinds, catalog, diary, now, timeZone, today }: Props) {
  const write = useWriter();
  const [moving, setMoving] = useState<MissedMeal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (missed.length === 0 || !catalog) return null;

  const options = moving ? slotsToMoveTo({ weekEntries, diary, now, timeZone, today, weekStart, kinds, from: moving }) : [];
  const text = (m: MissedMeal) => m.entries.map((e) => itemLabel(e.item, catalog)).join(", ");

  async function run(build: Parameters<typeof write>[0]) {
    setBusy(true);
    setError(null);
    const failure = await write(build);
    setBusy(false);
    if (failure) setError(failure);
    return failure;
  }

  return (
    <section className={ui.section} aria-label="Pasti del piano non fatti">
      <SectionHeader label="Nel piano, non fatti" />
      <ul className={`${styles.list} ${ui.group}`}>
        {missed.map((m) => (
          <li key={`${m.date}-${m.meal}`} className={styles.meal}>
            <div className={styles.mealHead}>
              <span className={styles.mealTitle}>{text(m)}</span>
              <span className={styles.mealTime}>
                {MEAL_KIND_LABELS[m.meal].toLowerCase()} · {REASON_TEXT[m.reason]}
              </span>
            </div>
            <p className={styles.note}>{dayHeading(m.date, today)}</p>
            <div className={styles.momentChoices}>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMoving(m);
                }}
              >
                Sposta
              </Button>
              <Button variant="text" disabled={busy} onClick={() => void run((ctx) => buildDropMeal(weekStart, weekEntries, m, ctx))}>
                Togli dal piano
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

      {moving ? (
        <MoveSheet
          what={text(moving)}
          from={moving}
          options={options}
          today={today}
          onClose={() => setMoving(null)}
          onMove={async (to) => {
            const failure = await write((ctx) => buildMoveMeal(weekStart, weekEntries, moving, to, ctx));
            if (!failure) setMoving(null);
            return failure;
          }}
        />
      ) : null}
    </section>
  );
}
