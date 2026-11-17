// Fatti di integratori, spesa e piano. Ognuno nasce solo se i dati lo giustificano:
// niente avvisi per ciò che non è stato registrato ("un giorno senza dati non è un digiuno").

import { addDays, localMoment, type DiaryState } from "../diary";
import type { PantryState } from "../ledger";
import { isoWeekday, weekStartOf, type PlanState } from "../plan";
import { buildPrepSchedule, existingPortionsOf, type PrepState } from "../prep";
import { recommendShoppingDay, type PlanNeed } from "../shopping";
import type { NoticeFact } from "./types";

export interface Moment {
  date: string;
  /** Minuti dalla mezzanotte locale. */
  minutes: number;
}

/** Quante delle ultime giornate devono avere l'integratore perché lo si consideri abituale. */
export const SUPPLEMENT_MIN_DAYS = 5;
export const SUPPLEMENT_WINDOW_DAYS = 7;
/** Si avvisa da un'ora dopo l'orario abituale, e non oltre sei ore dopo. */
export const SUPPLEMENT_GRACE_MINUTES = 60;
export const SUPPLEMENT_LAST_MINUTES = 360;

const norm = (name: string): string => name.trim().toLowerCase();

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Integratori presi quasi ogni giorno (almeno 5 degli ultimi 7), non ancora segnati oggi,
 * oltre l'ora in cui di solito li prendi. Non esiste un programma esplicito: l'abitudine
 * si ricava da ciò che hai segnato, e il testo dice solo che oggi non risulta.
 */
export function supplementFacts(diary: DiaryState, at: Moment, timeZone: string): NoticeFact[] {
  const from = addDays(at.date, -SUPPLEMENT_WINDOW_DAYS);
  const days = new Map<string, { name: string; dates: Set<string>; minutes: number[] }>();
  let takenToday = new Set<string>();
  for (const day of diary.days) {
    if (day.date === at.date) {
      takenToday = new Set(day.supplements.map((s) => norm(s.name)));
      continue;
    }
    if (day.date < from || day.date > at.date) continue;
    for (const s of day.supplements) {
      const key = norm(s.name);
      if (key === "") continue;
      const entry = days.get(key) ?? { name: s.name.trim(), dates: new Set<string>(), minutes: [] };
      const m = localMoment(s.at, timeZone);
      if (m) entry.minutes.push(m.minutes);
      entry.dates.add(day.date);
      days.set(key, entry);
    }
  }
  const out: NoticeFact[] = [];
  for (const [key, entry] of days) {
    if (entry.dates.size < SUPPLEMENT_MIN_DAYS || entry.minutes.length === 0) continue;
    if (takenToday.has(key)) continue;
    const usual = median(entry.minutes);
    if (at.minutes < usual + SUPPLEMENT_GRACE_MINUTES || at.minutes > usual + SUPPLEMENT_LAST_MINUTES) continue;
    out.push({
      key: `supplement:${key}:${at.date}`,
      type: "supplement",
      level: "info",
      certainty: "recorded",
      heading: "Integratore",
      text: `${entry.name}: oggi non risulta ancora segnato.`,
      short: `${entry.name}, non ancora segnato`,
      url: "/app/salute",
      order: 50,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Giorno di spesa consigliato dai consumi e dal piano: si avvisa solo quando è arrivato. */
export function shoppingFacts(pantry: PantryState, today: string, planNeeds: readonly PlanNeed[] | undefined): NoticeFact[] {
  let day;
  try {
    day = recommendShoppingDay({ today, pantry, ...(planNeeds ? { planNeeds } : {}) });
  } catch {
    return [];
  }
  if (day.date === null || day.date > today) return [];
  const useRunout = day.basis === "runout" || day.basis === "both";
  const trigger = useRunout ? day.firstRunout : day.firstPlanShortfall;
  if (!trigger) return [];
  const text = useRunout
    ? `Conviene fare la spesa: secondo i tuoi consumi ${trigger.name} sta finendo.`
    : `Conviene fare la spesa: per il piano serve ${trigger.name}.`;
  return [
    {
      key: `shopping:${trigger.key}:${trigger.date}`,
      type: "shopping",
      level: "info",
      certainty: useRunout ? "estimated" : "recorded",
      heading: "Spesa",
      text,
      short: useRunout ? `Spesa: ${trigger.name} sta finendo (stima)` : `Spesa: serve ${trigger.name}`,
      url: "/app/spesa",
      order: 60,
    },
  ];
}

/**
 * Promemoria di piano: una preparazione da cucinare oggi per coprire i pasti previsti, e il
 * piano della prossima settimana ancora vuoto (solo nel fine settimana e solo se hai già
 * usato il piano).
 */
export function planFacts(plan: PlanState, preps: PrepState | undefined, today: string): NoticeFact[] {
  const out: NoticeFact[] = [];
  const weekStart = weekStartOf(today);
  try {
    const schedule = buildPrepSchedule(plan, weekStart, preps ? { existingPortions: existingPortionsOf(preps) } : {});
    for (const task of schedule.tasks) {
      if (task.cookBy !== today || task.servings <= 0) continue;
      const title = preps?.preps.find((p) => p.prepId === task.prepId)?.title ?? "una preparazione del piano";
      out.push({
        key: `plan:cook:${task.prepId}:${today}`,
        type: "plan",
        level: "soon",
        certainty: "recorded",
        heading: "Da cucinare",
        text: `Oggi conviene cucinare ${title}: ${task.servings} ${task.servings === 1 ? "porzione" : "porzioni"} per il piano.`,
        short: `Da cucinare: ${title}`,
        url: "/app/preparazioni",
        order: 70,
      });
    }
  } catch {
    // un piano che non si legge non genera avvisi
  }

  const nextMonday = addDays(weekStart, 7);
  const used = plan.weeks.some((w) => w.entries.length > 0 && w.weekStart < nextMonday);
  const nextEmpty = !plan.weeks.some((w) => w.weekStart === nextMonday && w.entries.length > 0);
  if (used && nextEmpty && isoWeekday(today) >= 6) {
    out.push({
      key: `plan:week:${nextMonday}`,
      type: "plan",
      level: "info",
      certainty: "recorded",
      heading: "Piano",
      text: "Il piano della settimana che inizia lunedì è ancora vuoto.",
      short: "Piano della prossima settimana vuoto",
      url: "/app/piano/settimana",
      order: 75,
    });
  }
  return out;
}
