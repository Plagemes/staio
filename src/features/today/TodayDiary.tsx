"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getDay,
  habitsToPropose,
  instantOfLocal,
  mealsWithPantry,
  voidMeal,
  type DiaryHabit,
  type MealKind,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots, type PantryState, type VoidEvent } from "@/core/ledger";
import { appendEvents, getDeviceId, useDiary } from "@/data";
import { Button, Label, SectionHeader, Value } from "@/design";
import { buildUndo } from "../actions";
import { dayOf, formatTime, relativeDay } from "../format";
import { drinkCounts } from "../drinks";
import { DrinkPantrySuggestion, useDrinkSuggestion } from "../health/DrinkPantry";
import { DrinkPresetChips, useDrinkActions } from "../health/Drinks";
import { WaterCard } from "../health/WaterCard";
import { evaluateLots } from "../lots";
import {
  MEAL_KIND_LABELS,
  TYPICAL_MEAL_TIME,
  buildMealFromHabit,
  itemText,
  minutesOfTime,
  summarizeDay,
} from "../meals";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { missedThisWeek } from "../plan/moveMeal";
import { MealMoments } from "./MealMoments";
import { MissedPlanned } from "./MissedPlanned";
import { useTodayPlan } from "./useTodayPlan";
import styles from "./Today.module.css";

interface Props {
  now: string;
  /** Il giorno mostrato (`YYYY-MM-DD`): oggi o un giorno passato. */
  date: string;
  pantry: PantryState;
  log: readonly AnyEvent[];
}

/**
 * La parte di diario di Oggi: stato del giorno, pasti abituali, i momenti con i loro pasti e le loro bevande, scelte
 * rapide delle bevande, acqua. Per un giorno passato restano solo le cose che hanno senso dopo: segnare un momento
 * saltato o non registrato, aggiungere una bevanda dimenticata, annullare.
 */
export function TodayDiary({ now, date, pantry, log }: Props) {
  const diary = useDiary();
  const notice = useNotice();
  const { recordWith, busy } = useRecord();
  const plan = useTodayPlan();
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const drinkActions = useDrinkActions(timeZone);
  const drinkSuggestion = useDrinkSuggestion();
  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [pastMoment, setPastMoment] = useState<MealKind>("breakfast");
  const [pastTimeEdit, setPastTimeEdit] = useState<string | null>(null);

  const today = dayOf(now);
  const pastDay = date < today;

  const proposals = useMemo(() => (diary.data && !pastDay ? habitsToPropose(diary.data, now) : []), [diary.data, now, pastDay]);
  const meals = useMemo(
    () =>
      diary.data
        ? mealsWithPantry(diary.data, log)
            .filter((m) => m.date === date)
            .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
        : [],
    [diary.data, log, date],
  );

  const missed = useMemo(
    () => (diary.data && !pastDay && plan.ready ? missedThisWeek({ weekEntries: plan.weekEntries, diary: diary.data, now, timeZone, today, adherence: plan.adherence }) : []),
    [diary.data, pastDay, plan.ready, plan.weekEntries, plan.adherence, now, timeZone, today],
  );

  if (!diary.data) return null;
  const day = getDay(diary.data, date);
  const summary = summarizeDay(day);
  const lotNames = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const drinkLine = drinkCounts(day?.drinks ?? []);
  // un pasto già nella sezione «non fatti» non si ripete tra quelli di oggi
  const missedToday = new Set(missed.filter((m) => m.date === today).map((m) => m.meal));
  const planned = plan.planned.filter((p) => !missedToday.has(p.meal));

  // Una bevanda dimenticata di un giorno passato: serve l'ora in cui è stata bevuta.
  const pastTime = pastTimeEdit ?? TYPICAL_MEAL_TIME[pastMoment];
  const pastMinutes = minutesOfTime(pastTime);
  const pastAt = pastDay && pastMinutes !== undefined ? instantOfLocal(date, pastMinutes, timeZone) : undefined;

  async function registerHabit(habit: DiaryHabit) {
    setError(null);
    const lots = evaluateLots(activeLots(pantry), now).map((e) => e.lot);
    const result = await recordWith((deviceId) => {
      const built = buildMealFromHabit(habit, lots, { now: new Date().toISOString(), deviceId });
      return { events: built.events, message: built.message };
    });
    if (!result.ok) setError(result.error);
  }

  /** `make` riceve il dispositivo e restituisce gli annullamenti da scrivere. */
  async function undoWith(make: (deviceId: string, now: string) => VoidEvent[], description: string) {
    if (undoing) return;
    setUndoing(true);
    setError(null);
    try {
      const voids = make(await getDeviceId(), new Date().toISOString());
      if (voids.length === 0) return;
      await appendEvents(voids);
      setOpenMeal(null);
      // «Annulla» sull'avviso annulla l'annullamento e riporta tutto com'era
      notice.show({ message: `Annullato: ${description}.`, undo: voids });
    } catch {
      setError("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setUndoing(false);
    }
  }

  function renderMeal(meal: MealWithPantry) {
    const open = openMeal === meal.mealId;
    const title = meal.title ?? MEAL_KIND_LABELS[meal.kind];
    return (
      <div className={styles.meal}>
        <div className={styles.mealHead}>
          <span className={styles.mealTitle}>{title}</span>
          <span className={styles.mealTime}>
            {formatTime(meal.at)}
            {meal.title ? ` · ${MEAL_KIND_LABELS[meal.kind].toLowerCase()}` : ""}
          </span>
        </div>
        <ul className={styles.items}>
          {meal.pantryConsumes.map((c) => (
            <li key={c.id}>
              <Value certainty={c.certainty === "estimated" ? "estimated" : "measured"}>{itemText(lotNames.get(c.lotId) ?? "Alimento", c.quantity)}</Value>
            </li>
          ))}
          {meal.items.map((i, index) => (
            <li key={`${i.name}-${index}`}>
              <Value certainty="estimated">{itemText(i.name, i.quantity)}</Value> <span className={styles.note}>voce libera</span>
            </li>
          ))}
        </ul>
        {meal.removedLines ? (
          <p className={styles.note}>
            {meal.removedLines === 1 ? "Una voce è stata tolta dalla dispensa." : `${meal.removedLines} voci sono state tolte dalla dispensa.`}
          </p>
        ) : null}
        <div>
          <Button variant="text" onClick={() => setOpenMeal(open ? null : meal.mealId)} aria-expanded={open}>
            Annulla questo pasto
          </Button>
        </div>
        {open ? (
          <div className={styles.undoPanel} role="group" aria-label="Conferma annullamento del pasto">
            <p className={ui.paragraph}>Vuoi annullare «{title}»? Gli alimenti scalati dalla dispensa tornano com&apos;erano.</p>
            <div className={ui.row}>
              <Button onClick={() => void undoWith((deviceId, at) => voidMeal(meal.mealId, log, { deviceId, now: () => at }), title)} disabled={undoing}>
                Sì, annulla il pasto
              </Button>
              <Button variant="outline" onClick={() => setOpenMeal(null)} disabled={undoing}>
                No, tienilo
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {pastDay ? null : (
        <div className={styles.actions}>
          <div className={styles.primaryRow}>
            <Button href="/app/pasto">Registra pasto</Button>
            {plan.shoppingCount > 0 ? (
              <Button href="/app/spesa" variant="outline">
                {plan.shoppingCount === 1 ? "Spesa: 1 voce" : `Spesa: ${plan.shoppingCount} voci`}
              </Button>
            ) : null}
          </div>
          <div className={styles.actionRow}>
            <Button variant="outline" href="/app/cattura">
              Aggiungi alimento
            </Button>
          </div>
        </div>
      )}

      <p className={ui.callout} role="status">
        {summary.text}
      </p>

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {proposals.slice(0, 2).map((habit) => (
        <div key={habit.habitId} className={`${styles.proposal} ${ui.tile} ${ui.tone}`} data-tone="today">
          <div className={styles.proposalText}>
            <Label>Proposta per ora</Label>
            <span className={styles.proposalTitle}>{habit.title}</span>
            <span className={ui.hint}>{habit.items.map((i) => itemText(i.name, i.quantity)).join(", ")}</span>
          </div>
          <Button onClick={() => void registerHabit(habit)} disabled={busy}>
            Registra
          </Button>
        </div>
      ))}

      {proposals.length > 0 ? (
        <Link href="/app/pasti-abituali" className={ui.textLink}>
          Pasti abituali
        </Link>
      ) : null}

      <MealMoments
        date={date}
        now={now}
        timeZone={timeZone}
        day={day}
        habits={diary.data.habits}
        meals={meals}
        renderMeal={renderMeal}
        pastDay={pastDay}
        onError={setError}
        onRemoveDeclaration={(eventId, description) => {
          const event = log.find((e) => e.id === eventId);
          if (event) void undoWith((deviceId, at) => buildUndo([event], { deviceId, now: at }), description);
        }}
      />

      {planned.length > 0 && !pastDay ? (
        <section className={ui.section}>
          <SectionHeader label="Pianificato per oggi" actionLabel="Settimana" actionHref="/app/piano/settimana" />
          <ul className={`${styles.list} ${ui.group}`}>
            {planned.map((p, i) => (
              <li key={`${p.meal}-${i}`} className={styles.meal}>
                <div className={styles.mealHead}>
                  <span className={styles.mealTitle}>{p.text}</span>
                  <span className={styles.mealTime}>{MEAL_KIND_LABELS[p.meal].toLowerCase()}</span>
                </div>
                {p.note ? <p className={styles.note}>{p.note}</p> : null}
                <div>
                  <Button variant="text" href="/app/piano/settimana">
                    Registralo
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pastDay ? null : (
        <MissedPlanned
          missed={missed}
          weekStart={plan.weekStart}
          weekEntries={plan.weekEntries}
          nextWeekStart={plan.nextWeekStart}
          nextWeekEntries={plan.nextWeekEntries}
          kinds={plan.kinds}
          catalog={plan.catalog}
          diary={diary.data}
          now={now}
          timeZone={timeZone}
          today={today}
        />
      )}

      <details className={`${styles.drinksBox} ${ui.tone}`} data-tone="water">
        <summary className={styles.drinksSummary}>
          <span>Bevande</span>
          <span className={styles.drinksCount}>{drinkLine === "" ? "scelte rapide" : drinkLine}</span>
        </summary>
        <div className={styles.drinksBody}>
          {pastDay ? (
            <>
              <fieldset className={ui.field}>
                <legend className={ui.fieldLabel}>Quando</legend>
                <div className={ui.choices}>
                  {(["breakfast", "lunch", "dinner", "snack"] as const).map((k) => (
                    <label key={k} className={ui.choice}>
                      <input
                        type="radio"
                        name="past-drink-moment"
                        value={k}
                        checked={pastMoment === k}
                        onChange={() => {
                          setPastMoment(k);
                          setPastTimeEdit(null);
                        }}
                      />
                      <span>{k === "snack" ? "Fuori pasto" : MEAL_KIND_LABELS[k]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor="past-drink-time">
                  Ora in cui l&apos;hai bevuta
                </label>
                <input
                  id="past-drink-time"
                  className={ui.input}
                  type="time"
                  value={pastTime}
                  onChange={(e) => setPastTimeEdit(e.target.value)}
                />
              </div>
            </>
          ) : null}
          {pastDay && pastAt === undefined ? (
            <p className={ui.hint}>Scegli un&apos;ora per segnare una bevanda di questo giorno.</p>
          ) : (
            <DrinkPresetChips
              actions={drinkActions}
              onError={setError}
              when={pastDay && pastAt ? { at: pastAt, dayLabel: relativeDay(date, today) } : undefined}
              onAdded={drinkSuggestion.offer}
            />
          )}
          <p className={ui.hint}>Una bevanda va nel momento a cui appartiene per orario. Non vale un pasto registrato.</p>
        </div>
      </details>

      {pastDay ? null : <DrinkPantrySuggestion suggestion={drinkSuggestion.suggestion} timeZone={timeZone} onDone={drinkSuggestion.dismiss} />}

      {pastDay ? null : (
        <section className={ui.section}>
          <SectionHeader label="Acqua" actionLabel="Salute" actionHref="/app/salute" />
          <WaterCard />
        </section>
      )}
    </>
  );
}
