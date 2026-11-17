// Programma di preparazione: dal piano di una settimana, quali preparazioni fare e entro quando.

import { addDays } from "../diary";
import {
  batchPrepUses,
  coverPrepUses,
  getWeek,
  type ExistingPortions,
  type PlanState,
  type PrepBatch,
  type PrepCoverage,
} from "../plan";

export interface PrepTask extends PrepBatch {
  /**
   * Ultimo giorno in cui le porzioni sono ancora buone se si cucina entro `cookBy`, cioè
   * `cookBy` più la durata. Assente se la durata non è nota.
   */
  goodUntil?: string;
}

export interface PrepSchedule {
  weekStart: string;
  /** In ordine di `cookBy`, poi `prepId`. */
  tasks: PrepTask[];
  /** Per ogni preparazione del piano: porzioni coperte da quelle già pronte e da cucinare. */
  coverage: PrepCoverage[];
}

export interface ScheduleOptions {
  /**
   * Durata delle porzioni di una preparazione, in giorni dalla cottura (vedi `portionLifeDays`).
   * Se non la conosce, tutti gli usi della settimana finiscono in un solo lotto (`lifeKnown: false`).
   */
  portionLifeDays?: (prepId: string) => number | undefined;
  /** Porzioni già pronte (vedi `existingPortionsOf`): si usano prima, i compiti coprono solo il resto. */
  existingPortions?: readonly ExistingPortions[];
}

/**
 * Quali preparazioni cucinare per coprire le voci `prep` del piano, e entro quando: si cucina
 * entro il primo giorno in cui servono le porzioni, e se la durata non basta fino all'ultimo uso
 * si fa un secondo lotto, entro il primo giorno non coperto. Le porzioni di ogni lotto sono la
 * somma degli usi che copre.
 */
export function buildPrepSchedule(
  state: PlanState,
  weekStart: string,
  options: ScheduleOptions = {},
): PrepSchedule {
  const week = getWeek(state, weekStart);
  const batches = batchPrepUses(week, options.portionLifeDays, options.existingPortions);
  return {
    weekStart,
    coverage: coverPrepUses(week, options.existingPortions),
    tasks: batches.map((b) => ({
      ...b,
      ...(b.lifeDays !== undefined ? { goodUntil: addDays(b.cookBy, b.lifeDays) } : {}),
    })),
  };
}
