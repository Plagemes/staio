// Raggruppamento dei bisogni di una preparazione in lotti di cottura, secondo quanto durano
// le porzioni. Serve ai fabbisogni (data degli ingredienti) e al programma di preparazione.
// Le porzioni già cotte e disponibili si usano prima: si cucina solo per quelle mancanti.

import { MEAL_KINDS, type MealKind, addDays } from "../diary";
import type { PlanWeekState } from "./derive";

export interface PrepUse {
  date: string;
  meal: MealKind;
  servings: number;
}

export interface PrepBatch {
  prepId: string;
  /** Da preparare entro questa data: il primo giorno in cui serve. */
  cookBy: string;
  /** Porzioni da produrre: la somma degli usi non coperti da porzioni già pronte. */
  servings: number;
  uses: PrepUse[];
  /** Ultimo giorno in cui il lotto serve. */
  lastUse: string;
  /** Durata delle porzioni in giorni dalla preparazione, se nota. */
  lifeDays?: number;
  /** Falso se la durata non è nota: un solo lotto copre tutti gli usi, senza verifica. */
  lifeKnown: boolean;
}

/** Porzioni già pronte di una preparazione (un lotto di porzioni della dispensa). */
export interface ExistingPortions {
  prepId: string;
  /** Porzioni rimaste nel lotto. */
  remaining: number;
  /** Ultimo giorno in cui sono ancora buone (inclusa). Assente = nessun limite noto. */
  goodUntil?: string;
  lotId?: string;
}

/** Porzioni di un uso coperte da un lotto già pronto. */
export interface CoveredUse extends PrepUse {
  lotId?: string;
}

export interface PrepCoverage {
  prepId: string;
  /** Porzioni richieste dal piano per questa preparazione nella settimana. */
  needed: number;
  /** Porzioni coperte da quelle già pronte. */
  covered: number;
  /** Porzioni ancora da cucinare: `needed - covered`. */
  toCook: number;
  uses: CoveredUse[];
}

const MEAL_ORDER = new Map<string, number>(MEAL_KINDS.map((k, i) => [k, i]));

const validLife = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const EPS = 1e-9;
const round = (n: number): number => Math.round(n * 1e9) / 1e9;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function collectUses(week: PlanWeekState | undefined): Map<string, PrepUse[]> {
  const byPrep = new Map<string, PrepUse[]>();
  for (const entry of week?.entries ?? []) {
    if (entry.item.kind !== "prep") continue;
    const list = byPrep.get(entry.item.prepId) ?? [];
    list.push({ date: entry.date, meal: entry.meal, servings: entry.item.servings });
    byPrep.set(entry.item.prepId, list);
  }
  for (const list of byPrep.values()) {
    list.sort((a, b) => cmp(a.date, b.date) || (MEAL_ORDER.get(a.meal) ?? 99) - (MEAL_ORDER.get(b.meal) ?? 99));
  }
  return byPrep;
}

interface Allocation {
  /** Usi ancora da cucinare, per preparazione. */
  remaining: Map<string, PrepUse[]>;
  coverage: PrepCoverage[];
}

/**
 * Usa prima le porzioni già pronte, quelle che scadono prima per prime, e solo se sono ancora
 * buone nel giorno dell'uso. Il resto di ogni uso resta da cucinare.
 */
function allocate(
  uses: Map<string, PrepUse[]>,
  existing: readonly ExistingPortions[] | undefined,
): Allocation {
  const stocks = new Map<string, { remaining: number; goodUntil?: string; lotId?: string }[]>();
  for (const s of existing ?? []) {
    if (!(Number.isFinite(s.remaining) && s.remaining > EPS)) continue;
    const list = stocks.get(s.prepId) ?? [];
    list.push({
      remaining: s.remaining,
      ...(s.goodUntil !== undefined ? { goodUntil: s.goodUntil } : {}),
      ...(s.lotId !== undefined ? { lotId: s.lotId } : {}),
    });
    stocks.set(s.prepId, list);
  }
  for (const list of stocks.values()) {
    list.sort((a, b) => cmp(a.goodUntil ?? "9999-99-99", b.goodUntil ?? "9999-99-99") || cmp(a.lotId ?? "", b.lotId ?? ""));
  }

  const remaining = new Map<string, PrepUse[]>();
  const coverage: PrepCoverage[] = [];
  for (const prepId of [...uses.keys()].sort()) {
    const list = stocks.get(prepId) ?? [];
    const left: PrepUse[] = [];
    const coveredUses: CoveredUse[] = [];
    let needed = 0;
    let covered = 0;
    for (const use of uses.get(prepId)!) {
      needed += use.servings;
      let todo = use.servings;
      for (const stock of list) {
        if (todo <= EPS) break;
        if (stock.remaining <= EPS) continue;
        if (stock.goodUntil !== undefined && stock.goodUntil < use.date) continue;
        const take = Math.min(todo, stock.remaining);
        stock.remaining = round(stock.remaining - take);
        todo = round(todo - take);
        covered += take;
        coveredUses.push({
          date: use.date,
          meal: use.meal,
          servings: round(take),
          ...(stock.lotId !== undefined ? { lotId: stock.lotId } : {}),
        });
      }
      if (todo > EPS) left.push({ ...use, servings: todo });
    }
    remaining.set(prepId, left);
    coverage.push({
      prepId,
      needed: round(needed),
      covered: round(covered),
      toCook: round(needed - covered),
      uses: coveredUses,
    });
  }
  return { remaining, coverage };
}

/** Quante porzioni di ogni preparazione del piano sono coperte da quelle già pronte. */
export function coverPrepUses(
  week: PlanWeekState | undefined,
  existing?: readonly ExistingPortions[],
): PrepCoverage[] {
  return allocate(collectUses(week), existing).coverage;
}

/**
 * Raggruppa gli usi di ogni preparazione della settimana. Per ogni preparazione, in ordine di data:
 * il primo uso non coperto apre un lotto da fare entro quel giorno, e il lotto copre gli usi fino a
 * `durata` giorni dopo (la scadenza è inclusa). Cucinare il più tardi possibile (il giorno del primo
 * uso) è la scelta che copre più giorni. Durata ignota: un solo lotto.
 * Con `existing`, gli usi coperti da porzioni già pronte non entrano in nessun lotto.
 */
export function batchPrepUses(
  week: PlanWeekState | undefined,
  portionLifeDays?: (prepId: string) => number | undefined,
  existing?: readonly ExistingPortions[],
): PrepBatch[] {
  if (!week) return [];
  const { remaining } = allocate(collectUses(week), existing);
  const out: PrepBatch[] = [];
  for (const prepId of [...remaining.keys()].sort()) {
    const uses = remaining.get(prepId)!;
    if (uses.length === 0) continue;
    const life = portionLifeDays?.(prepId);
    const lifeKnown = validLife(life);
    let i = 0;
    while (i < uses.length) {
      const first = uses[i];
      const limit = lifeKnown ? addDays(first.date, Math.floor(life)) : undefined;
      const group: PrepUse[] = [];
      while (i < uses.length && (limit === undefined || uses[i].date <= limit)) {
        group.push(uses[i]);
        i++;
      }
      out.push({
        prepId,
        cookBy: first.date,
        servings: round(group.reduce((s, u) => s + u.servings, 0)),
        uses: group,
        lastUse: group[group.length - 1].date,
        ...(lifeKnown ? { lifeDays: Math.floor(life) } : {}),
        lifeKnown,
      });
    }
  }
  return out.sort((a, b) => cmp(a.cookBy, b.cookBy) || cmp(a.prepId, b.prepId));
}
