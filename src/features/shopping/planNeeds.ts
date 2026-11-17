// Fabbisogni del piano per la lista della spesa: le porzioni di preparazione già pronte si usano prima, e gli ingredienti
// si chiedono solo per le porzioni che mancano. Logica pura.
import { addDays } from "@/core/diary";
import type { MealKind } from "@/core/diary";
import { computeNeeds, getWeek, weekStartOf, type ExistingPortions, type ExpandRef, type PlanState, type PlanWeekState } from "@/core/plan";
import { existingPortionsOf, portionLifeDays, type PrepState } from "@/core/prep";
import type { PlanNeed } from "@/core/shopping";
import { dayOf } from "../format";

export interface CoveredPrep {
  prepId: string;
  title: string;
  /** Porzioni del piano già coperte da quelle pronte. */
  covered: number;
  /** Porzioni che il piano chiede in tutto. */
  needed: number;
  /** Porzioni ancora da cucinare: i loro ingredienti sono in lista. */
  toCook: number;
}

export interface PlanNeedsResult {
  needs: PlanNeed[];
  /** Ricette o preparazioni di cui non si sono potuti contare gli ingredienti. */
  unresolved: number;
  covered: CoveredPrep[];
}

/** Solo gli usi da oggi in poi: quelli passati hanno già consumato le loro porzioni, e oggi conta solo per i pasti non ancora registrati. */
function upcoming(week: PlanWeekState | undefined, today: string, isLogged: (date: string, meal: MealKind) => boolean): PlanWeekState | undefined {
  if (!week) return undefined;
  return { ...week, entries: week.entries.filter((e) => e.date >= today && !(e.date === today && isLogged(e.date, e.meal))) };
}

export function planNeedsFor(args: {
  today: string;
  plan: PlanState;
  expand: ExpandRef;
  preps: PrepState;
  /** Il pasto di quella data è già registrato nel diario (si sa solo per oggi). Default: no, oggi conta tutto. */
  isLogged?: (date: string, meal: MealKind) => boolean;
}): PlanNeedsResult {
  const { today, plan, expand, preps } = args;
  const isLogged = args.isLogged ?? (() => false);
  const byId = new Map(preps.preps.map((p) => [p.prepId, p]));
  // durata delle porzioni dal luogo in cui si tengono (frigo se la preparazione non esiste ancora)
  const lifeDays = (prepId: string): number | undefined => {
    const existing = byId.get(prepId);
    try {
      return portionLifeDays({ location: existing?.location ?? "frigo", cookedOn: existing ? dayOf(existing.cookedAt) : today });
    } catch {
      return undefined;
    }
  };
  const current = weekStartOf(today);
  const needs: PlanNeed[] = [];
  const covered = new Map<string, CoveredPrep>();
  let unresolved = 0;
  // le porzioni pronte coprono prima la settimana in corso; quelle avanzate (ancora buone alla data d'uso) passano alla successiva
  let existing: ExistingPortions[] = existingPortionsOf(preps);
  for (const start of [current, addDays(current, 7)]) {
    const r = computeNeeds(upcoming(getWeek(plan, start), today, isLogged), { expand, portionLifeDays: lifeDays, existingPortions: existing });
    const used = new Map(r.coveredPortions.map((c) => [c.prepId, c.covered]));
    existing = existing
      .map((e) => ({ ...e, remaining: Math.round((e.remaining - (used.get(e.prepId) ?? 0)) * 1e9) / 1e9 }))
      .filter((e) => e.remaining > 1e-9);
    unresolved += r.unresolved.filter((u) => u.date >= today).length;
    for (const l of r.lines) if (l.date >= today) needs.push({ product: l.product, quantity: l.quantity, date: l.date });
    for (const c of r.coveredPortions) {
      if (!(c.covered > 0)) continue;
      const prev = covered.get(c.prepId);
      covered.set(c.prepId, {
        prepId: c.prepId,
        title: byId.get(c.prepId)?.title ?? "Preparazione",
        covered: (prev?.covered ?? 0) + c.covered,
        needed: (prev?.needed ?? 0) + c.needed,
        toCook: (prev?.toCook ?? 0) + c.toCook,
      });
    }
  }
  return { needs, unresolved, covered: [...covered.values()] };
}

export function coveredText(c: CoveredPrep): string {
  const portions = (n: number) => `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n)} ${n === 1 ? "porzione" : "porzioni"}`;
  return c.toCook > 0
    ? `${c.title}: ${portions(c.covered)} già ${c.covered === 1 ? "pronta" : "pronte"}, ne cucini ${portions(c.toCook)}: gli ingredienti in lista sono solo per queste.`
    : `${c.title}: ${portions(c.covered)} già ${c.covered === 1 ? "pronta" : "pronte"}: bastano, nessun ingrediente in lista.`;
}
