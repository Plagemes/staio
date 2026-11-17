// Memoria delle porzioni: per ogni nome di alimento, l'ultima quantità mangiata. Serve a proporre «Il solito» nel
// selettore di quantità: propone, non salva niente da sola. Logica pura: l'impostazione la legge e la scrive chi chiama.
import { UNITS, type Quantity, type Unit } from "@/core/ledger";

export const PORTIONS_KEY = "portions.v1";

/** Oltre questo numero di nomi esce il meno recente. */
export const PORTIONS_MAX = 300;

export interface Portion {
  value: number;
  unit: Unit;
  /** Istante ISO UTC dell'ultima volta. */
  at: string;
  /** La quantità era una stima (mezzo pezzo): riproposta, resta una stima. */
  estimated?: true;
}

/** Una porzione ricordata o da ricordare: la quantità e, se lo era, il fatto che fosse una stima. */
export type RememberedPortion = Quantity & { estimated?: boolean };

export type PortionMemory = Record<string, Portion>;

/** Il nome come chiave: minuscole, senza accenti, spazi singoli. */
export function portionKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const isUnit = (value: unknown): value is Unit => typeof value === "string" && (UNITS as readonly string[]).includes(value);

function isPortion(value: unknown): value is Portion {
  if (typeof value !== "object" || value === null) return false;
  const { value: amount, unit, at, estimated } = value as Record<string, unknown>;
  if (estimated !== undefined && typeof estimated !== "boolean") return false;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 && isUnit(unit) && typeof at === "string" && at !== "";
}

/** Solo le voci con la forma giusta: ciò che è stato scritto male (o da una versione diversa) si ignora. */
function validEntries(memory: unknown): [string, Portion][] {
  if (typeof memory !== "object" || memory === null || Array.isArray(memory)) return [];
  return Object.entries(memory as Record<string, unknown>).filter((entry): entry is [string, Portion] => isPortion(entry[1]));
}

/** La porzione ricordata per quel nome, se è nella stessa unità dell'alimento. */
export function readPortion(memory: unknown, name: string, unit: Unit): RememberedPortion | undefined {
  const key = portionKey(name);
  if (key === "") return undefined;
  const found = validEntries(memory).find(([k]) => k === key)?.[1];
  if (!found || found.unit !== unit) return undefined;
  return { value: found.value, unit: found.unit, ...(found.estimated ? { estimated: true } : {}) };
}

/** La memoria con in più (o al posto di quella di prima) la porzione di quel nome. Oltre `max` nomi esce il meno recente. */
export function withPortion(memory: unknown, name: string, quantity: RememberedPortion, now: string, max: number = PORTIONS_MAX): PortionMemory {
  const next: PortionMemory = Object.fromEntries(validEntries(memory));
  const key = portionKey(name);
  const portion: Portion = { value: quantity.value, unit: quantity.unit, at: now, ...(quantity.estimated ? { estimated: true as const } : {}) };
  if (key === "" || !isPortion(portion)) return next;
  next[key] = portion;

  const limit = Math.max(1, Math.floor(max));
  const others = Object.keys(next)
    .filter((k) => k !== key)
    .sort((a, b) => (next[a].at < next[b].at ? -1 : next[a].at > next[b].at ? 1 : a < b ? -1 : 1));
  for (const oldest of others.slice(0, Math.max(0, others.length + 1 - limit))) delete next[oldest];
  return next;
}
