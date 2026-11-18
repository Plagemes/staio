"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { useDiary, useEventLog, usePantry } from "@/data";
import { Label, Wordmark } from "@/design";
import { PinnedViews } from "@/features/assistant";
import { closeSheetThen } from "../common";
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
import { REVEAL_MAX_DAYS_BACK, daysBefore, entryElementId, locateEntry } from "./reveal";
import { TodayDiary } from "./TodayDiary";
import { useBriefing } from "./useBriefing";
import { useTodayPlan } from "./useTodayPlan";
import styles from "./Today.module.css";

/** Fin dove si può tornare indietro con le frecce. */
const MAX_DAYS_BACK = REVEAL_MAX_DAYS_BACK;

/** Il giorno chiesto nell'indirizzo (`?giorno=YYYY-MM-DD`), come distanza da oggi. Fuori intervallo vale oggi. */
function daysBackFromParam(today: string, requested: string | null): number {
  if (!today || !requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return 0;
  const diff = daysBefore(today, requested);
  if (!Number.isFinite(diff) || diff < 0 || diff > MAX_DAYS_BACK) return 0;
  // Un giorno che non esiste (30 febbraio) scivolerebbe sul mese dopo: vale solo se torna uguale a sé stesso
  return addDays(today, -diff) === requested ? diff : 0;
}

/** Una riga del diario da portare in vista: `fromLink` se l'ha chiesta l'indirizzo (`?voce=`), che se non la trova lo dice. */
interface RevealRequest {
  elementId: string;
  fromLink: boolean;
  /** Ogni richiesta è nuova, anche per la stessa riga. */
  serial: number;
}

/** Quanto si aspetta, al massimo, che la riga compaia nel diario (il registro si aggiorna un attimo dopo la scrittura). */
const REVEAL_WAIT_MS = 3000;
const REVEAL_POLL_MS = 100;
const HIGHLIGHT_MS = 2000;
const FADE_MS = 500;
/** Distanza minima tra la riga e i bordi di ciò che la coprirebbe (avviso, barra in basso). */
const REVEAL_MARGIN_PX = 16;

/** L'elemento della riga: `id="voce-<id>"`, altrimenti una voce libera del pasto (`voce-<id>-<posizione>`), altrimenti una riga che racconta più eventi. */
function findEntryElement(elementId: string): HTMLElement | null {
  const exact = document.getElementById(elementId);
  if (exact) return exact;
  const item = document.querySelector<HTMLElement>(`[id^="${CSS.escape(`${elementId}-`)}"]`);
  if (item) return item;
  const eventId = elementId.replace(/^voce-/, "");
  return document.querySelector<HTMLElement>(`[data-voci~="${CSS.escape(eventId)}"]`);
}

/** Dove comincia, dal basso, ciò che copre la pagina: l'avviso e la barra in basso (fissi o appiccicati al fondo). */
function bottomObstruction(): number {
  let limit = window.innerHeight;
  const probe = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 2);
  for (let el = probe; el; el = el.parentElement) {
    const position = getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      limit = Math.min(limit, el.getBoundingClientRect().top);
      break;
    }
  }
  for (const status of document.querySelectorAll<HTMLElement>("[role='status'][aria-live]")) {
    const parent = status.parentElement;
    if (parent && getComputedStyle(parent).position === "fixed") limit = Math.min(limit, status.getBoundingClientRect().top);
  }
  return limit;
}

/** Scorre quanto basta perché la riga stia tutta tra il bordo in alto e ciò che copre il fondo; se è già in vista non si muove. */
function bringIntoView(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const top = REVEAL_MARGIN_PX;
  const bottom = bottomObstruction() - REVEAL_MARGIN_PX;
  if (rect.top >= top && rect.bottom <= bottom) return;
  // più alta dello spazio libero, o sopra il bordo: si allinea in alto
  const delta = rect.bottom > bottom && rect.height <= bottom - top ? rect.bottom - bottom : rect.top - top;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
}

/** Apre le righe richiuse (`<details>`, cioè `Disclosure`) che contengono l'elemento. */
function openEnclosing(el: HTMLElement): void {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
  }
}

function highlight(el: HTMLElement): void {
  el.classList.remove(styles.revealFade);
  el.classList.add(styles.revealed);
  window.setTimeout(() => {
    el.classList.replace(styles.revealed, styles.revealFade);
    window.setTimeout(() => el.classList.remove(styles.revealFade), FADE_MS);
  }, HIGHLIGHT_MS);
}

/**
 * Oggi, nell'ordine del bisogno: che cosa registrare adesso, che cosa guardare, il diario del giorno, e richiuso ciò
 * che non serve a ogni visita (che cosa scade, i nutrienti). Un giorno passato mostra solo il suo diario.
 * `?voce=<id evento>` apre il giorno di quella voce e la porta in vista, evidenziata.
 */
export function Today() {
  const pantry = usePantry();
  const log = useEventLog();
  const diary = useDiary();
  const now = useNow();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // null: nessuna scelta con le frecce, vale il giorno chiesto nell'indirizzo
  const [chosenDaysBack, setDaysBack] = useState<number | null>(null);
  const [waterOpen, setWaterOpen] = useState(false);
  const [waterShown, setWaterShown] = useState(0);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [entryGone, setEntryGone] = useState(false);
  // la `voce` dell'indirizzo già letta: si legge una volta, poi si toglie dall'indirizzo
  const [handledEntry, setHandledEntry] = useState<string | null>(null);
  // il giorno della voce trovata: l'indirizzo, togliendo `voce`, dice questo giorno e non quello chiesto prima
  const [entryDay, setEntryDay] = useState<string | null>(null);
  const requestedDay = searchParams.get("giorno");
  const requestedEntry = searchParams.get("voce");

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  // niente nel registro e niente in dispensa: la prima apertura, con la scheda guidata e «Adesso» soltanto
  const firstTime = entries.length === 0 && log.data?.length === 0;
  const failed = Boolean(pantry.error || log.error || diary.error);
  const today = now ? dayOf(now) : "";
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;

  // `?voce=`: vale il giorno della voce, anche se l'indirizzo ne chiede un altro con `?giorno=`
  if (requestedEntry === null && handledEntry !== null) setHandledEntry(null);
  if (requestedEntry !== null && requestedEntry !== handledEntry && log.data && diary.data && pantry.data && today) {
    const voided = new Set([...diary.data.voidedEventIds, ...pantry.data.voidedEventIds]);
    const place = locateEntry(log.data, requestedEntry, { timeZone, today, voided });
    setHandledEntry(requestedEntry);
    setEntryDay(place.found ? place.date : null);
    if (place.found) {
      setDaysBack(daysBefore(today, place.date));
      setEntryGone(false);
      setReveal((r) => ({ elementId: place.elementId, fromLink: true, serial: (r?.serial ?? 0) + 1 }));
    } else {
      setEntryGone(true);
    }
  }

  const daysBack = chosenDaysBack ?? daysBackFromParam(today, requestedDay);
  const viewDate = today ? addDays(today, -daysBack) : "";
  const isPast = daysBack > 0;
  const todayPlan = useTodayPlan();

  const missed = useMemo(
    () =>
      diary.data && now && !isPast && todayPlan.ready && todayPlan.catalog
        ? missedThisWeek({ weekEntries: todayPlan.weekEntries, diary: diary.data, now, timeZone, today, adherence: todayPlan.adherence })
        : [],
    [diary.data, now, isPast, todayPlan.ready, todayPlan.catalog, todayPlan.weekEntries, todayPlan.adherence, timeZone, today],
  );
  const briefing = useBriefing({ now, viewDate, pantry: pantry.data, log: log.data, plan: todayPlan });

  const goToDay = (next: number) => {
    setDaysBack(next);
    setEntryGone(false);
  };

  /** Apre la riga «Acqua» del diario e la porta in vista. */
  const showWater = useCallback(() => {
    setWaterOpen(true);
    setWaterShown((n) => n + 1);
  }, []);

  /** Dopo una bevanda segnata in «Adesso»: quando la sua riga è nel diario, la porta in vista. */
  const showDrink = useCallback((drinkEventId: string) => {
    setReveal((r) => ({ elementId: entryElementId(drinkEventId), fromLink: false, serial: (r?.serial ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (waterShown === 0) return;
    // il foglio «Bevande», chiudendosi, fa un passo indietro nella cronologia: si scorre quando il browser ha finito
    const timer = window.setTimeout(() => document.getElementById("acqua")?.scrollIntoView({ block: "center" }), 250);
    return () => window.clearTimeout(timer);
  }, [waterShown]);

  // `voce` letta: si toglie dall'indirizzo, tenendo il resto; `giorno` segue il giorno mostrato, se la voce c'è
  useEffect(() => {
    if (requestedEntry === null || requestedEntry !== handledEntry) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("voce");
    if (entryDay !== null && entryDay === today) params.delete("giorno");
    else if (entryDay !== null) params.set("giorno", entryDay);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [requestedEntry, handledEntry, entryDay, today, searchParams, pathname, router]);

  // La riga si cerca quando un foglio che si chiude ha tolto il suo passo dalla cronologia (il router, tornando, scorre
  // la pagina) e finché il registro non l'ha portata nel diario; poi si aprono le righe richiuse che la contengono.
  useEffect(() => {
    if (!reveal) return;
    let cancelled = false;
    const timers: number[] = [];
    const later = (run: () => void, ms: number) => timers.push(window.setTimeout(run, ms));
    const started = Date.now();

    const attempt = () => {
      if (cancelled) return;
      const el = findEntryElement(reveal.elementId);
      if (!el) {
        if (Date.now() - started < REVEAL_WAIT_MS) later(attempt, REVEAL_POLL_MS);
        else if (reveal.fromLink) setEntryGone(true);
        return;
      }
      openEnclosing(el);
      // una riga appena aperta cambia l'altezza della pagina: si misura al fotogramma dopo
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          bringIntoView(el);
          highlight(el);
        }),
      );
    };

    closeSheetThen(() => later(attempt, 0));
    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [reveal]);

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
                onClick={() => goToDay(daysBack + 1)}
              >
                ‹
              </button>
              <Label className={styles.dayLabel}>{formatDayLabel(new Date(`${viewDate}T12:00:00Z`))}</Label>
              <button type="button" className={styles.dayArrow} aria-label="Giorno dopo" disabled={!isPast} onClick={() => goToDay(daysBack - 1)}>
                ›
              </button>
              {isPast ? (
                <button type="button" className={styles.dayToday} onClick={() => goToDay(0)}>
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
          <TodayDiary
            now={now}
            today={today}
            date={viewDate}
            diary={diary.data}
            pantry={pantry.data}
            log={log.data}
            plan={todayPlan}
            waterOpen={false}
            onWaterOpenChange={setWaterOpen}
            entryGone={entryGone}
          />
        ) : (
          <>
            {firstTime ? <FirstStepToday /> : null}

            <Now
              now={now}
              today={today}
              diary={diary.data}
              pantry={pantry.data}
              onShowWater={firstTime ? undefined : showWater}
              onDrinkAdded={firstTime ? undefined : showDrink}
            />

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
                  entryGone={entryGone}
                />

                <div className={styles.rows}>
                  <Expiring entries={entries} today={today} />
                  <TodayNutrition now={now} />
                </div>

                <PinnedViews />
              </>
            )}
          </>
        )
      ) : null}
    </div>
  );
}
