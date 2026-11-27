"use client";

import { useCallback, useMemo } from "react";
import {
  DISMISSED_SETTING_KEY,
  NO_NUTRITION_WINDOW_DAYS,
  buildBriefing,
  isDismissedList,
  rememberDismissed,
  type Briefing,
} from "@/core/briefing";
import { briefingAdvice } from "@/core/diet";
import { addDays, DEFAULT_TIME_ZONE } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { PantryState } from "@/core/ledger";
import { useDiary, usePreps } from "@/data";
import { briefingAdviceText, dietHref, hrefOf, useDietAdvice } from "../diet";
import { useTodayNotices } from "../notifications";
import { unresolvedGroups } from "../nutrition/prepare";
import { useIntake } from "../nutrition/useNutrition";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { dayOf } from "../format";
import { reviewNotices } from "./summaries";
import type { TodayPlan } from "./useTodayPlan";

const NO_DISMISSED: string[] = [];

interface Args {
  now: string | null;
  /** Il giorno che si guarda: nel passato il riepilogo non c'è. */
  viewDate: string;
  pantry: PantryState | undefined;
  log: readonly AnyEvent[] | undefined;
  plan: TodayPlan;
}

export interface BriefingView {
  briefing: Briefing;
  /** «Lascia così»: la voce non torna più. */
  dismiss: (key: string) => Promise<void>;
}

const EMPTY: Briefing = { lines: [], review: [], reviewCount: 0, reviewInLines: false };

/**
 * Il riepilogo di Oggi e la coda «Da rivedere», dai dati del telefono. Avvisi, piano e valori nutrizionali arrivano
 * dagli stessi calcoli che le altre sezioni già usano; quello che l'utente ha lasciato così sta nelle impostazioni locali.
 */
export function useBriefing({ now, viewDate, pantry, log, plan }: Args): BriefingView {
  const diary = useDiary().data;
  const preps = usePreps().data;
  const notices = useTodayNotices();
  const intake = useIntake().intake;
  const dietAdvice = useDietAdvice();
  const dismissed = useSetting<string[]>(DISMISSED_SETTING_KEY, isDismissedList, NO_DISMISSED);

  const unresolvedFoods = useMemo(() => {
    if (!intake || !now) return [];
    const since = addDays(dayOf(now), -NO_NUTRITION_WINDOW_DAYS);
    return unresolvedGroups(intake.days.filter((d) => d.date >= since)).map((g) => ({ key: g.key, label: g.label, count: g.count, lastDate: g.lastDate }));
  }, [intake, now]);

  // il consiglio più alto con un'azione vera, al massimo uno; nei giorni passati il riepilogo non c'è (lo decide il core)
  const dietLine = useMemo(() => {
    if (!dietAdvice.ready) return undefined;
    const advice = briefingAdvice(dietAdvice.advice);
    if (!advice) return undefined;
    const action = advice.actions.find((a) => hrefOf(a) !== undefined && a.kind !== "openDetail");
    return {
      key: advice.key,
      text: briefingAdviceText(advice, { today: dietAdvice.today ?? viewDate, ...(dietAdvice.history ? { history: dietAdvice.history } : {}) }),
      href: (action ? hrefOf(action) : undefined) ?? dietHref({ anchor: "consigli" }),
      certainty: advice.certainty === "estimated" ? ("estimated" as const) : advice.certainty === "label" ? ("label" as const) : ("recorded" as const),
    };
  }, [dietAdvice.ready, dietAdvice.advice, dietAdvice.today, dietAdvice.history, viewDate]);

  const briefing = useMemo(() => {
    if (!now || !pantry || !log || !diary || !dismissed.ready) return EMPTY;
    try {
      return buildBriefing({
        now,
        timeZone: diary.timeZone ?? DEFAULT_TIME_ZONE,
        viewDate,
        pantry,
        diary,
        ...(preps ? { preps } : {}),
        log,
        planned: plan.planned,
        missingForPlan: plan.missingToday,
        otherNotices: reviewNotices(notices ?? []).map((f) => ({ key: f.key, short: f.short, url: f.url })),
        unresolvedFoods,
        ...(dietLine ? { dietAdvice: dietLine } : {}),
        dismissed: dismissed.value,
      });
    } catch {
      return EMPTY;
    }
  }, [now, viewDate, pantry, log, diary, preps, plan.planned, plan.missingToday, notices, unresolvedFoods, dietLine, dismissed.value, dismissed.ready]);

  const dismiss = useCallback(async (key: string) => {
    const current = await getSetting<unknown>(DISMISSED_SETTING_KEY);
    await setSetting(DISMISSED_SETTING_KEY, rememberDismissed(isDismissedList(current) ? current : [], key));
  }, []);

  return { briefing, dismiss };
}
