// Fatti di scadenza: alimenti in dispensa e porzioni delle preparazioni.
// Il calcolo delle date è del motore delle scadenze (`core/expiry`): qui si decide solo cosa
// meriti un avviso e come dirlo, senza far passare una stima per una data stampata.

import {
  SHELF_LIFE,
  effectiveExpiry,
  parseDate,
  toCalendarDate,
  urgency,
  type EffectiveExpiry,
  type ExpiryItem,
  type FoodCategory,
} from "../expiry";
import { activeLots, type Lot, type PantryState } from "../ledger";
import type { PrepRecord, PrepState } from "../prep";
import type { NoticeFact, NoticeLevel } from "./types";

/** Una voce scaduta da più di tanti giorni non genera più avvisi: la si vede in dispensa. */
export const EXPIRED_LOOKBACK_DAYS = 14;

type Phase = "expired" | "today" | "tomorrow" | "soon";

const when = (days: number): string => (days === 0 ? "oggi" : days === 1 ? "domani" : `tra ${days} giorni`);
const withinWhen = (days: number): string => (days === 0 ? "oggi" : days === 1 ? "domani" : `${days} giorni`);
const ago = (days: number): string => (days === 1 ? "ieri" : `da ${days} giorni`);
const portionsOf = (n: number): string => `${n} ${n === 1 ? "porzione" : "porzioni"}`;
const packsOf = (n: number): string => `${n} confezioni`;

function expiryItemOf(lot: Lot, timeZone: string): ExpiryItem | undefined {
  if (typeof lot.category !== "string" || !Object.hasOwn(SHELF_LIFE, lot.category)) return undefined;
  try {
    const day = (instant: string | undefined) => (instant ? toCalendarDate(instant, timeZone) : null);
    return {
      id: lot.lotId,
      labelDateType: lot.expiry ? lot.expiry.kind : "none",
      labelDate: lot.expiry?.date ?? null,
      purchaseDate: toCalendarDate(lot.createdAt, timeZone),
      openedDate: day(lot.openedAt),
      location: lot.location,
      frozenDate: day(lot.frozenAt),
      thawedDate: day(lot.thawedAt),
      category: lot.category as FoodCategory,
    };
  } catch {
    return undefined;
  }
}

/** Scadenza che conta per un lotto: stima del motore se la categoria è nota, altrimenti la sola data in etichetta. */
function lotExpiry(lot: Lot, now: string, timeZone: string): EffectiveExpiry | undefined {
  const item = expiryItemOf(lot, timeZone);
  if (item) {
    try {
      return effectiveExpiry(item, now);
    } catch {
      // si ripiega sulla data in etichetta
    }
  }
  if (!lot.expiry) return undefined;
  return {
    date: lot.expiry.date,
    basis: "label",
    nature: lot.expiry.kind === "best_before" ? "quality" : "safety",
    certainty: lot.expiry.kind === "estimated" ? "estimated" : "label",
  };
}

interface Subject {
  /** Identificativo stabile della voce (lotto o preparazione). */
  id: string;
  type: "expiry" | "prep";
  name: string;
  /** Per le preparazioni: porzioni rimaste. */
  portions: number;
  /** Confezioni uguali (stesso prodotto e stessa data) raccolte in questo fatto; 1 se è una sola. */
  count: number;
  expiry: EffectiveExpiry;
  url: string;
}

function phaseOf(daysLeft: number, daysAhead: number): Phase | undefined {
  if (daysLeft < 0) return daysLeft >= -EXPIRED_LOOKBACK_DAYS ? "expired" : undefined;
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return daysLeft <= daysAhead ? "soon" : undefined;
}

function levelOf(phase: Phase, nature: EffectiveExpiry["nature"]): NoticeLevel {
  const base: NoticeLevel = phase === "expired" || phase === "today" ? "urgent" : phase === "tomorrow" ? "soon" : "info";
  if (nature === "safety") return base;
  return base === "urgent" ? "soon" : "info";
}

function headingOf(phase: Phase, s: Subject): string {
  const e = s.expiry;
  if (s.type === "prep") return phase === "expired" ? "Porzioni scadute" : "Porzioni da mangiare";
  if (e.certainty === "estimated") return phase === "expired" ? "Scadenza stimata passata" : "Scadenza stimata";
  if (e.nature === "quality") return "Meglio mangiarlo presto";
  if (phase === "expired") return "Scaduto";
  return phase === "today" ? "Scade oggi" : phase === "tomorrow" ? "Scade domani" : "In scadenza";
}

function textOf(s: Subject, phase: Phase, daysLeft: number): string {
  const e = s.expiry;
  const estimated = e.certainty === "estimated";
  if (s.type === "prep") {
    const lead = `${s.name}: ${portionsOf(s.portions)}`;
    if (phase === "expired") {
      return estimated ? `${lead}, la scadenza stimata è passata ${ago(-daysLeft)}.` : `${lead}, scadute ${ago(-daysLeft)}.`;
    }
    if (estimated) return `${lead}, secondo la stima da mangiare entro ${withinWhen(daysLeft)}.`;
    if (e.nature === "quality") return `${lead}, da mangiare preferibilmente entro ${withinWhen(daysLeft)}.`;
    return `${lead}, da mangiare entro ${withinWhen(daysLeft)}.`;
  }
  const many = s.count > 1;
  if (phase === "expired") {
    if (many) {
      return estimated
        ? `${s.name}: ${packsOf(s.count)}, la scadenza stimata è passata ${ago(-daysLeft)}.`
        : `${s.name}: ${packsOf(s.count)} scadute ${ago(-daysLeft)}.`;
    }
    return estimated
      ? `${s.name}: la scadenza stimata è passata ${ago(-daysLeft)}.`
      : `${s.name}: scaduto ${ago(-daysLeft)}.`;
  }
  if (estimated) return many ? `${s.name}: ${packsOf(s.count)}, secondo la stima scadono ${when(daysLeft)}.` : `${s.name}: secondo la stima scade ${when(daysLeft)}.`;
  if (e.nature === "quality") {
    return many
      ? `${s.name}: ${packsOf(s.count)} da mangiare preferibilmente entro ${withinWhen(daysLeft)}.`
      : `${s.name}: da mangiare preferibilmente entro ${withinWhen(daysLeft)}.`;
  }
  return many ? `${s.name}: ${packsOf(s.count)} scadono ${when(daysLeft)}.` : `${s.name}: scade ${when(daysLeft)}.`;
}

function shortOf(s: Subject, phase: Phase, daysLeft: number): string {
  const estimated = s.expiry.certainty === "estimated" ? " (stima)" : "";
  const what = s.type === "prep" ? `${s.name}, ${portionsOf(s.portions)}` : s.count > 1 ? `${s.name} (${packsOf(s.count)})` : s.name;
  if (phase === "expired") return `${what}, ${s.type === "prep" || s.count > 1 ? "scadute" : "scaduto"} ${ago(-daysLeft)}${estimated}`;
  return `${what}, ${when(daysLeft)}${estimated}`;
}

function factOf(s: Subject, now: string, timeZone: string, daysAhead: number): NoticeFact | undefined {
  const u = urgency(s.expiry, now, timeZone);
  // Una data di qualità passata non è un'urgenza: non si avvisa (la si vede in dispensa).
  if (u.level === "past_quality") return undefined;
  const phase = phaseOf(u.daysLeft, daysAhead);
  if (!phase) return undefined;
  return {
    key: `${s.type}:${s.id}:${s.expiry.date}:${phase}`,
    type: s.type,
    level: levelOf(phase, s.expiry.nature),
    certainty: s.expiry.certainty,
    heading: headingOf(phase, s),
    text: textOf(s, phase, u.daysLeft),
    short: shortOf(s, phase, u.daysLeft),
    url: s.url,
    order: s.expiry.nature === "safety" ? u.daysLeft : Math.max(u.daysLeft, 0) + 3,
  };
}

export interface ExpiryFactsInput {
  now: string;
  timeZone: string;
  pantry: PantryState;
  preps?: PrepState;
  daysAhead: number;
  want: { expiry: boolean; prep: boolean };
}

function activePrepsOf(preps: PrepState | undefined): PrepRecord[] {
  return (preps?.preps ?? []).filter((p) => p.status === "active" && p.remaining > 0);
}

export function expiryFacts(input: ExpiryFactsInput): NoticeFact[] {
  const { now, timeZone, daysAhead } = input;
  const out: NoticeFact[] = [];
  const preps = activePrepsOf(input.preps);
  const prepLots = new Set(preps.map((p) => p.batchLotId));

  if (input.want.expiry) {
    // Più confezioni dello stesso prodotto con la stessa scadenza fanno un solo fatto, con il numero.
    // La chiave è quella della confezione con l'id minore: per una confezione sola non cambia, e un'altra
    // confezione con la stessa data non fa ripetere l'avviso. Una data diversa resta un fatto distinto.
    const groups = new Map<string, { lots: Lot[]; expiry: EffectiveExpiry }>();
    for (const lot of activeLots(input.pantry)) {
      if (prepLots.has(lot.lotId)) continue; // le porzioni hanno il loro avviso
      const expiry = lotExpiry(lot, now, timeZone);
      if (!expiry) continue; // nessuna data e nessuna categoria: niente da dire
      const key = [lot.productRef.trim().toLowerCase(), expiry.date, expiry.basis, expiry.nature, expiry.certainty].join("");
      const group = groups.get(key);
      if (group) group.lots.push(lot);
      else groups.set(key, { lots: [lot], expiry });
    }
    for (const { lots, expiry } of groups.values()) {
      const first = lots.reduce((a, b) => (b.lotId < a.lotId ? b : a));
      const fact = factOf(
        { id: first.lotId, type: "expiry", name: first.productRef, portions: 0, count: lots.length, expiry, url: "/app/dispensa" },
        now,
        timeZone,
        daysAhead,
      );
      if (fact) out.push(fact);
    }
  }

  if (input.want.prep) {
    for (const prep of preps) {
      if (!prep.expiry) continue;
      const e = prep.expiry;
      try {
        parseDate(e.date);
      } catch {
        continue;
      }
      const expiry: EffectiveExpiry = {
        date: e.date,
        basis: "label",
        nature: e.kind === "best_before" ? "quality" : "safety",
        certainty: e.kind === "estimated" ? "estimated" : "label",
      };
      const fact = factOf(
        { id: prep.prepId, type: "prep", name: prep.title, portions: prep.remaining, count: 1, expiry, url: "/app/preparazioni" },
        now,
        timeZone,
        daysAhead,
      );
      if (fact) out.push(fact);
    }
  }
  return out;
}
