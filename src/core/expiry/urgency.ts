import { diffDays, toCalendarDate } from "./dates";
import type { EffectiveExpiry, ExpiryItem, Urgency } from "./types";
import { effectiveExpiry } from "./effectiveExpiry";

/** Urgenza di una data di scadenza; `nature` decide se il superamento è `expired` o `past_quality`. */
export function urgency(
  expiry: Pick<EffectiveExpiry, "date" | "nature">,
  now: string | Date,
  timeZone?: string,
): Urgency {
  const daysLeft = diffDays(expiry.date, toCalendarDate(now, timeZone));
  if (daysLeft < 0) {
    return { level: expiry.nature === "quality" ? "past_quality" : "expired", daysLeft };
  }
  if (daysLeft === 0) return { level: "today", daysLeft };
  if (daysLeft === 1) return { level: "tomorrow", daysLeft };
  if (daysLeft <= 3) return { level: "soon", daysLeft };
  return { level: "ok", daysLeft };
}

export interface ExpiryEntry {
  item: ExpiryItem;
  expiry: EffectiveExpiry;
  urgency: Urgency;
}

export function evaluate(item: ExpiryItem, now: string | Date, timeZone?: string): ExpiryEntry {
  const expiry = effectiveExpiry(item, now);
  return { item, expiry, urgency: urgency(expiry, now, timeZone) };
}

/** Voce scartata perché malformata (data non valida, categoria sconosciuta). */
export interface RejectedItem {
  item: ExpiryItem;
  reason: string;
}

function evaluateAll(
  items: readonly ExpiryItem[],
  now: string | Date,
  timeZone?: string,
): { entries: { entry: ExpiryEntry; index: number }[]; rejected: RejectedItem[] } {
  toCalendarDate(now, timeZone); // un `now` non valido è un errore del chiamante: lancia subito
  const entries: { entry: ExpiryEntry; index: number }[] = [];
  const rejected: RejectedItem[] = [];
  items.forEach((item, index) => {
    try {
      entries.push({ entry: evaluate(item, now, timeZone), index });
    } catch (e) {
      rejected.push({ item, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return { entries, rejected };
}

/**
 * Priorità numerica (più bassa = prima). Sicurezza: giorni rimanenti, anche negativi.
 * Qualità: max(giorni, 0) + 3, così non supera mai una voce di sicurezza in scadenza entro 3 giorni.
 */
function priority(entry: ExpiryEntry): number {
  const days = entry.urgency.daysLeft;
  return entry.expiry.nature === "safety" ? days : Math.max(days, 0) + 3;
}

/** Ordine "cosa mangiare prima": per priorità; a parità sicurezza, poi aperte, poi ordine di ingresso. */
export function eatFirstOrder(
  items: readonly ExpiryItem[],
  now: string | Date,
  timeZone?: string,
): { ordered: ExpiryEntry[]; rejected: RejectedItem[] } {
  const { entries, rejected } = evaluateAll(items, now, timeZone);
  const ordered = entries
    .sort((a, b) => {
      const pa = priority(a.entry);
      const pb = priority(b.entry);
      if (pa !== pb) return pa - pb;
      const sa = a.entry.expiry.nature === "safety" ? 0 : 1;
      const sb = b.entry.expiry.nature === "safety" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const oa = a.entry.item.openedDate ? 0 : 1;
      const ob = b.entry.item.openedDate ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return a.index - b.index;
    })
    .map((x) => x.entry);
  return { ordered, rejected };
}

export interface DailyDigest {
  expired: ExpiryEntry[];
  pastQuality: ExpiryEntry[];
  today: ExpiryEntry[];
  tomorrow: ExpiryEntry[];
  soon: ExpiryEntry[];
  /** Numero di voci da segnalare nell'unica notifica del giorno. */
  total: number;
  /** Voci malformate escluse dal riepilogo. */
  rejected: RejectedItem[];
}

export function dailyDigest(
  items: readonly ExpiryItem[],
  now: string | Date,
  timeZone?: string,
): DailyDigest {
  const { ordered, rejected } = eatFirstOrder(items, now, timeZone);
  const digest: DailyDigest = {
    expired: [],
    pastQuality: [],
    today: [],
    tomorrow: [],
    soon: [],
    total: 0,
    rejected,
  };
  for (const entry of ordered) {
    switch (entry.urgency.level) {
      case "expired":
        digest.expired.push(entry);
        break;
      case "past_quality":
        digest.pastQuality.push(entry);
        break;
      case "today":
        digest.today.push(entry);
        break;
      case "tomorrow":
        digest.tomorrow.push(entry);
        break;
      case "soon":
        digest.soon.push(entry);
        break;
      default:
        continue;
    }
    digest.total += 1;
  }
  return digest;
}
