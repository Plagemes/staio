// Date, orari, prezzi e frasi brevi in italiano. I giorni sono di calendario, nel fuso di Roma.
import { DEFAULT_TIME_ZONE, diffDays, parseDate, toCalendarDate, type Urgency } from "@/core/expiry";

const capitalize = (s: string) => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

/** "Lun 16 nov" */
export function formatDayLabel(now: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = typeof now === "string" ? new Date(now) : now;
  const text = new Intl.DateTimeFormat("it-IT", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(/[.,]/g, "");
  return capitalize(text);
}

/** "08:10" nel fuso di Roma. */
export function formatTime(instant: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

/** "18 nov 2026" da una data di calendario `YYYY-MM-DD`. */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(new Date(parseDate(date)))
    .replace(/\./g, "");
}

/** "3,50 €" da centesimi interi. */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" })
    .format(cents / 100)
    .replace(/ /g, " ");
}

export type PriceResult = { ok: true; cents: number } | { ok: false };

/** Legge un prezzo in euro ("3,50", "3.5", "€ 4"). Il testo vuoto non è un prezzo: lo decide chi chiama. */
export function parsePriceCents(text: string): PriceResult {
  const cleaned = text.replace(/€|eur(o)?/gi, "").replace(/\s+/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(cleaned)) return { ok: false };
  const cents = Math.round(Number(cleaned.replace(",", ".")) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return { ok: false };
  return { ok: true, cents };
}

/** "oggi", "ieri", "3 giorni fa", "domani", "tra 3 giorni" per una data di calendario. */
export function relativeDay(date: string, today: string): string {
  const d = diffDays(date, today);
  if (d === 0) return "oggi";
  if (d === 1) return "domani";
  if (d === -1) return "ieri";
  return d > 0 ? `tra ${d} giorni` : `${-d} giorni fa`;
}

/** Testo breve per il segno di scadenza, per esempio "domani" o "3 giorni". */
export function expiryTagText(urgency: Urgency): string {
  const days = urgency.daysLeft;
  switch (urgency.level) {
    case "expired":
      return days === -1 ? "scaduto ieri" : `scaduto da ${-days} giorni`;
    case "past_quality":
      return days === -1 ? "data passata ieri" : `data passata da ${-days} giorni`;
    case "today":
      return "oggi";
    case "tomorrow":
      return "domani";
    default:
      return daysPhrase(days);
  }
}

function daysPhrase(days: number): string {
  if (days < 60) return `${days} giorni`;
  if (days < 540) return `${Math.round(days / 30)} mesi`;
  return `${Math.round(days / 365)} anni`;
}

/** Giorno di calendario di un istante, nel fuso di Roma. */
export function dayOf(instant: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return toCalendarDate(instant, timeZone);
}
