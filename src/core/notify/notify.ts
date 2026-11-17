// Cosa avvisare adesso: fatti, preferenze, silenzio, deduplica e riepilogo unico.

import { DEFAULT_TIME_ZONE, addDays, isValidTimeZone, localMoment } from "../diary";
import { expiryFacts } from "./expiryFacts";
import { MAX_MESSAGES_PER_DAY, MIN_GAP_MINUTES, emptyLedger, wasShown } from "./ledger";
import { planFacts, shoppingFacts, supplementFacts, type Moment } from "./otherFacts";
import { isQuiet } from "./prefs";
import type { NoticeFact, NoticeMessage, NotifyInput, NotifyResult, SavedSummary } from "./types";

/** Righe del riepilogo mostrate prima di "e altri". */
const DIGEST_LINES = 4;
/** Ora locale (minuti) a cui si immagina il riepilogo del giorno dopo. */
const NEXT_DAY_MINUTES = 9 * 60;
/** Un riepilogo salvato non si mostra mai oltre queste ore, qualunque cosa dica il giorno. */
export const SUMMARY_MAX_AGE_HOURS = 36;

function zoneOf(input: NotifyInput): string {
  return input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIME_ZONE;
}

function momentOf(input: NotifyInput, timeZone: string): Moment {
  const m = localMoment(input.now, timeZone);
  if (!m) throw new Error(`Istante non valido: ${input.now}`);
  return m;
}

/** Tutti i fatti correnti dei tipi attivi, in ordine di urgenza. Non guarda cosa è già stato mostrato. */
export function collectFacts(input: NotifyInput, at: Moment, options: { skipSupplements?: boolean } = {}): NoticeFact[] {
  const timeZone = zoneOf(input);
  const types = input.prefs.types;
  const facts: NoticeFact[] = [];
  if (types.expiry || types.prep) {
    facts.push(
      ...expiryFacts({
        now: at.date, // le scadenze lavorano su date di calendario
        timeZone,
        pantry: input.pantry,
        ...(input.preps ? { preps: input.preps } : {}),
        daysAhead: input.prefs.expiryDaysAhead,
        want: { expiry: types.expiry, prep: types.prep },
      }),
    );
  }
  if (types.supplement && input.diary && !options.skipSupplements) facts.push(...supplementFacts(input.diary, at, timeZone));
  if (types.shopping) facts.push(...shoppingFacts(input.pantry, at.date, input.planNeeds));
  if (types.plan && input.plan) facts.push(...planFacts(input.plan, input.preps, at.date));
  return facts.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** Un fatto o un riepilogo: sempre una sola notifica. */
export function composeMessage(facts: readonly NoticeFact[], day: string): NoticeMessage | null {
  if (facts.length === 0) return null;
  const keys = facts.map((f) => f.key);
  const tag = `avvisi-${day}-${hash(keys.join("|"))}`;
  if (facts.length === 1) {
    const f = facts[0];
    return { tag, title: f.heading, body: f.text, url: f.url, keys, count: 1, digest: false };
  }
  const lines = facts.slice(0, DIGEST_LINES).map((f) => f.short);
  const more = facts.length - lines.length;
  if (more > 0) lines.push(`e altri ${more}`);
  const urls = new Set(facts.map((f) => f.url));
  return {
    tag,
    title: `Da guardare oggi: ${facts.length} cose`,
    body: lines.join("\n"),
    url: urls.size === 1 ? facts[0].url : "/app",
    keys,
    count: facts.length,
    digest: true,
  };
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function minutesBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 60_000;
}

/**
 * Cosa mostrare adesso. Non si ripete un fatto già mostrato, non si disturba nelle ore di
 * silenzio, si manda al massimo una notifica per volta (riepilogo se i fatti sono più d'uno)
 * e al massimo due al giorno.
 */
export function planNotifications(input: NotifyInput): NotifyResult {
  const timeZone = zoneOf(input);
  const at = momentOf(input, timeZone);
  const ledger = input.shown ?? emptyLedger();
  const facts = collectFacts(input, at);
  const due = facts.filter((f) => !wasShown(ledger, f.key));
  const base = { day: at.date, facts, due };
  if (!input.prefs.enabled) return { ...base, message: null, hold: "disabled" };
  if (due.length === 0) return { ...base, message: null, hold: "nothing" };
  if (isQuiet(at.minutes, input.prefs.quietHours)) return { ...base, message: null, hold: "quiet" };
  const today = ledger.messages.filter((m) => m.day === at.date);
  if (today.length >= MAX_MESSAGES_PER_DAY) return { ...base, message: null, hold: "daily_limit" };
  const last = today[today.length - 1];
  if (last && minutesBetween(last.at, input.now) < MIN_GAP_MINUTES) return { ...base, message: null, hold: "too_soon" };
  return { ...base, message: composeMessage(due, at.date) };
}

/** Anteprima per l'utente: cosa gli direi adesso, senza silenzio né registro dei già mostrati. */
export function previewNotices(input: NotifyInput): NoticeFact[] {
  return collectFacts(input, momentOf(input, zoneOf(input)));
}

/**
 * Riepilogo da lasciare al service worker per quando l'app è chiusa. Vale per un giorno:
 * oggi se c'è già qualcosa di dovuto che non si è potuto mostrare, altrimenti domani (solo
 * scadenze e preparazioni, che si prevedono; gli integratori dipendono da ciò che farai oggi).
 */
export function buildSavedSummary(input: NotifyInput): SavedSummary | null {
  if (!input.prefs.enabled) return null;
  const timeZone = zoneOf(input);
  const at = momentOf(input, timeZone);
  const ledger = input.shown ?? emptyLedger();
  const nowSavedAt = input.now;
  const expiresAt = new Date(Date.parse(input.now) + SUMMARY_MAX_AGE_HOURS * 3_600_000).toISOString();

  const today = collectFacts(input, at).filter((f) => !wasShown(ledger, f.key));
  const sentToday = ledger.messages.filter((m) => m.day === at.date).length;
  if (today.length > 0 && sentToday < MAX_MESSAGES_PER_DAY) {
    const message = composeMessage(today, at.date);
    if (message) return { forDay: at.date, timeZone, message, expiresAt, savedAt: nowSavedAt };
  }

  const tomorrow: Moment = { date: addDays(at.date, 1), minutes: NEXT_DAY_MINUTES };
  const next = collectFacts(input, tomorrow, { skipSupplements: true }).filter((f) => !wasShown(ledger, f.key));
  const message = composeMessage(next, tomorrow.date);
  return message ? { forDay: tomorrow.date, timeZone, message, expiresAt, savedAt: nowSavedAt } : null;
}

export function summaryIsValid(summary: SavedSummary, now: string, day: string): boolean {
  return summary.forDay === day && Date.parse(now) < Date.parse(summary.expiresAt);
}
