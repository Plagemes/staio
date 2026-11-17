// Verifica del piano rispetto agli obiettivi. Confronta assunzioni pianificate con obiettivi scelti
// dall'utente; non dà pareri. Il dato mancante è sempre dichiarato: la somma di ciò che si conosce
// è un minimo, mai un totale.

import type { Certainty } from "../ledger";
import { sumNutrients, type NutrientAmounts, type NutrientKey, type SumPart } from "../nutrition";
import { dayTypeOf, getWeek, targetsOf, type PlanState } from "./derive";
import { weekDates } from "./calendar";
import type { PlannedEntry, TargetRange } from "./types";

/** Nutrienti di una voce pianificata per l'intera quantità (o le porzioni) indicata nella voce. */
export type EntryNutrients =
  | {
      ok: true;
      nutrients: NutrientAmounts;
      certainty?: Certainty;
      /** Peso della voce in grammi, se noto: serve a pesare la quota di dato mancante. */
      weight?: number;
    }
  /** "Non calcolabile": alimento sconosciuto, conversione impossibile, ricetta senza dati. */
  | { ok: false; reason?: string; weight?: number };

export type NutrientsOfEntry = (entry: PlannedEntry) => EntryNutrients;

export type TargetStatus =
  /** Dentro l'obiettivo (con dato completo, o con dato parziale quando basta il minimo già raggiunto). */
  | "met"
  | "below"
  | "above"
  /** Il dato mancante impedisce di dire se l'obiettivo è rispettato. */
  | "undetermined"
  /** Nessuna voce porta il dato di questo nutriente. */
  | "not_computable";

export interface NutrientCheck {
  nutrient: NutrientKey;
  target: TargetRange;
  status: TargetStatus;
  /** Somma dei soli dati noti: un minimo se `partial`. Assente se `not_computable`. */
  value?: number;
  /** Quota del totale per cui manca il dato, da 0 a 1; 1 se non calcolabile. */
  missingShare: number;
  shareBy?: "weight" | "count";
  partial: boolean;
  certainty?: Certainty;
}

export type DayCheckStatus =
  | "checked"
  /** Nessuna voce pianificata quel giorno. */
  | "no_plan"
  /** Nessun tipo di giornata, o nessun obiettivo per il tipo di giornata. */
  | "no_targets";

export interface DayCheck {
  date: string;
  dayType?: string;
  status: DayCheckStatus;
  /** Voci pianificate del giorno. */
  entries: number;
  /** Voci che `nutrientsOf` non ha saputo calcolare. */
  notComputableEntries: number;
  nutrients: NutrientCheck[];
}

export interface WeekCheck {
  weekStart: string;
  /** I sette giorni, da lunedì a domenica. */
  days: DayCheck[];
  /** Conteggio degli esiti sui nutrienti dei giorni verificati. */
  summary: Record<TargetStatus, number>;
}

const EPS = 1e-9;

function judge(target: TargetRange, value: number, partial: boolean): TargetStatus {
  const { min, max } = target;
  const belowMin = min !== undefined && value < min - EPS;
  const aboveMax = max !== undefined && value > max + EPS;
  if (!partial) return belowMin ? "below" : aboveMax ? "above" : "met";
  // Dato parziale: il valore è un minimo, il vero totale può solo essere più alto.
  if (aboveMax) return "above";
  if (min !== undefined && max === undefined && !belowMin) return "met";
  return "undetermined";
}

export function checkPlanWeek(
  state: PlanState,
  weekStart: string,
  nutrientsOf: NutrientsOfEntry,
): WeekCheck {
  const week = getWeek(state, weekStart);
  const summary: Record<TargetStatus, number> = {
    met: 0,
    below: 0,
    above: 0,
    undetermined: 0,
    not_computable: 0,
  };
  const days: DayCheck[] = weekDates(weekStart).map((date) => {
    const entries = (week?.entries ?? []).filter((e) => e.date === date);
    const dayType = dayTypeOf(state, date);
    const base = { date, ...(dayType !== undefined ? { dayType } : {}), entries: entries.length };
    if (entries.length === 0) {
      return { ...base, status: "no_plan" as const, notComputableEntries: 0, nutrients: [] };
    }
    const targets = dayType !== undefined ? targetsOf(state, dayType) : undefined;
    if (!targets) {
      return { ...base, status: "no_targets" as const, notComputableEntries: 0, nutrients: [] };
    }

    let notComputable = 0;
    const parts: SumPart[] = entries.map((entry) => {
      const r = nutrientsOf(entry);
      if (!r.ok) {
        notComputable++;
        return { nutrients: {}, ...(r.weight !== undefined ? { weight: r.weight } : {}) };
      }
      return {
        nutrients: r.nutrients,
        ...(r.certainty !== undefined ? { certainty: r.certainty } : {}),
        ...(r.weight !== undefined ? { weight: r.weight } : {}),
      };
    });
    const sum = sumNutrients(parts);

    const nutrients: NutrientCheck[] = (Object.keys(targets.targets) as NutrientKey[])
      .sort()
      .map((nutrient) => {
        const target = targets.targets[nutrient] as TargetRange;
        const total = sum.totals[nutrient];
        if (!total) {
          return { nutrient, target, status: "not_computable" as const, missingShare: 1, partial: true };
        }
        return {
          nutrient,
          target,
          status: judge(target, total.value, total.partial),
          value: total.value,
          missingShare: total.missingShare,
          shareBy: total.shareBy,
          partial: total.partial,
          certainty: total.certainty,
        };
      });
    for (const n of nutrients) summary[n.status]++;
    return {
      ...base,
      status: "checked" as const,
      notComputableEntries: notComputable,
      nutrients,
    };
  });
  return { weekStart, days, summary };
}
