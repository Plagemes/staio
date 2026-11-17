"use client";

import { useMemo, useState } from "react";
import { getDay, habitsToPropose, mealsWithPantry, voidMeal, type DiaryHabit } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { activeLots, type PantryState, type VoidEvent } from "@/core/ledger";
import { appendEvents, getDeviceId, useDiary } from "@/data";
import { Button, Label, SectionHeader, Value } from "@/design";
import { buildUndo } from "../actions";
import { dayOf, formatTime } from "../format";
import { WaterCard } from "../health/WaterCard";
import { evaluateLots } from "../lots";
import {
  MEAL_KIND_LABELS,
  buildMealFromHabit,
  buildUntrackedMeal,
  itemText,
  suggestMealKind,
  summarizeDay,
} from "../meals";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { useTodayPlan } from "./useTodayPlan";
import styles from "./Today.module.css";

interface Props {
  now: string;
  pantry: PantryState;
  log: readonly AnyEvent[];
}

/** La parte di diario di Oggi: stato del giorno, registrazione dei pasti, pasti abituali, acqua. */
export function TodayDiary({ now, pantry, log }: Props) {
  const diary = useDiary();
  const notice = useNotice();
  const { recordWith, busy } = useRecord();
  const plan = useTodayPlan();
  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  const today = dayOf(now);
  const kind = suggestMealKind(now);

  const proposals = useMemo(() => (diary.data ? habitsToPropose(diary.data, now) : []), [diary.data, now]);
  const meals = useMemo(
    () =>
      diary.data
        ? mealsWithPantry(diary.data, log)
            .filter((m) => m.date === today)
            .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
        : [],
    [diary.data, log, today],
  );

  if (!diary.data) return null;
  const day = getDay(diary.data, today);
  const summary = summarizeDay(day);
  const lotNames = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));

  async function registerHabit(habit: DiaryHabit) {
    setError(null);
    const lots = evaluateLots(activeLots(pantry), now).map((e) => e.lot);
    const result = await recordWith((deviceId) => {
      const built = buildMealFromHabit(habit, lots, { now: new Date().toISOString(), deviceId });
      return { events: built.events, message: built.message };
    });
    if (!result.ok) setError(result.error);
  }

  async function eatenOut() {
    setError(null);
    const result = await recordWith((deviceId) => buildUntrackedMeal(kind, { now: new Date().toISOString(), deviceId }));
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

  return (
    <>
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
          <Button variant="outline" onClick={() => void eatenOut()} disabled={busy}>
            Ho mangiato fuori
          </Button>
          <Button variant="outline" href="/app/cattura">
            Aggiungi alimento
          </Button>
        </div>
        <p className={ui.hint}>«Ho mangiato fuori» segna come non tracciato il {MEAL_KIND_LABELS[kind].toLowerCase()}: un vuoto non diventa un digiuno.</p>
      </div>

      <p className={ui.callout} role="status">
        {summary.text}
      </p>

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {proposals.slice(0, 2).map((habit) => (
        <div key={habit.habitId} className={styles.proposal}>
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

      {plan.planned.length > 0 ? (
        <section className={ui.section}>
          <SectionHeader label="Pianificato per oggi" actionLabel="Settimana" actionHref="/app/piano/settimana" />
          <ul className={styles.list}>
            {plan.planned.map((p, i) => (
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

      <section className={ui.section}>
        <SectionHeader label="Pasti di oggi" />
        {meals.length === 0 && (day?.untrackedMeals.length ?? 0) === 0 ? (
          <p className={styles.quiet}>Nessun pasto registrato. Quando ne registri uno, compare qui con gli alimenti.</p>
        ) : (
          <ul className={styles.list}>
            {meals.map((meal) => {
              const open = openMeal === meal.mealId;
              const title = meal.title ?? MEAL_KIND_LABELS[meal.kind];
              return (
                <li key={meal.mealId} className={styles.meal}>
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
                        <Value certainty={c.certainty === "estimated" ? "estimated" : "measured"}>
                          {itemText(lotNames.get(c.lotId) ?? "Alimento", c.quantity)}
                        </Value>
                      </li>
                    ))}
                    {meal.items.map((i, index) => (
                      <li key={`${i.name}-${index}`}>
                        <Value certainty="estimated">{itemText(i.name, i.quantity)}</Value> <span className={styles.note}>voce libera</span>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button variant="text" onClick={() => setOpenMeal(open ? null : meal.mealId)} aria-expanded={open}>
                      Annulla questo pasto
                    </Button>
                  </div>
                  {open ? (
                    <div className={styles.undoPanel} role="group" aria-label="Conferma annullamento del pasto">
                      <p className={ui.paragraph}>
                        Vuoi annullare «{title}»? Gli alimenti scalati dalla dispensa tornano com&apos;erano.
                      </p>
                      <div className={ui.row}>
                        <Button onClick={() => void undoWith((deviceId, now) => voidMeal(meal.mealId, log, { deviceId, now: () => now }), title)} disabled={undoing}>
                          Sì, annulla il pasto
                        </Button>
                        <Button variant="outline" onClick={() => setOpenMeal(null)} disabled={undoing}>
                          No, tienilo
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {(day?.untrackedMeals ?? []).map((u) => (
              <li key={u.eventId} className={styles.meal}>
                <div className={styles.mealHead}>
                  <span className={styles.mealTitle}>{MEAL_KIND_LABELS[u.kind]} fuori</span>
                  <span className={styles.mealTime}>{formatTime(u.at)}</span>
                </div>
                <p className={styles.note}>Non tracciato: nessun alimento registrato.</p>
                <div>
                  <Button
                    variant="text"
                    disabled={undoing}
                    onClick={() => {
                      const event = log.find((e) => e.id === u.eventId);
                      if (event) void undoWith((deviceId, now) => buildUndo([event], { deviceId, now }), `${MEAL_KIND_LABELS[u.kind]} fuori`);
                    }}
                  >
                    Togli
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={ui.section}>
        <SectionHeader label="Acqua" actionLabel="Salute" actionHref="/app/salute" />
        <WaterCard />
      </section>
    </>
  );
}
