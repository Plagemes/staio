"use client";

import { useState, type ReactNode } from "react";
import {
  drinksByMoment,
  localMoment,
  type DiaryDay,
  type DiaryHabit,
  type MealDeclarationStatus,
  type MealWithPantry,
} from "@/core/diary";
import { Button, SectionHeader } from "@/design";
import { formatTime } from "../format";
import { DrinkEntries, useDrinkActions } from "../health/Drinks";
import {
  MEAL_KIND_LABELS,
  buildMealDeclaration,
  momentOffer,
  momentTitle,
  momentsOf,
  type DeclarableKind,
} from "../meals";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import styles from "./Today.module.css";

interface Props {
  /** Giorno di calendario a cui si riferiscono le righe (`YYYY-MM-DD`). */
  date: string;
  /** Istante corrente: decide quali momenti compaiono e quando si propone «Saltato». */
  now: string;
  timeZone: string;
  day: DiaryDay | undefined;
  habits: readonly DiaryHabit[];
  /** Pasti registrati del giorno, in ordine di orario. */
  meals: readonly MealWithPantry[];
  /** Come si mostra un pasto registrato (alimenti, annulla). */
  renderMeal: (meal: MealWithPantry) => ReactNode;
  /** Un giorno già passato: ogni momento è dichiarabile e non si propone di registrare adesso. */
  pastDay?: boolean;
  /** Toglie una dichiarazione o un «non tracciato» (un `void`, con «Annulla» sull'avviso). */
  onRemoveDeclaration: (eventId: string, description: string) => void;
  onError: (message: string | null) => void;
}

/**
 * Il giorno per momenti: colazione, pranzo, cena e fuori pasto. Ogni momento mostra i suoi pasti, le sue bevande e,
 * se non c'è un pasto registrato, una riga compatta con «Registra», «Saltato» e, meno in evidenza, «Mangiato, non
 * registrato». Lo stato scelto resta scritto («Pranzo · saltato») e si può cambiare. Una bevanda non vale un pasto.
 */
export function MealMoments({ date, now, timeZone, day, habits, meals, renderMeal, pastDay = false, onRemoveDeclaration, onError }: Props) {
  const { recordWith, busy } = useRecord();
  const drinkActions = useDrinkActions(timeZone);
  const [changing, setChanging] = useState<DeclarableKind | null>(null);
  const nowMinutes = localMoment(now, timeZone)?.minutes ?? 0;
  const drinks = drinksByMoment(day, timeZone);

  async function declare(kind: DeclarableKind, status: MealDeclarationStatus) {
    onError(null);
    const result = await recordWith((deviceId) => buildMealDeclaration(date, kind, status, { now: new Date().toISOString(), deviceId }));
    if (result.ok) setChanging(null);
    else onError(result.error);
  }

  const rows = momentsOf(day).flatMap((moment) => {
    const kindMeals = meals.filter((m) => m.kind === moment.kind);
    const kindDrinks = drinks[moment.kind];
    const usualTime = habits.find((h) => h.kind === moment.kind && h.usualTime !== undefined)?.usualTime;
    const offer = momentOffer(moment.kind, nowMinutes, { pastDay, usualTime });
    // Un momento con qualcosa dentro o dichiarato si mostra sempre; uno non ancora cominciato, no.
    if (offer === "hidden" && moment.status === "none" && kindDrinks.length === 0) return [];
    const legacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === moment.kind);
    return [{ moment, kindMeals, kindDrinks, offer, legacy }];
  });
  const snackMeals = meals.filter((m) => m.kind === "snack");
  const snackLegacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === "snack");
  const hasLoose = snackMeals.length > 0 || drinks.offMeal.length > 0 || snackLegacy.length > 0;

  if (rows.length === 0 && !hasLoose) {
    return pastDay ? null : (
      <section className={ui.section} aria-label="Momenti del giorno">
        <SectionHeader label="Momenti di oggi" />
        <p className={styles.quiet}>Nessun pasto registrato. Quando ne registri uno, compare qui con gli alimenti.</p>
      </section>
    );
  }

  return (
    <section className={ui.section} aria-label="Momenti del giorno">
      <SectionHeader label={pastDay ? "Pasti del giorno" : "Momenti di oggi"} />
      <ul className={styles.list}>
        {rows.map(({ moment, kindMeals, kindDrinks, offer, legacy }) => {
          const { kind, status } = moment;
          const declared = status === "skipped" || status === "untracked";
          const recorded = status === "recorded";
          const showChoices = !recorded && (!declared || changing === kind);
          const name = MEAL_KIND_LABELS[kind].toLowerCase();
          const removeId = moment.declarationEventId ?? legacy[0]?.eventId;
          return (
            <li key={kind} className={styles.moment}>
              {!recorded ? (
                <div className={styles.momentHead}>
                  <span className={styles.mealTitle}>{momentTitle(kind, status, kindDrinks.map((d) => d.name))}</span>
                  {declared ? (
                    <span className={styles.momentChoices}>
                      <Button variant="text" disabled={busy} onClick={() => setChanging(changing === kind ? null : kind)} aria-expanded={changing === kind}>
                        Cambia
                      </Button>
                      {removeId ? (
                        <Button
                          variant="text"
                          disabled={busy}
                          onClick={() => onRemoveDeclaration(removeId, `${name}: ${status === "skipped" ? "saltato" : "mangiato, non registrato"}`)}
                        >
                          Togli
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {kindMeals.map((m) => (
                <div key={m.mealId}>{renderMeal(m)}</div>
              ))}

              {recorded
                ? legacy.map((u) => (
                    <p key={u.eventId} className={styles.note}>
                      {MEAL_KIND_LABELS[kind]} fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
                      <Button variant="text" disabled={busy} onClick={() => onRemoveDeclaration(u.eventId, `${name} fuori`)}>
                        Togli
                      </Button>
                    </p>
                  ))
                : null}

              {kindDrinks.length > 0 ? <DrinkEntries drinks={kindDrinks} date={date} actions={drinkActions} onError={onError} /> : null}

              {status === "skipped" && kindDrinks.length > 0 ? (
                <p className={styles.notDone}>Saltato vuol dire nient&apos;altro oltre alle bevande: contano quelle, non zero.</p>
              ) : null}

              {showChoices ? (
                <div className={styles.momentChoices}>
                  <Button href={pastDay ? `/app/pasto?momento=${kind}&giorno=${date}` : `/app/pasto?momento=${kind}`} variant="outline">
                    Registra
                  </Button>
                  {offer === "declare" || declared ? (
                    <>
                      {status === "skipped" ? null : (
                        <Button variant="outline" disabled={busy} onClick={() => void declare(kind, "skipped")}>
                          Saltato
                        </Button>
                      )}
                      {status === "untracked" ? null : (
                        <Button variant="text" disabled={busy} onClick={() => void declare(kind, "untracked")}>
                          Mangiato, non registrato
                        </Button>
                      )}
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}

        {hasLoose ? (
          <li className={styles.moment}>
            <div className={styles.momentHead}>
              <span className={styles.mealTitle}>Fuori pasto</span>
            </div>
            {snackMeals.map((m) => (
              <div key={m.mealId}>{renderMeal(m)}</div>
            ))}
            {snackLegacy.map((u) => (
              <p key={u.eventId} className={styles.note}>
                Fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
                <Button variant="text" disabled={busy} onClick={() => onRemoveDeclaration(u.eventId, "spuntino fuori")}>
                  Togli
                </Button>
              </p>
            ))}
            <DrinkEntries drinks={drinks.offMeal} date={date} actions={drinkActions} onError={onError} />
          </li>
        ) : null}
      </ul>
    </section>
  );
}
