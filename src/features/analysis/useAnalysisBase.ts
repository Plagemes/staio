"use client";

import { useDiary } from "@/data";
import { dayOf } from "../format";
import { useIntake } from "../nutrition/useNutrition";
import { useNow } from "../useNow";

/** Diario, nutrienti per giorno e giorno di oggi: tutto ciò che servono le schermate delle analisi. */
export function useAnalysisBase() {
  const diary = useDiary();
  const data = useIntake();
  const now = useNow();
  const today = now && diary.data ? dayOf(now, diary.data.timeZone) : null;
  const error = Boolean(diary.error) || data.error;
  const ready = diary.data !== undefined && data.ready && today !== null;
  return { diary: diary.data, intakeDays: data.intake?.days, data, today, error, ready };
}
