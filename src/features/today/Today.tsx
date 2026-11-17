"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { addDays } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import { appendEvents, getDeviceId, useEventLog, usePantry } from "@/data";
import { Button, LedgerRow, Label, PantryRow, PromptCard, SectionHeader, Value, Wordmark } from "@/design";
import { PinnedViews } from "@/features/assistant";
import { buildUndo } from "../actions";
import { TodayNutrition } from "../nutrition/TodayNutrition";
import { DayBriefing } from "./DayBriefing";
import { TodayDiary } from "./TodayDiary";
import { useBriefing } from "./useBriefing";
import { useTodayPlan } from "./useTodayPlan";
import { useNotice } from "../notice";
import { dayOf, formatDayLabel, relativeDay } from "../format";
import { LOCATION_LABELS } from "../labels";
import { buildJournal } from "../journal";
import { evaluateLots, expiryTagView, levelPercent } from "../lots";
import { breakdownText, groupEntries, groupName } from "../pantry/groups";
import { SaveExpiringRow } from "../pantry/SaveExpiring";
import { entryDetail, entryExpiry } from "../pantry/rows";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { FirstStepToday } from "../shell/FirstStep";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import styles from "./Today.module.css";

const EAT_FIRST_COUNT = 4;
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

export function Today() {
  const pantry = usePantry();
  const log = useEventLog();
  const now = useNow();
  const notice = useNotice();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  // null: nessuna scelta con le frecce, vale il giorno chiesto nell'indirizzo
  const [chosenDaysBack, setDaysBack] = useState<number | null>(null);
  const requestedDay = useSearchParams().get("giorno");

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const eatFirst = useMemo(() => groupEntries(entries).slice(0, EAT_FIRST_COUNT), [entries]);
  const rows = useMemo(
    () => (pantry.data && log.data && now ? buildJournal(log.data, pantry.data, dayOf(now)) : []),
    [pantry.data, log.data, now],
  );

  /** Una riga del registro può raccontare più eventi uguali (tre confezioni arrivate insieme): si annullano tutti. */
  async function undoEvent(eventIds: readonly string[], description: string) {
    const targets = (log.data ?? []).filter((e) => eventIds.includes(e.id));
    if (targets.length === 0 || busy) return;
    setBusy(true);
    setUndoError(null);
    try {
      const voids = buildUndo(targets, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      await appendEvents(voids);
      setOpenId(null);
      // «Annulla» sull'avviso annulla l'annullamento: l'evento torna com'era
      notice.show({ message: `Annullato: ${description}.`, undo: voids });
    } catch {
      setUndoError("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  const ready = pantry.data !== undefined && log.data !== undefined && now !== null;
  const today = now ? dayOf(now) : "";
  const daysBack = chosenDaysBack ?? daysBackFromParam(today, requestedDay);
  const viewDate = today ? addDays(today, -daysBack) : "";
  const isPast = daysBack > 0;
  const todayPlan = useTodayPlan();
  const briefing = useBriefing({ now, viewDate, pantry: pantry.data, log: log.data, plan: todayPlan });

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

      {pantry.error || log.error ? <StorageError /> : null}
      {!ready && !pantry.error && !log.error ? <LoadingLine /> : null}

      {isPast ? null : <DayBriefing view={briefing} />}

      {ready && pantry.data && log.data && now ? (
        <>
          {isPast ? (
            <p className={styles.pastBanner}>
              Stai guardando {relativeDay(viewDate, today)}. Qui puoi segnare un pasto saltato o non registrato e aggiungere una bevanda dimenticata.
            </p>
          ) : null}

          {!isPast && entries.length === 0 && log.data.length === 0 ? <FirstStepToday /> : null}

          <TodayDiary now={now} date={viewDate} pantry={pantry.data} log={log.data} plan={todayPlan} />

          {isPast ? null : (
          <>
          {entries.length === 0 ? null : (
          <section className={ui.section}>
            <SectionHeader label="Da mangiare prima" actionLabel="Tutta la dispensa" actionHref="/app/dispensa" />
              <ul className={`${styles.list} ${ui.group}`}>
                {eatFirst.map((group) => {
                  const entry = group.entries[0];
                  const breakdown = breakdownText(group);
                  return (
                    <li key={group.key} className={ui.stateRow} data-state={expiryTagView(entry)?.level}>
                      <PantryRow
                        name={groupName(group)}
                        detail={
                          breakdown ? (
                            <>
                              {LOCATION_LABELS[entry.lot.location]} · {breakdown}
                            </>
                          ) : (
                            entryDetail(entry, today)
                          )
                        }
                        level={levelPercent(entry.lot)}
                        levelLabel={`Rimasto circa il ${Math.round(levelPercent(entry.lot))} per cento`}
                        expiry={entryExpiry(entry)}
                      />
                      <SaveExpiringRow entry={entry} />
                    </li>
                  );
                })}
              </ul>
            <div className={ui.row}>
              <Link href="/app/ricette/idee" className={ui.textLink}>
                Idee di ricette con ciò che hai
              </Link>
            </div>
          </section>
          )}

          <TodayNutrition now={now} />

          <PinnedViews />

          <PromptCard title="Chiedi" description="Domande sui tuoi dati, con la risposta e da dove viene" href="/app/assistente" />

          {rows.length === 0 ? null : (
          <section className={ui.section}>
            <SectionHeader label="Registro di oggi" />
              <ul className={`${styles.list} ${ui.group}`}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <div className={styles.entry}>
                    <LedgerRow
                      time={row.time}
                      description={row.description}
                      value={row.estimated ? <Value certainty="estimated">{row.value}</Value> : row.value}
                    />
                    <button
                      type="button"
                      className={styles.open}
                      aria-label={`Annullare? ${row.time} ${row.description}`}
                      aria-expanded={openId === row.id}
                      aria-controls={`undo-${row.id}`}
                      onClick={() => {
                        setUndoError(null);
                        setOpenId(openId === row.id ? null : row.id);
                      }}
                    />
                    </div>
                    {openId === row.id ? (
                      <div className={styles.undoPanel} id={`undo-${row.id}`} role="group" aria-label="Annulla questo evento">
                        {row.canUndo ? (
                          <>
                            <p className={ui.paragraph}>
                              Vuoi annullare «{row.description}»? Resta nel registro come annullato e la dispensa torna com&apos;era
                              prima.
                            </p>
                            <div className={ui.row}>
                              <Button onClick={() => void undoEvent(row.ids, row.description)} disabled={busy}>
                                Sì, annulla questo evento
                              </Button>
                              <Button variant="outline" onClick={() => setOpenId(null)} disabled={busy}>
                                No, lascia com&apos;è
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className={ui.paragraph}>{row.undoBlocked}</p>
                            <div className={ui.row}>
                              <Button variant="outline" onClick={() => setOpenId(null)}>
                                Chiudi
                              </Button>
                            </div>
                          </>
                        )}
                        {undoError ? (
                          <p className={ui.error} role="alert">
                            {undoError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
          </section>
          )}
          </>
          )}
        </>
      ) : null}
    </div>
  );
}
