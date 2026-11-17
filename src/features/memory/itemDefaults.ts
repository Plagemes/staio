// Memoria per nome: dell'ultima volta si ricordano categoria, luogo e quantità, e si propongono (mai applicate in silenzio).
// Logica pura: l'archivio sta in `useItemDefaults.ts`, così queste funzioni si provano senza.
import type { Location } from "@/core/ledger";
import { defaultLocation } from "../quickAdd";
import { isFoodCategory } from "../lots";

export const ITEM_DEFAULTS_KEY = "itemDefaults.v1";

/** Quanti nomi si ricordano al massimo: oltre, esce il meno recente. */
export const MAX_ITEM_DEFAULTS = 300;

export interface ItemDefault {
  /** Il nome com'è stato scritto l'ultima volta: serve per i suggerimenti. */
  name: string;
  category?: string;
  location?: Location;
  quantityText?: string;
  /** Istante ISO dell'ultimo uso. */
  at: string;
}

const LOCATIONS: readonly Location[] = ["frigo", "freezer", "dispensa"];

/** Il nome senza maiuscole, accenti e spazi doppi. */
export function itemKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Una voce valida o niente: i campi facoltativi con la forma sbagliata si scartano, una voce senza nome o istante no. */
function parseEntry(raw: unknown): ItemDefault | undefined {
  if (!isRecord(raw)) return undefined;
  const { name, at, category, location, quantityText } = raw;
  if (typeof name !== "string" || name.trim() === "" || typeof at !== "string" || at === "") return undefined;
  return {
    name: name.trim(),
    ...(typeof category === "string" && isFoodCategory(category) ? { category } : {}),
    ...(typeof location === "string" && (LOCATIONS as readonly string[]).includes(location) ? { location: location as Location } : {}),
    ...(typeof quantityText === "string" && quantityText.trim() !== "" ? { quantityText: quantityText.trim() } : {}),
    at,
  };
}

function entriesOf(memory: unknown): [string, ItemDefault][] {
  if (!isRecord(memory)) return [];
  const out: [string, ItemDefault][] = [];
  for (const [key, raw] of Object.entries(memory)) {
    const entry = parseEntry(raw);
    if (entry) out.push([key, entry]);
  }
  return out;
}

/** L'ultima scelta fatta per questo nome. Una memoria rovinata vale come vuota. */
export function readItemDefault(memory: unknown, name: string): ItemDefault | undefined {
  const key = itemKey(name);
  if (key === "" || !isRecord(memory) || !Object.hasOwn(memory, key)) return undefined;
  return parseEntry(memory[key]);
}

/** La memoria con questa scelta al posto della precedente per lo stesso nome; oltre `max` nomi esce il meno recente. */
export function withItemDefault(
  memory: unknown,
  value: Omit<ItemDefault, "at">,
  now: string,
  max: number = MAX_ITEM_DEFAULTS,
): Record<string, ItemDefault> {
  const key = itemKey(value.name);
  const others = entriesOf(memory).filter(([k]) => k !== key);
  const fresh = key === "" ? undefined : parseEntry({ ...value, at: now });
  const all: [string, ItemDefault][] = fresh ? [[key, fresh], ...others] : others;
  // l'ordinamento è stabile: a parità di istante la voce nuova resta davanti
  all.sort(([, a], [, b]) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return Object.fromEntries(all.slice(0, Math.max(0, max)));
}

/** I nomi già usati che contengono il testo scritto, i più recenti prima. */
export function suggestNames(memory: unknown, typed: string, limit: number): string[] {
  const query = itemKey(typed);
  if (query === "" || limit <= 0) return [];
  return entriesOf(memory)
    .filter(([, entry]) => itemKey(entry.name).includes(query))
    .sort(([, a], [, b]) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name.localeCompare(b.name, "it")))
    .slice(0, limit)
    .map(([, entry]) => entry.name);
}

export type LocationSource = "chosen" | "memory" | "category" | "default";

/** Il luogo proposto: quello scelto nel modulo, poi la memoria per il nome, poi la regola per categoria, poi il frigo. */
export function proposeLocation(args: { chosen: Location | null; remembered?: Location; category?: string }): {
  location: Location;
  from: LocationSource;
} {
  if (args.chosen) return { location: args.chosen, from: "chosen" };
  if (args.remembered) return { location: args.remembered, from: "memory" };
  if (isFoodCategory(args.category)) return { location: defaultLocation(args.category), from: "category" };
  return { location: "frigo", from: "default" };
}
