"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { getDeviceId, useDiary, useEventLog, usePantry } from "@/data";
import { Label, Wordmark } from "@/design";
import { PinnedViews } from "@/features/assistant";
import { closeSheetThen } from "../common";
import { dayOf, formatDayLabel } from "../format";
import { evaluateLots } from "../lots";
import { TodayNutrition } from "../nutrition/TodayNutrition";
import { missedThisWeek } from "../plan/moveMeal";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { DayBriefing, MISSED_ID } from "./DayBriefing";
import { Expiring } from "./Expiring";
import { MissedPlanned } from "./MissedPlanned";
import { Now } from "./Now";
import { ENTRY_GONE_MS, ENTRY_WAIT_MS, REVEAL_MAX_DAYS_BACK, entryElementId, entryVerdict, locateEntry, viewedDaysBack } from "./reveal";
import { TodayDiary } from "./TodayDiary";
import { useBriefing } from "./useBriefing";
import { useTodayPlan } from "./useTodayPlan";
import styles from "./Today.module.css";

/** Fin dove si può tornare indietro con le frecce. */
const MAX_DAYS_BACK = REVEAL_MAX_DAYS_BACK;

/** Una riga del diario da portare in vista: `fromLink` se l'ha chiesta l'indirizzo (`?voce=`), che se non la trova lo dice. */
interface RevealRequest {
  elementId: string;
  fromLink: boolean;
  /** Ogni richiesta è nuova, anche per la stessa riga. */
  serial: number;
}

/** Una `?voce=` che il registro non ha ancora: resta in attesa, e si riprova a ogni lettura nuova (`entryVerdict`). */
interface EntryAsk {
  id: string;
  /** Millisecondi dall'arrivo sulla pagina, all'ultimo controllo dell'orologio. */
  waitedMs: number;
}

/** «Questa voce non c'è più.» è a schermo. */
interface EntryGone {
  /** L'ultimo registro guardato da quando è stato detto. `null`: ancora da prendere. */
  log: readonly AnyEvent[] | null;
  /** Quanti eventi scritti da questo telefono c'erano in quel registro: se crescono, qui si è scritto qualcosa. */
  written: number;
  forMs: number;
}

/**
 * Quanti eventi del registro ha scritto questo telefono. Ciò che arriva dall'altro telefono non conta: il messaggio
 * se ne va a una scrittura fatta qui, non a ogni registro ricevuto. Finché il dispositivo non si conosce, contano tutti.
 */
function writtenHere(events: readonly AnyEvent[], deviceId: string | null): number {
  if (deviceId === null) return events.length;
  let count = 0;
  for (const e of events) if (e.deviceId === deviceId) count++;
  return count;
}

/** Quanto si aspetta, al massimo, che la riga compaia nel diario (il registro si aggiorna un attimo dopo la scrittura). */
const REVEAL_WAIT_MS = 3000;
const REVEAL_POLL_MS = 100;
const HIGHLIGHT_MS = 2000;
const FADE_MS = 500;
/** Distanza minima tra la riga e i bordi di ciò che la coprirebbe (avviso, barra in basso). */
const REVEAL_MARGIN_PX = 16;
/** Dopo quanto si controlla una seconda volta che la riga sia in vista (il router, tornando sulla pagina, può averla riportata in cima). */
const REVEAL_RECHECK_MS = 400;
/** Quanto una scelta di giorno fatta con le frecce conta come «in arrivo»: l'indirizzo la raggiunge subito dopo. */
const DAY_NAV_SETTLE_MS = 1500;

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

/** La riga sta tutta tra il bordo in alto e ciò che copre il fondo. */
function fitsInView(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top >= REVEAL_MARGIN_PX && rect.bottom <= bottomObstruction() - REVEAL_MARGIN_PX;
}

/** Scorre quanto basta perché la riga stia tutta tra il bordo in alto e ciò che copre il fondo; se è già in vista non si muove. */
function bringIntoView(el: HTMLElement): void {
  if (fitsInView(el)) return;
  const rect = el.getBoundingClientRect();
  const top = REVEAL_MARGIN_PX;
  const bottom = bottomObstruction() - REVEAL_MARGIN_PX;
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
  // l'ultima scelta con le frecce, finché l'indirizzo non l'ha raggiunta: serve a contare giusto con tocchi in fretta
  const dayNav = useRef<{ daysBack: number; at: number } | null>(null);
  const [waterOpen, setWaterOpen] = useState(false);
  const [waterShown, setWaterShown] = useState(0);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [ask, setAsk] = useState<EntryAsk | null>(null);
  const [gone, setGone] = useState<EntryGone | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  // la `voce` dell'indirizzo già chiusa (mostrata, o data per persa): si toglie dall'indirizzo
  const [handledEntry, setHandledEntry] = useState<string | null>(null);
  // il giorno della voce trovata: l'indirizzo, togliendo `voce`, dice questo giorno e non quello chiesto prima
  const [entryDay, setEntryDay] = useState<string | null>(null);
  const requestedDay = searchParams.get("giorno");
  const requestedEntry = searchParams.get("voce");

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  // niente nel registro e niente in dispensa: la prima apertura, con «Adesso» e «Primi passi» soltanto
  const firstTime = entries.length === 0 && log.data?.length === 0;
  const failed = Boolean(pantry.error || log.error || diary.error);
  const today = now ? dayOf(now) : "";
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;

  // `?voce=`: vale il giorno della voce, anche se l'indirizzo ne chiede un altro con `?giorno=`
  if (requestedEntry === null && handledEntry !== null) setHandledEntry(null);
  // il messaggio di una voce che non c'è più se ne va alla prima scrittura fatta qui o quando ha fatto il suo tempo
  if (gone !== null && log.data) {
    if (gone.log === null) {
      setGone({ ...gone, log: log.data, written: writtenHere(log.data, deviceId) });
    } else {
      const wrote = gone.log !== log.data && writtenHere(log.data, deviceId) > gone.written;
      if (entryVerdict({ found: false, waitedMs: ENTRY_WAIT_MS, said: { forMs: gone.forMs, logChanged: wrote, dayChanged: false } }) === "over") setGone(null);
      // un registro arrivato senza una scrittura di qui (l'altro telefono): il messaggio resta
      else if (gone.log !== log.data) setGone({ ...gone, log: log.data });
    }
  }
  const openEntry = requestedEntry !== null && requestedEntry !== handledEntry ? requestedEntry : null;
  if (openEntry === null) {
    if (ask !== null) setAsk(null);
  } else if (ask?.id !== openEntry) {
    setAsk({ id: openEntry, waitedMs: 0 });
    // una richiesta nuova: ciò che si diceva di quella di prima non vale più
    if (gone !== null) setGone(null);
  } else if (log.data && diary.data && pantry.data && today) {
    // Si rifà a ogni disegno finché la richiesta è aperta: subito dopo una scrittura il registro in mano può essere
    // ancora quello di prima, e la voce compare alla lettura dopo.
    const voided = new Set([...diary.data.voidedEventIds, ...pantry.data.voidedEventIds]);
    const place = locateEntry(log.data, openEntry, { timeZone, today, voided });
    const verdict = entryVerdict({ found: place.found, waitedMs: ask.waitedMs });
    if (verdict !== "wait") {
      setAsk(null);
      setHandledEntry(openEntry);
      setEntryDay(place.found ? place.date : null);
      if (place.found) {
        setGone(null);
        setReveal((r) => ({ elementId: place.elementId, fromLink: true, serial: (r?.serial ?? 0) + 1 }));
      } else {
        setGone({ log: log.data, written: writtenHere(log.data, deviceId), forMs: 0 });
      }
    }
  }
  const entryGone = gone !== null;
  const askId = ask?.id ?? null;

  // il giorno è quello dell'indirizzo; la pagina resta viva tra una visita e l'altra, quindi non se ne tiene copia
  const daysBack = viewedDaysBack({ today, requestedDay, requestedEntry, handledEntry, entryDay });
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
    dayNav.current = { daysBack: next, at: Date.now() };
    setGone(null);
    // chi cambia giorno mentre una voce è attesa ha scelto dove guardare: la richiesta si chiude
    if (openEntry !== null) {
      setAsk(null);
      setHandledEntry(openEntry);
      setEntryDay(null);
    }
    // l'indirizzo dice il giorno; gli altri parametri si conservano, `voce` no
    const params = new URLSearchParams(searchParams.toString());
    params.delete("giorno");
    params.delete("voce");
    if (next > 0) params.set("giorno", addDays(today, -next));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  /** Un giorno avanti o indietro: parte dall'ultima scelta se l'indirizzo non l'ha ancora raggiunta. */
  const stepDay = (delta: number) => {
    const last = dayNav.current;
    const from = last && Date.now() - last.at < DAY_NAV_SETTLE_MS ? last.daysBack : daysBack;
    goToDay(Math.min(MAX_DAYS_BACK, Math.max(0, from + delta)));
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

  useEffect(() => {
    let live = true;
    getDeviceId().then(
      (id) => {
        if (live) setDeviceId(id);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  // l'attesa di una voce che non c'è ancora: passato il tempo, l'orologio fa ridisegnare e `entryVerdict` decide
  useEffect(() => {
    if (askId === null) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => setAsk((a) => (a?.id === askId ? { ...a, waitedMs: Math.max(Date.now() - started, ENTRY_WAIT_MS) } : a)),
      ENTRY_WAIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [askId]);

  // «Questa voce non c'è più.» se ne va da solo
  useEffect(() => {
    if (!entryGone) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setGone((g) => (g ? { ...g, forMs: Math.max(Date.now() - started, ENTRY_GONE_MS) } : g)), ENTRY_GONE_MS);
    return () => window.clearTimeout(timer);
  }, [entryGone]);

  // `voce` chiusa: si toglie dall'indirizzo, tenendo il resto; `giorno` segue il giorno mostrato, se la voce c'è
  useEffect(() => {
    if (requestedEntry === null || requestedEntry !== handledEntry) return;
    // chi ha appena scelto un giorno con le frecce ha già riscritto l'indirizzo senza `voce`
    if (dayNav.current && Date.now() - dayNav.current.at < DAY_NAV_SETTLE_MS) return;
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
    const cleanups: Array<() => void> = [];
    const later = (run: () => void, ms: number) => timers.push(window.setTimeout(run, ms));
    const started = Date.now();

    // Una sola seconda misura: la pagina, tornando in vista, può essere riportata in cima dal router dopo il primo
    // scorrimento. Se nel frattempo si è scorso a mano non si tocca niente.
    const recheck = (el: HTMLElement) => {
      let byHand = false;
      const touched = () => {
        byHand = true;
      };
      const kinds = ["wheel", "touchmove", "keydown"] as const;
      for (const type of kinds) window.addEventListener(type, touched, { passive: true });
      const stop = () => {
        for (const type of kinds) window.removeEventListener(type, touched);
      };
      cleanups.push(stop);
      later(() => {
        stop();
        if (byHand) return;
        const current = el.isConnected ? el : findEntryElement(reveal.elementId);
        if (current && !fitsInView(current)) bringIntoView(current);
      }, REVEAL_RECHECK_MS);
    };

    const attempt = () => {
      if (cancelled) return;
      const el = findEntryElement(reveal.elementId);
      if (!el) {
        if (Date.now() - started < REVEAL_WAIT_MS) later(attempt, REVEAL_POLL_MS);
        else if (reveal.fromLink) setGone({ log: null, written: 0, forMs: 0 });
        return;
      }
      openEnclosing(el);
      // una riga appena aperta cambia l'altezza della pagina: si misura al fotogramma dopo
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          bringIntoView(el);
          highlight(el);
          recheck(el);
        }),
      );
    };

    closeSheetThen(() => later(attempt, 0));
    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
      for (const stop of cleanups) stop();
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
                onClick={() => stepDay(1)}
              >
                ‹
              </button>
              <Label className={styles.dayLabel}>{formatDayLabel(new Date(`${viewDate}T12:00:00Z`))}</Label>
              <button type="button" className={styles.dayArrow} aria-label="Giorno dopo" disabled={!isPast} onClick={() => stepDay(-1)}>
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
            <Now
              now={now}
              today={today}
              diary={diary.data}
              pantry={pantry.data}
              onShowWater={firstTime ? undefined : showWater}
              onDrinkAdded={firstTime ? undefined : showDrink}
              withCooking={!firstTime}
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
