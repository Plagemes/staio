"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { Advice, AdviceAction } from "@/core/diet";
import { Button, SectionHeader } from "@/design";
import { Disclosure } from "../common";
import { useNotice } from "../notice";
import { PlanSheet } from "../recipes/PlanSheet";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { AdviceCard } from "./AdviceCard";
import { HowComputed } from "./HowComputed";
import { IndicatorRow } from "./IndicatorRow";
import { dismissWithNotice, runAdviceAction } from "./actions";
import { WEEK_PARAM, lineHref } from "./links";
import { OUTCOMES_NOTE, weekHeaderText } from "./texts";
import { useDietAdvice } from "./useDiet";
import {
  BACK_LABEL,
  CHECK_LABEL,
  EMPTY_ACTION,
  EMPTY_TEXT,
  EMPTY_TITLE,
  INDICATORS_VISIBLE,
  NO_DAYS_TEXT,
  PAGE_TITLE,
  SAVE_FAILED,
  SECTION_ADVICE,
  SECTION_GAPS,
  SECTION_INDICATORS,
  SECTION_PAST,
  SHOW_ALL_LABEL,
  SHOW_FEWER_LABEL,
  WHAT_IT_MEANS,
  gapViews,
  historyIsEmpty,
  indicatorViews,
  insufficientNote,
  outcomeViews,
  parseWeekParam,
  periodLabel,
  pickWeek,
  sourcesUsed,
  weekNav,
} from "./weekView";
import styles from "./diet.module.css";

interface PlanRequest {
  recipeId: string;
  title: string;
  servings: number;
  /** Cambia a ogni apertura: il foglio riparte con le porzioni del consiglio. */
  run: number;
}

/**
 * Porta alla sezione dell'indirizzo (`#consigli`, `#come`) quando i dati ci sono; `#come` apre anche la sezione.
 * Next non rifà lo scorrimento verso un'ancora che ancora non esisteva al primo disegno.
 */
function useHashTarget(ready: boolean, week: string | undefined): void {
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.slice(1);
    if (id !== "consigli" && id !== "come") return;
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "come") el.querySelector("details")?.setAttribute("open", "");
    el.scrollIntoView({ block: "start" });
  }, [ready, week]);
}

export function DietWeek(): ReactElement {
  const view = useDietAdvice();
  const notice = useNotice();
  const params = useSearchParams();
  const [plan, setPlan] = useState<PlanRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // la settimana si deriva dall'indirizzo a ogni disegno: la pagina resta viva tra una visita e l'altra
  const requested = parseWeekParam(params.get(WEEK_PARAM));
  const history = view.history;
  const picked = useMemo(() => (history ? pickWeek(history.weeks, requested) : undefined), [history, requested]);
  const today = view.today;

  useHashTarget(view.ready && picked !== undefined, picked?.frame.weekStart);

  const indicators = useMemo(() => (history && picked ? indicatorViews(history.weeks, picked.index) : []), [history, picked]);

  if (view.error) return <StorageError />;
  if (!view.ready || !history || !picked || !today) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>{PAGE_TITLE}</h1>
        <LoadingLine />
      </div>
    );
  }

  const { frame } = picked;
  const isCurrent = picked.index === history.weeks.length - 1;
  const nav = weekNav(history.weeks, picked.index);
  // i consigli valgono per la settimana in corso: su una passata non compaiono
  const advice = isCurrent ? view.advice : [];
  const outcomes = outcomeViews(view.outcomes, history);
  const gaps = gapViews(frame.gaps);
  const note = insufficientNote(frame);
  const shown = showAll ? indicators : indicators.slice(0, INDICATORS_VISIBLE);

  async function onAction(action: AdviceAction) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await runAdviceAction(action, { notice });
      if ("sheet" in result) {
        setPlan((prev) => ({ recipeId: result.recipeId, title: result.title, servings: result.servings, run: (prev?.run ?? 0) + 1 }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDismiss(a: Advice) {
    if (busy) return;
    setBusy(true);
    try {
      await dismissWithNotice(a.key, notice);
    } catch {
      notice.show({ message: SAVE_FAILED });
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className={ui.head}>
      <h1 className={ui.title}>{PAGE_TITLE}</h1>
      <Link href="/app/salute" className={ui.textLink}>
        {BACK_LABEL}
      </Link>
    </div>
  );

  if (historyIsEmpty(history)) {
    return (
      <div className={ui.screen}>
        {head}
        <EmptyState title={EMPTY_TITLE} text={EMPTY_TEXT} actionLabel={EMPTY_ACTION} actionHref="/app/pasto" />
      </div>
    );
  }

  return (
    <div className={ui.screen}>
      {head}

      <section className={styles.week} aria-label="Settimana">
        <nav className={styles.weekNav} aria-label="Cambia settimana">
          {nav.prev ? (
            <Link href={nav.prev.href} className={styles.arrow} aria-label={nav.prev.label}>
              <span aria-hidden="true">‹ </span>Prima
            </Link>
          ) : (
            <span className={styles.arrowGhost} aria-hidden="true" />
          )}
          <p className={styles.period} aria-live="polite">
            {periodLabel(frame, today)}
          </p>
          {nav.next ? (
            <Link href={nav.next.href} className={styles.arrow} aria-label={nav.next.label}>
              Dopo<span aria-hidden="true"> ›</span>
            </Link>
          ) : (
            <span className={styles.arrowGhost} aria-hidden="true" />
          )}
        </nav>
        <p className={styles.header}>{weekHeaderText(frame)}</p>
        {frame.daysWithData === 0 ? <p className={styles.note}>{NO_DAYS_TEXT}</p> : null}
      </section>

      {advice.length > 0 ? (
        <section id="consigli" className={ui.section}>
          <SectionHeader label={SECTION_ADVICE} />
          <ul className={styles.cards}>
            {advice.map((a) => (
              <AdviceCard key={a.key} advice={a} today={today} history={history} busy={busy} onAction={(action) => void onAction(action)} onDismiss={(x) => void onDismiss(x)} />
            ))}
          </ul>
        </section>
      ) : null}

      {indicators.length > 0 ? (
        <section className={ui.section}>
          <SectionHeader label={SECTION_INDICATORS} />
          {note ? <p className={styles.note}>{note}</p> : null}
          <ul className={styles.rows}>
            {shown.map((v) => (
              <IndicatorRow key={v.id} view={v} sectionNote={note} />
            ))}
          </ul>
          {indicators.length > INDICATORS_VISIBLE ? (
            <div>
              <Button variant="text" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
                {showAll ? SHOW_FEWER_LABEL : SHOW_ALL_LABEL(indicators.length - INDICATORS_VISIBLE)}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {outcomes.length > 0 ? (
        <section className={ui.section}>
          <SectionHeader label={SECTION_PAST} />
          <ul className={styles.plain}>
            {outcomes.map((o) => (
              <li key={o.key} className={styles.outcome}>
                {o.text}
              </li>
            ))}
          </ul>
          <Disclosure title={WHAT_IT_MEANS} quiet>
            {OUTCOMES_NOTE}
          </Disclosure>
        </section>
      ) : null}

      {gaps.length > 0 ? (
        <section className={ui.section}>
          <SectionHeader label={SECTION_GAPS} />
          <ul className={styles.plain}>
            {gaps.map((g) => (
              <li key={g.key} className={styles.gap}>
                <span>{g.text}</span>
                <Link href={lineHref(g.lineKey, g.date, today)} className={ui.textLink} aria-label={g.label}>
                  {CHECK_LABEL}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="come" className={ui.section}>
        <HowComputed
          frame={frame}
          sources={sourcesUsed(
            frame,
            advice.map((a) => a.source),
          )}
        />
      </section>

      {plan ? <PlanSheet key={plan.run} recipeId={plan.recipeId} title={plan.title} servings={plan.servings} onClose={() => setPlan(null)} /> : null}
    </div>
  );
}
