import { PANTRY_EVENT_TYPES } from "../ledger";
import { DIARY_EVENT_TYPES } from "../diary";
import { PLAN_EVENT_TYPES } from "../plan";
import { PREP_EVENT_TYPES } from "../prep";
import { RECIPE_EVENT_TYPES } from "../recipes";
import { EXPERIMENT_EVENT_TYPES } from "../analysis";

/** Tipo condiviso da tutte le famiglie: annulla un evento di qualunque famiglia. */
export const SHARED_EVENT_TYPES = ["void"] as const;

export const EVENT_FAMILY_NAMES = [
  "pantry",
  "diary",
  "plan",
  "prep",
  "recipes",
  "experiments",
] as const;
export type EventFamily = (typeof EVENT_FAMILY_NAMES)[number];

export interface EventFamilyInfo {
  family: EventFamily;
  /** Tipi propri della famiglia, `void` escluso. */
  types: readonly string[];
}

/** Le famiglie di eventi del registro con i rispettivi tipi, utile per filtrare. */
export const EVENT_FAMILIES: readonly EventFamilyInfo[] = [
  {
    family: "pantry",
    types: (PANTRY_EVENT_TYPES as readonly string[]).filter((t) => t !== "void"),
  },
  { family: "diary", types: DIARY_EVENT_TYPES },
  { family: "plan", types: PLAN_EVENT_TYPES },
  { family: "prep", types: PREP_EVENT_TYPES },
  { family: "recipes", types: RECIPE_EVENT_TYPES },
  { family: "experiments", types: EXPERIMENT_EVENT_TYPES },
];

/** Tutti i tipi noti: quelli delle famiglie più `void`. */
export const ALL_EVENT_TYPES: readonly string[] = [
  ...EVENT_FAMILIES.flatMap((f) => f.types),
  ...SHARED_EVENT_TYPES,
];

/** Famiglia di un evento secondo il suo tipo. `undefined` per `void`, tipi sconosciuti e non eventi. */
export function familyOf(e: unknown): EventFamily | undefined {
  try {
    if (typeof e !== "object" || e === null || Array.isArray(e)) return undefined;
    const type = (e as { type?: unknown }).type;
    if (typeof type !== "string") return undefined;
    return EVENT_FAMILIES.find((f) => f.types.includes(type))?.family;
  } catch {
    return undefined;
  }
}

/** Gli eventi della famiglia indicata, nell'ordine di ingresso; `void` e altre famiglie esclusi. */
export function eventsOfFamily<T>(events: Iterable<T>, family: EventFamily): T[] {
  const out: T[] = [];
  for (const e of events) if (familyOf(e) === family) out.push(e);
  return out;
}
