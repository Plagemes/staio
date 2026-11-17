"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { useDiary, useEventLog, usePantry } from "@/data";
import { Label, PromptCard, Wordmark } from "@/design";
import { PinnedViews } from "@/features/assistant";
import { dayOf, formatDayLabel } from "../format";
import { evaluateLots } from "../lots";
import { TodayNutrition } from "../nutrition/TodayNutrition";
import { missedThisWeek } from "../plan/moveMeal";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { FirstStepToday } from "../shell/FirstStep";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { DayBriefing, MISSED_ID } from "./DayBriefing";
import { Expiring } from "./Expiring";
import { MissedPlanned } from "./MissedPlanned";
import { Now } from "./Now";
import { TodayDiary } from "./TodayDiary";
import { useBriefing } from "./useBriefing";
import { useTodayPlan } from "./useTodayPlan";
import styles from "./Today.module.css";

/** Fin dove si può tornare indietro con le frecce. */
const MAX_DAYS_BACK = 60;

/** Il giorno chiesto nell'indirizzo (`?giorno=YYYY-MM-DD`), come distanza da oggi. Fuori intervallo vale oggi. */
function daysBackFromParam(today: string, requested: string | null): number {
  if (!today || !requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return 0;
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${requested}T12:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(diff) || diff < 0 || diff > MAX_DAYS_BACK) return 0;
  // Un giorno che non esiste (30 febbraio) scivolerebbe sul mese dopo: vale solo se torna uguale a sé stesso
  return addDays(today, -diff) === requested ? diff : 0;
}

/**
 * Oggi, nell'ordine del bisogno: che cosa registrare adesso, che cosa guardare, il diario del giorno, e richiuso ciò
 * che non serve a ogni visita (che cosa scade, i nutrienti). Un giorno passato mostra solo il suo diario.
 */
export function Today() {
  const pantry = usePantry();
  const log = useEventLog();
  const diary = useDiary();
  const now = useNow();
  // null: nessuna scelta con le frecce, vale il giorno chiesto nell'indirizzo
  const [chosenDaysBack, setDaysBack] = useState<number | null>(null);
  const [waterOpen, setWaterOpen] = useState(false);
  const [waterShown, setWaterShown] = useState(0);
  const requestedDay = useSearchParams().get("giorno");

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  // niente nel registro e niente in dispensa: la prima apertura, con la scheda guidata e «Adesso» soltanto
  const firstTime = entries.length === 0 && log.data?.length === 0;
  const failed = Boolean(pantry.error || log.error || diary.error);
  const today = now ? dayOf(now) : "";
  const daysBack = chosenDaysBack ?? daysBackFromParam(today, requestedDay);
  const viewDate = today ? addDays(today, -daysBack) : "";
  const isPast = daysBack > 0;
  const todayPlan = useTodayPlan();
  const briefing = useBriefing({ now, viewDate, pantry: pantry.data, log: log.data, plan: todayPlan });
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;

  const missed = useMemo(
    () =>
      diary.data && now && !isPast && todayPlan.ready && todayPlan.catalog
        ? missedThisWeek({ weekEntries: todayPlan.weekEntries, diary: diary.data, now, timeZone, today, adherence: todayPlan.adherence })
        : [],
    [diary.data, now, isPast, todayPlan.ready, todayPlan.catalog, todayPlan.weekEntries, todayPlan.adherence, timeZone, today],
  );

  /** Apre la riga «Acqua» del diario e la porta in vista. */
  const showWater = useCallback(() => {
    setWaterOpen(true);
    setWaterShown((n) => n + 1);
  }, []);

  useEffect(() => {
    if (waterShown === 0) return;
    // il foglio «Bevande», chiudendosi, fa un passo indietro nella cronologia: si scorre quando il browser ha finito
    const timer = window.setTimeout(() => document.getElementById("acqua")?.scrollIntoView({ block: "center" }), 250);
    return () => window.clearTimeout(timer);
  }, [waterShown]);

  return (
    <div className={ui.screen}>
      <h1 className={ui.srOnly}>Oggi</h1>
      <div className={styles.topbar}>
        <Wordmark />
        <div className={styles.topRight}>
          {now ? (
            <div className={styles.dayNav}>
              <button
                type="button"
                className={styles.dayArrow}
                aria-label="Giorno prima"
                disabled={daysBack >= MAX_DAYS_BACK}
                onClick={() => setDaysBack(daysBack + 1)}
              >
                ‹
              </button>
              <Label className={styles.dayLabel}>{formatDayLabel(new Date(`${viewDate}T12:00:00Z`))}</Label>
              <button type="button" className={styles.dayArrow} aria-label="Giorno dopo" disabled={!isPast} onClick={() => setDaysBack(daysBack - 1)}>
                ›
              </button>
              {isPast ? (
                <button type="button" className={styles.dayToday} onClick={() => setDaysBack(0)}>
                  Oggi
                </button>
              ) : null}
            </div>
          ) : null}
          <Link href="/app/impostazioni" className={styles.settings} aria-label="Impostazioni">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
            </svg>
          </Link>
        </div>
      </div>

      {failed ? <StorageError /> : null}
      {!failed && !(pantry.data && log.data && diary.data && now) ? <LoadingLine /> : null}

      {pantry.data && log.data && diary.data && now ? (
        isPast ? (
          <TodayDiary now={now} today={today} date={viewDate} diary={diary.data} pantry={pantry.data} log={log.data} plan={todayPlan} waterOpen={false} onWaterOpenChange={setWaterOpen} />
        ) : (
          <>
            {firstTime ? <FirstStepToday /> : null}

            <Now now={now} today={today} diary={diary.data} pantry={pantry.data} onShowWater={firstTime ? undefined : showWater} />

            {firstTime ? null : (
              <>
                <DayBriefing
                  view={briefing}
                  shoppingCount={todayPlan.shoppingCount}
                  missedCount={missed.length}
                  onShowWater={showWater}
                  missed={
                    <MissedPlanned
                      id={MISSED_ID}
                      missed={missed}
                      weekStart={todayPlan.weekStart}
                      weekEntries={todayPlan.weekEntries}
                      nextWeekStart={todayPlan.nextWeekStart}
                      nextWeekEntries={todayPlan.nextWeekEntries}
                      kinds={todayPlan.kinds}
                      catalog={todayPlan.catalog}
                      diary={diary.data}
                      now={now}
                      timeZone={timeZone}
                      today={today}
                    />
                  }
                />

                <TodayDiary
                  now={now}
                  today={today}
                  date={viewDate}
                  diary={diary.data}
                  pantry={pantry.data}
                  log={log.data}
                  plan={todayPlan}
                  waterOpen={waterOpen}
                  onWaterOpenChange={setWaterOpen}
                />

                <div className={styles.rows}>
                  <Expiring entries={entries} today={today} />
                  <TodayNutrition now={now} />
                </div>

                <PinnedViews />

                <PromptCard title="Chiedi" description="Domande sui tuoi dati, con la risposta e da dove viene" href="/app/assistente" />
              </>
            )}
          </>
        )
      ) : null}
    </div>
  );
}
