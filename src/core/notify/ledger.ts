// Registro locale degli avvisi già mostrati: serve a non ripetere lo stesso fatto.

import { addDays } from "../diary";
import type { NoticeMessage, ShownLedger } from "./types";

/** Per quanti giorni si ricorda ciò che è stato mostrato. */
export const LEDGER_KEEP_DAYS = 14;
/** Notifiche al giorno: un riepilogo, più al massimo un secondo avviso se nasce qualcosa di nuovo. */
export const MAX_MESSAGES_PER_DAY = 2;
/** Distanza minima tra due notifiche, in minuti. */
export const MIN_GAP_MINUTES = 240;

export const emptyLedger = (): ShownLedger => ({ shown: [], messages: [] });

export function normalizeLedger(raw: unknown): ShownLedger {
  if (typeof raw !== "object" || raw === null) return emptyLedger();
  const r = raw as Record<string, unknown>;
  const shown = Array.isArray(r.shown)
    ? r.shown.flatMap((s) =>
        typeof s === "object" && s !== null && typeof (s as { key?: unknown }).key === "string" && typeof (s as { day?: unknown }).day === "string"
          ? [{ key: (s as { key: string }).key, day: (s as { day: string }).day }]
          : [],
      )
    : [];
  const messages = Array.isArray(r.messages)
    ? r.messages.flatMap((m) =>
        typeof m === "object" && m !== null && typeof (m as { day?: unknown }).day === "string" && typeof (m as { at?: unknown }).at === "string"
          ? [{ day: (m as { day: string }).day, at: (m as { at: string }).at }]
          : [],
      )
    : [];
  return { shown, messages };
}

export function wasShown(ledger: ShownLedger, key: string): boolean {
  return ledger.shown.some((s) => s.key === key);
}

/** Registra una notifica mostrata: i suoi fatti non si ripetono e il giorno ne conta una in più. */
export function recordShown(ledger: ShownLedger, message: Pick<NoticeMessage, "keys">, day: string, at: string): ShownLedger {
  const oldest = addDays(day, -LEDGER_KEEP_DAYS);
  const known = new Set(ledger.shown.map((s) => s.key));
  const added = message.keys.filter((k) => !known.has(k)).map((key) => ({ key, day }));
  return {
    shown: [...ledger.shown, ...added].filter((s) => s.day >= oldest),
    messages: [...ledger.messages, { day, at }].filter((m) => m.day >= oldest),
  };
}
