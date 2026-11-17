// Zone di frigo, freezer e credenza, e mappa locale di dove sta di solito ogni alimento (imparata dalle conferme dell'utente).
// Solo struttura e funzioni pure: i dati si passano come parametro e chi chiama decide dove conservarli.

export const SCAN_LOCATIONS = ["frigo", "freezer", "dispensa"] as const;
export type ScanLocation = (typeof SCAN_LOCATIONS)[number];

export interface ZoneDef {
  key: string;
  /** "Cassetto della verdura" */
  label: string;
  /** Come si dice in «Mostra …»: "il cassetto della verdura". */
  show: string;
}

/** L'ordine è quello in cui si guarda: dall'alto in basso, poi lo sportello. */
export const ZONES: Record<ScanLocation, readonly ZoneDef[]> = {
  frigo: [
    { key: "ripiano_alto", label: "Ripiano alto", show: "il ripiano alto" },
    { key: "ripiano_centrale", label: "Ripiano centrale", show: "il ripiano centrale" },
    { key: "ripiano_basso", label: "Ripiano basso", show: "il ripiano basso" },
    { key: "cassetto_verdure", label: "Cassetto della verdura", show: "il cassetto della verdura" },
    { key: "sportello", label: "Sportello", show: "lo sportello" },
  ],
  freezer: [
    { key: "cassetto_alto", label: "Cassetto alto", show: "il cassetto alto" },
    { key: "cassetto_centrale", label: "Cassetto centrale", show: "il cassetto centrale" },
    { key: "cassetto_basso", label: "Cassetto basso", show: "il cassetto basso" },
    { key: "sportello", label: "Sportello", show: "lo sportello" },
  ],
  dispensa: [
    { key: "ripiano_alto", label: "Ripiano alto", show: "il ripiano alto" },
    { key: "ripiano_centrale", label: "Ripiano centrale", show: "il ripiano centrale" },
    { key: "ripiano_basso", label: "Ripiano basso", show: "il ripiano basso" },
    { key: "cassetto", label: "Cassetto", show: "il cassetto" },
    { key: "sportello", label: "Sportello", show: "lo sportello" },
  ],
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_\s]+/g, " ").trim();

export function zoneDef(location: ScanLocation, key: string): ZoneDef | undefined {
  return ZONES[location].find((z) => z.key === key);
}

export function zoneLabel(location: ScanLocation, key: string): string {
  return zoneDef(location, key)?.label ?? key;
}

/** Posizione di una zona nell'ordine di visita; le sconosciute vanno in fondo. */
export function zoneRank(location: ScanLocation, key: string | undefined): number {
  if (key === undefined) return ZONES[location].length;
  const i = ZONES[location].findIndex((z) => z.key === key);
  return i < 0 ? ZONES[location].length : i;
}

/** Riporta il testo scritto dal modello a una zona nota del luogo, o undefined. */
export function readZone(location: ScanLocation, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = fold(value);
  if (text === "") return undefined;
  const zones = ZONES[location];
  const exact = zones.find((z) => fold(z.key) === text || fold(z.label) === text);
  if (exact) return exact.key;
  const has = (key: string) => zones.some((z) => z.key === key);
  const pick = (key: string) => (has(key) ? key : undefined);
  if (/\b(sportello|anta|porta)\b/.test(text)) return pick("sportello");
  if (/\bverdur|\bfrutta\b|cassetto della/.test(text) && has("cassetto_verdure")) return "cassetto_verdure";
  const level = /\b(alto|alta|superiore|in alto)\b/.test(text)
    ? "alto"
    : /\b(basso|bassa|inferiore|fondo|in basso)\b/.test(text)
      ? "basso"
      : /\b(central[ei]|medio|media|mezzo)\b/.test(text)
        ? "centrale"
        : undefined;
  if (level === undefined) return text === "cassetto" ? pick("cassetto") : undefined;
  return pick(`ripiano_${level}`) ?? pick(`cassetto_${level}`);
}

// ---------------------------------------------------------------- mappa

export interface ZoneStat {
  /** Quante volte l'utente ha confermato un alimento in ogni zona. */
  counts: Record<string, number>;
  /** Ultima conferma, ISO UTC. */
  last: string;
}

/** Per luogo e alimento: la chiave è `luogo:alimento`. */
export type ZoneMap = Readonly<Record<string, ZoneStat>>;

export const EMPTY_ZONE_MAP: ZoneMap = {};

/** Si dimezzano i conteggi quando un alimento ne accumula troppi: le abitudini recenti pesano di più. */
const MAX_TOTAL = 30;

/** Chiave dell'alimento: la categoria se c'è (si impara più in fretta), altrimenti il nome senza accenti e al singolare approssimato. */
export function foodKey(name: string, category?: string): string {
  const c = category?.trim();
  if (c) return `cat:${c}`;
  return `name:${fold(name).replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 2).join(" ")}`;
}

const mapKey = (location: ScanLocation, food: string) => `${location}:${food}`;

export interface ZoneObservation {
  location: ScanLocation;
  food: string;
  zone: string;
  at: string;
}

/** Aggiunge una conferma. Non modifica la mappa passata. Le zone che non esistono per il luogo si ignorano. */
export function recordZone(map: ZoneMap, observation: ZoneObservation): ZoneMap {
  const { location, food, zone, at } = observation;
  if (!zoneDef(location, zone) || food === "") return map;
  const key = mapKey(location, food);
  const previous = map[key];
  const counts: Record<string, number> = { ...(previous?.counts ?? {}) };
  counts[zone] = (counts[zone] ?? 0) + 1;
  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL) {
    for (const k of Object.keys(counts)) counts[k] = Math.floor(counts[k] / 2);
    total = Object.values(counts).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(counts)) if (counts[k] === 0) delete counts[k];
  }
  return { ...map, [key]: { counts, last: previous && previous.last > at ? previous.last : at } };
}

/** Costruisce la mappa da un elenco di conferme, nell'ordine dato. */
export function zoneMapFrom(observations: readonly ZoneObservation[]): ZoneMap {
  return observations.reduce<ZoneMap>((map, o) => recordZone(map, o), EMPTY_ZONE_MAP);
}

export interface UsualZone {
  zone: string;
  count: number;
  /** Quota delle conferme che cadono in questa zona. */
  share: number;
}

/** La zona in cui l'alimento sta di solito: serve almeno un po' di storia e una zona che prevalga nettamente. */
export function usualZone(
  map: ZoneMap,
  location: ScanLocation,
  food: string,
  options: { minCount?: number; minShare?: number } = {},
): UsualZone | undefined {
  const stat = map[mapKey(location, food)];
  if (!stat) return undefined;
  const entries = Object.entries(stat.counts).filter(([zone]) => zoneDef(location, zone));
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return undefined;
  const [zone, count] = entries.sort((a, b) => b[1] - a[1] || zoneRank(location, a[0]) - zoneRank(location, b[0]))[0];
  const share = count / total;
  if (count < (options.minCount ?? 2) || share < (options.minShare ?? 0.6)) return undefined;
  return { zone, count, share };
}

/** Ripulisce una mappa letta dal disco: scarta ciò che non ha la forma giusta, non lancia. */
export function normalizeZoneMap(raw: unknown): ZoneMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ZoneStat> = {};
  for (const [key, value] of Object.entries(raw)) {
    const location = key.split(":", 1)[0] as ScanLocation;
    if (!SCAN_LOCATIONS.includes(location) || typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    const counts: Record<string, number> = {};
    if (typeof v.counts === "object" && v.counts !== null && !Array.isArray(v.counts)) {
      for (const [zone, n] of Object.entries(v.counts)) {
        if (zoneDef(location, zone) && typeof n === "number" && Number.isFinite(n) && n > 0) counts[zone] = Math.floor(n);
      }
    }
    if (Object.keys(counts).length > 0) out[key] = { counts, last: typeof v.last === "string" ? v.last : "" };
  }
  return out;
}
