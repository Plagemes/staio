"use client";

import { useMemo, useState } from "react";
import { getDay, instantOfLocal, localMoment, type DiaryState, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { PantryState } from "@/core/ledger";
import { SectionHeader } from "@/design";
import { Disclosure } from "../common";
import { relativeDay } from "../format";
import { formatMl } from "../health";
import { DrinkPresetChips, useDrinkActions } from "../health/Drinks";
import { buildJournal } from "../journal";
import { MEAL_KIND_LABELS, TYPICAL_MEAL_TIME, minutesOfTime } from "../meals";
import { looseConsumesOf } from "../pantry/eaten";
import ui from "../ui.module.css";
import { BodyRow } from "./BodyRow";
import { DiaryHint } from "./DiaryHint";
import { bodyLines, bodySummary, mealsWithPantryOf, waterGlasses } from "./dayRows";
import { dayStatusLine, diaryTitle } from "./dayStatus";
import { useDayIntake } from "./MealLines";
import { MealMoments } from "./MealMoments";
import { PantryJournal } from "./PantryJournal";
import { movementsSummary } from "./summaries";
import type { TodayPlan } from "./useTodayPlan";
import { useWaterGoal } from "./useWaterGoal";
import { WaterRow } from "./WaterRow";
import styles from "./Today.module.css";

interface Props {
  now: string;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Il giorno mostrato (`YYYY-MM-DD`): oggi o un giorno passato. */
  date: string;
  diary: DiaryState;
  pantry: PantryState;
  log: readonly AnyEvent[];
  /** Ciò che Oggi sa del piano: lo calcola la schermata, una volta, anche per il riepilogo. */
  plan: TodayPlan;
  /** La riga «Acqua» è aperta: la schermata la apre anche da fuori («Acqua: un'altra quantità», il riepilogo). */
  waterOpen: boolean;
  onWaterOpenChange: (open: boolean) => void;
  /** `?voce=` chiedeva una voce che non c'è più: lo dice una riga sotto il titolo. */
  entryGone?: boolean;
}

/**
 * Il diario del giorno: una riga di stato, i momenti con i loro pasti e le loro bevande, e in coda le righe richiuse
 * «Acqua» (con i bicchieri), «Corpo» (peso, umore, note, integratori) e «Dispensa». Per un giorno passato l'acqua e
 * il corpo compaiono solo se c'è qualcosa, e in fondo si può aggiungere una bevanda dimenticata.
 */
export function TodayDiary({ now, today, date, diary, pantry, log, plan, waterOpen, onWaterOpenChange, entryGone = false }: Props) {
  const timeZone = diary.timeZone;
  const pastDay = date < today;
  const goal = useWaterGoal();
  const intake = useDayIntake(date);
  const voided = useMemo(() => new Set(diary.voidedEventIds), [diary.voidedEventIds]);
  const glasses = useMemo(() => waterGlasses(log, date, timeZone, voided), [log, date, timeZone, voided]);

  const meals = useMemo(
    () =>
      mealsWithPantryOf(diary, log)
        .filter((m) => m.date === date)
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    [diary, log, date],
  );
  const loose = useMemo(() => looseConsumesOf(log, diary, date), [diary, log, date]);
  // ciò che è nei pasti si legge già nei momenti: qui restano gli altri movimenti della dispensa
  const movements = useMemo(() => buildJournal(log, pantry, date, timeZone, { withoutMealConsumes: true }), [log, pantry, date, timeZone]);

  const day = getDay(diary, date);
  const waterMl = day?.waterMl ?? 0;
  const status = dayStatusLine(day, pastDay ? {} : { nowMinutes: localMoment(now, timeZone)?.minutes ?? 0 });
  const body = bodySummary(day);

  return (
    <section className={ui.section}>
      <SectionHeader label={diaryTitle(date, today)} actionLabel="Ultime azioni" actionHref="/app/attivita" />
      {entryGone ? (
        <p className={ui.callout} role="status">
          Questa voce non c&apos;è più.
        </p>
      ) : null}
      <p className={styles.status} role="status">
        {status}
      </p>
      {!pastDay && (meals.length > 0 || Object.values(loose).some((l) => l.length > 0)) ? <DiaryHint /> : null}

      <MealMoments
        date={date}
        today={today}
        now={now}
        diary={diary}
        day={day}
        meals={meals}
        loose={loose}
        log={log}
        pantry={pantry}
        planned={plan.planned}
        plan={plan}
        intake={intake}
        pastDay={pastDay}
      />

      <div className={`${styles.rows} ${styles.tail}`}>
        {pastDay ? (
          waterMl > 0 ? (
            <Disclosure title="Acqua" summary={formatMl(waterMl)}>
              <WaterRow glasses={glasses} log={log} controls={false} />
            </Disclosure>
          ) : null
        ) : (
          <div id="acqua" className={styles.anchor}>
            <Disclosure title="Acqua" summary={`${formatMl(waterMl)} di ${formatMl(goal)}`} open={waterOpen} onOpenChange={onWaterOpenChange}>
              <WaterRow glasses={glasses} log={log} controls />
            </Disclosure>
          </div>
        )}
        {body !== null ? (
          <Disclosure title="Corpo" summary={body}>
            <BodyRow lines={bodyLines(day, timeZone)} log={log} />
          </Disclosure>
        ) : null}
        {movements.length > 0 ? (
          <Disclosure title="Dispensa" summary={movementsSummary(movements.length)}>
            <PantryJournal rows={movements} log={log} />
          </Disclosure>
        ) : null}
        {pastDay ? (
          <Disclosure title="Aggiungi una bevanda dimenticata">
            <ForgottenDrink date={date} today={today} timeZone={timeZone} />
          </Disclosure>
        ) : null}
      </div>
    </section>
  );
}

const MOMENTS: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];

/** Una bevanda dimenticata di un giorno passato: serve l'ora in cui è stata bevuta, proposta dal momento. */
function ForgottenDrink({ date, today, timeZone }: { date: string; today: string; timeZone: string }) {
  const actions = useDrinkActions(timeZone);
  const [moment, setMoment] = useState<MealKind>("breakfast");
  const [timeEdit, setTimeEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = timeEdit ?? TYPICAL_MEAL_TIME[moment];
  const minutes = minutesOfTime(time);
  const at = minutes !== undefined ? instantOfLocal(date, minutes, timeZone) : undefined;

  return (
    <>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Quando</legend>
        <div className={ui.choices}>
          {MOMENTS.map((k) => (
            <label key={k} className={ui.choice}>
              <input
                type="radio"
                name="past-drink-moment"
                value={k}
                checked={moment === k}
                onChange={() => {
                  setMoment(k);
                  setTimeEdit(null);
                }}
              />
              <span>{MEAL_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor="past-drink-time">
          Ora in cui l&apos;hai bevuta
        </label>
        <input id="past-drink-time" className={ui.input} type="time" value={time} onChange={(e) => setTimeEdit(e.target.value)} />
      </div>
      {at === undefined ? (
        <p className={ui.hint}>Scegli un&apos;ora per segnare una bevanda di questo giorno.</p>
      ) : (
        <DrinkPresetChips actions={actions} onError={setError} when={{ at, dayLabel: relativeDay(date, today) }} />
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
