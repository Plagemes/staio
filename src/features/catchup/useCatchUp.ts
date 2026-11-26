"use client";

import { useMemo } from "react";
import { DISMISSED_SETTING_KEY, isDismissedList, rememberDismissed } from "@/core/briefing";
import { catchUpDays, catchUpKey } from "@/core/diary";
import { useDiary } from "@/data";
import { dayOf } from "../format";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { useNow } from "../useNow";

const NO_DISMISSED: string[] = [];
const NO_DAYS: readonly string[] = [];

/**
 * «Mettiamoci in pari»: i giorni passati senza niente nel diario (almeno due negli ultimi sette, dopo il primo giorno
 * del diario), dal più vecchio. Vuoto se non c'è niente da proporre o se l'utente ha lasciato così questi giorni.
 */
export function useCatchUp(): readonly string[] {
  const diary = useDiary().data;
  const now = useNow();
  const dismissed = useSetting<string[]>(DISMISSED_SETTING_KEY, isDismissedList, NO_DISMISSED);

  return useMemo(() => {
    if (!diary || !now || !dismissed.ready) return NO_DAYS;
    const days = catchUpDays(diary, dayOf(now, diary.timeZone), dismissed.value);
    return days.length > 0 ? days : NO_DAYS;
  }, [diary, now, dismissed.ready, dismissed.value]);
}

/** «Lascia così»: questi giorni non si propongono più. Giorni vuoti nuovi fanno una chiave nuova. */
export async function dismissCatchUp(days: readonly string[]): Promise<void> {
  const current = await getSetting<unknown>(DISMISSED_SETTING_KEY);
  await setSetting(DISMISSED_SETTING_KEY, rememberDismissed(isDismissedList(current) ? current : [], catchUpKey(days)));
}
