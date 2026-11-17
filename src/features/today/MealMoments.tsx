"use client";

import { useState } from "react";
import {
  drinksByMoment,
  localMoment,
  momentOfMinutes,
  voidMeal,
  type DiaryDay,
  type DiaryDrink,
  type DiaryState,
  type MealDeclarationStatus,
  type MealKind,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent, PantryState } from "@/core/ledger";
import { Button, Value } from "@/design";
import { buildUndo } from "../actions";
import { Disclosure } from "../common";
import { shortTime } from "../drinks";
import { formatTime } from "../format";
import { useDrinkActions } from "../health/Drinks";
import {
  MEAL_KIND_LABELS,
  buildMealDeclaration,
  itemText,
  momentOffer,
  momentTitle,
  momentsOf,
  type DeclarableKind,
} from "../meals";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { DrinkLines } from "./DrinkLines";
import { LooseLine, PantryLine, type DayIntakeLookup } from "./MealLines";
import { mealSummary } from "./summaries";
import { useRemove } from "./useRemove";
import styles from "./Today.module.css";

interface Props {
  /** Giorno di calendario a cui si riferiscono le righe (`YYYY-MM-DD`). */
  date: string;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Istante corrente: decide quali momenti compaiono e quale parte aperto. */
  now: string;
  diary: DiaryState;
  day: DiaryDay | undefined;
  /** Pasti registrati del giorno, in ordine di orario. */
  meals: readonly MealWithPantry[];
  /** Gli alimenti mangiati senza un pasto, nel momento della loro ora. */
  loose: Readonly<Record<MealKind, readonly ConsumeEvent[]>>;
  log: readonly AnyEvent[];
  pantry: PantryState;
  /** Ciò che il piano prevede per oggi: si legge nella riga del momento ancora vuoto. */
  planned: readonly { meal: MealKind; text: string }[];
  intake: DayIntakeLookup;
  /** Un giorno già passato: tutti i momenti compaiono. */
  pastDay: boolean;
}

const STATUS_WORD: Record<MealDeclarationStatus, string> = { skipped: "saltato", untracked: "mangiato, senza dettagli" };

/**
 * Il giorno per momenti: colazione, pranzo, cena e ciò che sta fuori pasto, una voce per momento già cominciato. Un
 * momento senza pasto ha un solo comando in vista, «Registra»; «Saltato» e «Mangiato, senza dettagli» stanno dietro
 * «Altro». Un pasto registrato è una riga richiusa che dice che cosa contiene. Una bevanda non vale un pasto.
 */
export function MealMoments({ date, today, now, diary, day, meals, loose, log, pantry, planned, intake, pastDay }: Props) {
  const timeZone = diary.timeZone;
  const { recordWith, busy: recording } = useRecord();
  const { remove, busy: removing } = useRemove();
  const drinkActions = useDrinkActions(timeZone);
  const [changing, setChanging] = useState<DeclarableKind | null>(null);
  const [more, setMore] = useState<DeclarableKind | null>(null);
  // l'errore si legge nel momento in cui è nato
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const busy = recording || removing;
  const nowMinutes = localMoment(now, timeZone)?.minutes ?? 0;
  const current = pastDay ? undefined : momentOfMinutes(nowMinutes);
  const drinks = drinksByMoment(day, timeZone);
  const lotNames = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const nameOf = (c: ConsumeEvent) => lotNames.get(c.lotId) ?? "Alimento";

  const errorIn = (key: string) => (text: string | null) => setProblem(text ? { key, text } : null);
  const errorLine = (key: string) =>
    problem?.key === key ? (
      <p className={ui.error} role="alert">
        {problem.text}
      </p>
    ) : null;

  async function declare(kind: DeclarableKind, status: MealDeclarationStatus) {
    setProblem(null);
    const result = await recordWith((deviceId) => buildMealDeclaration(date, kind, status, { now: new Date().toISOString(), deviceId }));
    if (result.ok) {
      setChanging(null);
      setMore(null);
    } else errorIn(kind)(result.error);
  }

  async function removeWith(key: string, make: Parameters<typeof remove>[0], description: string) {
    setProblem(null);
    const failure = await remove(make, description);
    if (failure) errorIn(key)(failure);
  }

  function removeDeclaration(key: string, eventId: string, description: string) {
    const event = log.find((e) => e.id === eventId);
    if (event) void removeWith(key, (deviceId, at) => buildUndo([event], { deviceId, now: at }), description);
  }

  const registerHref = (kind: DeclarableKind) => (pastDay ? `/app/pasto?momento=${kind}&giorno=${date}` : `/app/pasto?momento=${kind}`);

  function renderMeal(meal: MealWithPantry, key: string) {
    const label = MEAL_KIND_LABELS[meal.kind];
    const title = meal.title ?? label;
    const summary = mealSummary({
      time: shortTime(meal.at, timeZone),
      ...(meal.title ? { moment: label.toLowerCase() } : {}),
      names: [...meal.pantryConsumes.map(nameOf), ...meal.items.map((i) => i.name)],
      energy: intake.mealOf(meal.mealId)?.totals.energyKcal,
    });
    return (
      <Disclosure key={meal.mealId} title={title} summary={summary} defaultOpen={meal.kind === current}>
        <ul className={styles.items}>
          {meal.pantryConsumes.map((c) => (
            <PantryLine key={c.id} consume={c} name={nameOf(c)} date={date} today={today} diary={diary} line={intake.lineOf(c.id)} kind={meal.kind} onError={errorIn(key)} />
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
          <Button variant="text" disabled={busy} onClick={() => void removeWith(key, (deviceId, at) => voidMeal(meal.mealId, log, { deviceId, now: () => at }), title)}>
            Togli il pasto
          </Button>
        </div>
      </Disclosure>
    );
  }

  const renderLoose = (c: ConsumeEvent, key: string) => (
    <LooseLine key={c.id} consume={c} name={nameOf(c)} date={date} today={today} diary={diary} line={intake.lineOf(c.id)} onError={errorIn(key)} />
  );

  const renderDrinks = (list: readonly DiaryDrink[], key: string) => (
    <DrinkLines drinks={list} date={date} now={now} actions={drinkActions} log={log} pantry={pantry} scalable={!pastDay} onError={errorIn(key)} />
  );

  const rows = momentsOf(day).flatMap((moment) => {
    const kindMeals = meals.filter((m) => m.kind === moment.kind);
    const kindDrinks = drinks[moment.kind];
    const kindLoose = loose[moment.kind];
    // Un momento con qualcosa dentro o dichiarato si mostra sempre; uno non ancora cominciato, no.
    const hidden = momentOffer(moment.kind, nowMinutes, { pastDay }) === "hidden";
    if (hidden && moment.status === "none" && kindDrinks.length === 0 && kindLoose.length === 0) return [];
    const legacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === moment.kind);
    return [{ moment, kindMeals, kindDrinks, kindLoose, legacy }];
  });
  const snackMeals = meals.filter((m) => m.kind === "snack");
  const snackLegacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === "snack");
  const hasSnacks = snackMeals.length > 0 || drinks.offMeal.length > 0 || snackLegacy.length > 0 || loose.snack.length > 0;

  if (rows.length === 0 && !hasSnacks) return null;

  return (
    <ul className={`${styles.list} ${styles.momentList}`}>
      {rows.map(({ moment, kindMeals, kindDrinks, kindLoose, legacy }) => {
        const { kind, status } = moment;
        const declared = status === "skipped" || status === "untracked";
        const recorded = status === "recorded";
        const name = MEAL_KIND_LABELS[kind].toLowerCase();
        const removeId = moment.declarationEventId ?? legacy[0]?.eventId;
        const plannedText = pastDay ? "" : planned.filter((p) => p.meal === kind).map((p) => p.text).join(", ");
        const under = plannedText !== "" ? `nel piano: ${plannedText}` : kindDrinks.length === 0 && kindLoose.length === 0 ? "niente registrato" : "";
        return (
          <li key={kind} className={styles.moment} data-status={status}>
            {recorded ? null : (
              <div className={styles.momentHead}>
                <div className={styles.momentText}>
                  <span className={styles.mealTitle}>{momentTitle(kind, status, kindDrinks.map((d) => d.name))}</span>
                  {status === "none" && under !== "" ? <span className={styles.note}>{under}</span> : null}
                </div>
                {declared ? (
                  <span className={styles.momentChoices}>
                    <Button variant="text" disabled={busy} onClick={() => setChanging(changing === kind ? null : kind)} aria-expanded={changing === kind}>
                      Cambia
                    </Button>
                    {removeId ? (
                      <Button variant="text" disabled={busy} onClick={() => removeDeclaration(kind, removeId, `${name} ${STATUS_WORD[status]}`)}>
                        Togli
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className={styles.momentChoices}>
                    <Button href={registerHref(kind)} variant="outline">
                      Registra
                    </Button>
                    <Button variant="text" disabled={busy} onClick={() => setMore(more === kind ? null : kind)} aria-expanded={more === kind}>
                      Altro
                    </Button>
                  </span>
                )}
              </div>
            )}

            {status === "none" && more === kind ? (
              <div className={styles.momentChoices} role="group" aria-label={`Altro per ${name}`}>
                <Button variant="outline" disabled={busy} onClick={() => void declare(kind, "skipped")}>
                  Saltato
                </Button>
                <Button variant="text" disabled={busy} onClick={() => void declare(kind, "untracked")}>
                  Mangiato, senza dettagli
                </Button>
              </div>
            ) : null}

            {declared && changing === kind ? (
              <div className={styles.momentChoices} role="group" aria-label={`Cambia ${name}`}>
                <Button href={registerHref(kind)} variant="outline">
                  Registra
                </Button>
                {status === "skipped" ? (
                  <Button variant="text" disabled={busy} onClick={() => void declare(kind, "untracked")}>
                    Mangiato, senza dettagli
                  </Button>
                ) : (
                  <Button variant="text" disabled={busy} onClick={() => void declare(kind, "skipped")}>
                    Saltato
                  </Button>
                )}
              </div>
            ) : null}

            {kindMeals.map((m) => renderMeal(m, kind))}

            {kindLoose.map((c) => renderLoose(c, kind))}

            {recorded
              ? legacy.map((u) => (
                  <p key={u.eventId} className={styles.note}>
                    {MEAL_KIND_LABELS[kind]} fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
                    <Button variant="text" disabled={busy} onClick={() => removeDeclaration(kind, u.eventId, `${name} fuori`)}>
                      Togli
                    </Button>
                  </p>
                ))
              : null}

            {renderDrinks(kindDrinks, kind)}

            {errorLine(kind)}
          </li>
        );
      })}

      {hasSnacks ? (
        <li className={styles.moment}>
          <div className={styles.momentHead}>
            <span className={styles.mealTitle}>Fuori pasto</span>
          </div>
          {snackMeals.map((m) => renderMeal(m, "snack"))}
          {loose.snack.map((c) => renderLoose(c, "snack"))}
          {snackLegacy.map((u) => (
            <p key={u.eventId} className={styles.note}>
              Fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
              <Button variant="text" disabled={busy} onClick={() => removeDeclaration("snack", u.eventId, "spuntino fuori")}>
                Togli
              </Button>
            </p>
          ))}
          {renderDrinks(drinks.offMeal, "snack")}
          {errorLine("snack")}
        </li>
      ) : null}
    </ul>
  );
}
