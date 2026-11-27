// Riepilogo del giorno: al massimo tre righe, per urgenza, calcolate dai dati. Nel giorno passato non c'è.

import { addDays, getDay, localMoment, mealMoments, momentOfMinutes, type MealKind } from "../diary";
import type { AnyEvent } from "../events";
import { expiryFacts } from "../notify/expiryFacts";
import { supplementFacts } from "../notify/otherFacts";
import type { NoticeFact } from "../notify/types";
import { MAX_REVIEW_ITEMS, buildReviewItems } from "./review";
import type { Briefing, BriefingInput, BriefingLine } from "./types";
import { MEAL_NAMES, upperFirst, voidedIds, zoneOf } from "./util";

export const MAX_LINES = 3;
/** Acqua: giorni guardati per l'abitudine e giorni con acqua segnata perché la si consideri abituale. */
export const WATER_WINDOW_DAYS = 7;
export const WATER_MIN_DAYS = 4;
/** Si dice solo se a quest'ora di solito si è bevuto almeno tanto, e oggi meno della metà. */
export const WATER_MIN_EXPECTED_ML = 500;

const EMPTY: Briefing = { lines: [], review: [], reviewCount: 0, reviewInLines: false };

function dedupe(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (k !== "" && !seen.has(k)) {
      seen.add(k);
      out.push(n.trim());
    }
  }
  return out;
}

type Phase = "expired" | "today" | "tomorrow";

const phaseOfFact = (key: string): Phase | undefined => {
  const phase = key.slice(key.lastIndexOf(":") + 1);
  return phase === "expired" || phase === "today" || phase === "tomorrow" ? phase : undefined;
};

const nameOfFact = (f: NoticeFact): string => f.text.split(":")[0];

function phasePart(label: string, facts: readonly NoticeFact[]): string {
  const names = dedupe(facts.map(nameOfFact));
  return names.length <= 2 ? `${label}: ${names.join(" e ")}` : `${label}: ${names.length} cose`;
}

/**
 * Scaduti, in scadenza oggi o domani, porzioni di preparazioni comprese: gli stessi fatti delle notifiche (data stampata,
 * stima dalla categoria, fase «scaduto»). È una voce di sicurezza: ha sempre la precedenza e non si può «lasciare così».
 */
function expiryLine(input: BriefingInput, today: string, timeZone: string): BriefingLine | undefined {
  const facts = expiryFacts({
    now: today,
    timeZone,
    pantry: input.pantry,
    ...(input.preps ? { preps: input.preps } : {}),
    daysAhead: 1,
    want: { expiry: true, prep: true },
  }).flatMap((f) => {
    const phase = phaseOfFact(f.key);
    return phase ? [{ f, phase }] : [];
  });
  if (facts.length === 0) return undefined;
  const of = (phase: Phase) => facts.filter((x) => x.phase === phase).map((x) => x.f);
  const expired = of("expired");
  const now = of("today");
  const next = of("tomorrow");
  const parts = [
    ...(expired.length ? [phasePart("Scaduti", expired)] : []),
    ...(now.length ? [phasePart("Oggi", now)] : []),
    ...(next.length ? [phasePart("Domani", next)] : []),
  ];
  const all = facts.map((x) => x.f);
  const lots = all.filter((f) => f.type === "expiry");
  const single = all.length === 1 && lots.length === 1 ? nameOfFact(lots[0]) : undefined;
  const href = expired.length
    ? lots.length > 0 ? "/app/dispensa" : "/app/preparazioni"
    : lots.length === 0
      ? "/app/preparazioni"
      : single
        ? `/app/ricette/idee?alimento=${encodeURIComponent(single)}`
        : "/app/ricette/idee";
  return {
    key: `expiry:${today}`,
    kind: "expiry",
    text: `${parts.join("; ")}.`,
    certainty: all.some((f) => f.certainty === "estimated") ? "estimated" : "label",
    href,
    order: expired.length ? 5 : now.length ? 10 : 15,
  };
}

const MOMENT_ORDER: readonly MealKind[] = ["breakfast", "lunch", "dinner"];

/** I momenti che non sono ancora passati: quello in corso e i successivi. */
function upcomingKinds(minutes: number): readonly MealKind[] {
  const current = momentOfMinutes(minutes);
  if (current !== "snack") return MOMENT_ORDER.slice(MOMENT_ORDER.indexOf(current));
  if (minutes < 5 * 60) return MOMENT_ORDER;
  if (minutes >= 15 * 60 + 30 && minutes < 18 * 60 + 30) return ["dinner"];
  return [];
}

function planLine(input: BriefingInput, today: string, minutes: number): BriefingLine | undefined {
  const planned = input.planned ?? [];
  if (planned.length === 0) return undefined;
  const moments = mealMoments(getDay(input.diary, today));
  for (const kind of upcomingKinds(minutes)) {
    const texts = planned.filter((p) => p.meal === kind).map((p) => p.text);
    if (texts.length === 0) continue;
    if (moments.find((m) => m.kind === kind)?.status !== "none") continue;
    const missing = dedupe(input.missingForPlan ?? []);
    const base = `${upperFirst(MEAL_NAMES[kind])}: ${texts.slice(0, 2).join(", ")}.`;
    const lack = missing.length === 0 ? "" : ` Per il piano di oggi manca: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " e altro" : ""}.`;
    return {
      key: `plan:${today}:${kind}`,
      kind: "plan",
      text: base + lack,
      certainty: "recorded",
      href: missing.length > 0 ? "/app/spesa" : `/app/pasto?momento=${kind}`,
      order: missing.length > 0 ? 20 : 40,
    };
  }
  return undefined;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function waterLine(input: BriefingInput, today: string, minutes: number, timeZone: string): BriefingLine | undefined {
  const voided = voidedIds(input.log);
  const from = addDays(today, -WATER_WINDOW_DAYS);
  const byDay = new Map<string, { sofar: number; total: number }>();
  let todayMl = 0;
  for (const e of input.log as readonly AnyEvent[]) {
    if (e.type !== "water" || voided.has(e.id)) continue;
    const ml = (e as { ml: number }).ml;
    const m = localMoment(e.at, timeZone);
    if (!m || m.date > today || m.date < from) continue;
    if (m.date === today) {
      todayMl += ml;
      continue;
    }
    const d = byDay.get(m.date) ?? { sofar: 0, total: 0 };
    d.total += ml;
    if (m.minutes <= minutes) d.sofar += ml;
    byDay.set(m.date, d);
  }
  if (byDay.size < WATER_MIN_DAYS) return undefined;
  const values: number[] = [];
  for (let back = 1; back <= WATER_WINDOW_DAYS; back++) values.push(byDay.get(addDays(today, -back))?.sofar ?? 0);
  const expected = median(values);
  if (expected < WATER_MIN_EXPECTED_ML || todayMl >= expected / 2) return undefined;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  return {
    key: `water:${today}`,
    kind: "water",
    text: `Acqua: finora ${round50(todayMl)} ml, di solito a quest'ora ${round50(expected)}.`,
    certainty: "estimated",
    href: "#acqua",
    order: 50,
  };
}

function supplementLine(input: BriefingInput, today: string, minutes: number, timeZone: string): BriefingLine | undefined {
  const facts = supplementFacts(input.diary, { date: today, minutes }, timeZone);
  if (facts.length === 0) return undefined;
  const names = facts.map((f) => f.short.replace(/, non ancora segnato$/, ""));
  return {
    key: `supplement:${today}`,
    kind: "supplement",
    text: names.length === 1 ? `${names[0]}: oggi non risulta ancora segnato.` : `Integratori non ancora segnati oggi: ${names.join(", ")}.`,
    certainty: "recorded",
    href: facts[0].url,
    order: 45,
  };
}

/** Ieri è stato registrato qualcosa ma un pasto principale non c'è: non si dice che non abbia mangiato. */
function yesterdayLine(input: BriefingInput, today: string): BriefingLine | undefined {
  const date = addDays(today, -1);
  const moments = mealMoments(getDay(input.diary, date));
  if (!moments.some((m) => m.status === "recorded")) return undefined;
  const holes = moments.filter((m) => m.status === "none");
  if (holes.length === 0) return undefined;
  const names = holes.map((m) => MEAL_NAMES[m.kind]);
  return {
    key: `yesterday:${date}`,
    kind: "yesterday",
    text: `Ieri nel registro ${names.length === 1 ? "manca" : "mancano"}: ${names.join(" e ")}.`,
    certainty: "recorded",
    href: `/app/pasto?momento=${holes[0].kind}&giorno=${date}`,
    order: 60,
  };
}

/** Il consiglio sul mangiato, già scritto dal motore dei consigli: qui si decide solo se mostrarlo. Si può «lasciare così». */
function dietLine(input: BriefingInput): BriefingLine | undefined {
  const advice = input.dietAdvice;
  if (!advice || (input.dismissed ?? []).includes(advice.key)) return undefined;
  return { key: advice.key, kind: "diet", text: advice.text, certainty: advice.certainty, href: advice.href, order: 65 };
}

function noticeLine(input: BriefingInput, today: string): BriefingLine | undefined {
  const notices = input.otherNotices ?? [];
  if (notices.length === 0) return undefined;
  if (notices.length === 1) {
    return { key: notices[0].key, kind: "notice", text: `${notices[0].short}.`, certainty: "recorded", href: notices[0].url, order: 70 };
  }
  return { key: `notices:${today}`, kind: "notice", text: `${notices.length} altri avvisi.`, certainty: "recorded", href: "/app/impostazioni/avvisi", order: 70 };
}

/** Il riepilogo e la coda da rivedere. Giorno passato o dati non validi: niente. */
export function buildBriefing(input: BriefingInput): Briefing {
  const timeZone = zoneOf(input.timeZone);
  const at = localMoment(input.now, timeZone);
  if (!at) return EMPTY;
  if (input.viewDate !== undefined && input.viewDate < at.date) return EMPTY;

  const candidates = [
    expiryLine(input, at.date, timeZone),
    planLine(input, at.date, at.minutes),
    waterLine(input, at.date, at.minutes, timeZone),
    supplementLine(input, at.date, at.minutes, timeZone),
    yesterdayLine(input, at.date),
    dietLine(input),
    noticeLine(input, at.date),
  ]
    .filter((l): l is BriefingLine => l !== undefined)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  const all = buildReviewItems(input);
  const lines = candidates.slice(0, MAX_LINES);
  let reviewInLines = false;
  if (all.length > 0 && lines.length < MAX_LINES) {
    lines.push({
      key: "review",
      kind: "review",
      text: all.length === 1 ? "1 cosa da rivedere" : `${all.length} cose da rivedere`,
      certainty: "recorded",
      href: "#da-rivedere",
      order: 80,
    });
    reviewInLines = true;
  }
  return { lines, review: all.slice(0, MAX_REVIEW_ITEMS), reviewCount: all.length, reviewInLines };
}
