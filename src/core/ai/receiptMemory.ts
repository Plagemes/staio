// Lo scontrino che impara: "questa riga di questo negozio = questo prodotto". Logica pura: la lettura e la scrittura
// nell'archivio delle impostazioni le fa la schermata. Tutto ciò che si ricorda è una scelta dell'utente, mai un dato certo.
import { isFoodCategory } from "@/core/expiry";
import { LOCATIONS, type Location } from "@/core/ledger";

/** Le chiavi stanno fuori da `ai.*`: quel prefisso è segreto e non entra nella copia delle impostazioni, questa memoria sì. */
export const RECEIPT_MEMORY_PREFIX = "receipt.memory.";
/** Chiave della memoria generale, per gli scontrini senza negozio. */
export const GENERAL_STORE_KEY = "_";
export const MEMORY_VERSION = 1;
/** Quante volte di fila la riga ricordata può essere cambiata in modo diverso prima che non si applichi più da sola. */
export const UNSTABLE_AFTER = 2;
/** Righe ricordate per negozio: oltre, si dimenticano le meno recenti. */
export const MAX_ENTRIES = 400;
/** Negozi ricordati: oltre, si dimentica quello usato meno di recente. */
export const MAX_STORES = 40;

export interface MemoryEntry {
  /** Nome scelto dall'utente (o del prodotto collegato). */
  name: string;
  /** Chiave del motore delle scadenze; vuota per una riga da ignorare. */
  category: string;
  /** Quantità come si scrive nel modulo, per esempio "1 l". */
  quantity: string;
  location: Location;
  /** «Ignora sempre»: la riga non è cibo (sacchetto, sconto, totale). */
  ignore: boolean;
  /** Prodotto collegato leggendo il codice a barre. */
  barcode?: string;
  daysAfterOpening?: number;
  /** Quantità letta dalla foto quando la riga è stata ricordata (se c'era sullo scontrino): una lettura diversa a codice collegato è solo una proposta. */
  seen?: string;
  /** Cambi di fila, tutti diversi dal ricordato; a `UNSTABLE_AFTER` non si applica più da sola. */
  strikes: number;
  /** Ultimo aggiornamento, ISO UTC. */
  at: string;
}

export interface MemoryRow {
  version: typeof MEMORY_VERSION;
  entries: Record<string, MemoryEntry>;
  /** Ultimo scontrino salvato per questo negozio, ISO UTC (vuoto se mai): decide quale negozio dimenticare per primo. */
  usedAt: string;
}

/** Ciò che l'utente ha deciso per una riga, nella forma in cui si confronta e si ricorda. */
export interface LineState {
  name: string;
  category: string;
  quantity: string;
  location: Location;
  ignore: boolean;
  barcode?: string;
  daysAfterOpening?: number;
}

export const emptyRow = (): MemoryRow => ({ version: MEMORY_VERSION, entries: {}, usedAt: "" });

/** Le righe sono oggetti normali: una chiave come «constructor» non deve trovare ciò che l'oggetto eredita. */
export const entryOf = (row: MemoryRow, key: string): MemoryEntry | undefined => (Object.hasOwn(row.entries, key) ? row.entries[key] : undefined);

export const isStable = (entry: Pick<MemoryEntry, "strikes">): boolean => entry.strikes < UNSTABLE_AFTER;

export const entryCount = (row: MemoryRow | undefined): number => (row ? Object.keys(row.entries).length : 0);

// ---------------------------------------------------------------- chiavi

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Parole che dopo il nome del negozio introducono l'indirizzo o la forma societaria: non fanno parte del nome. */
const STORE_STOP = new Set(["via", "viale", "piazza", "piazzale", "corso", "largo", "strada", "str", "loc", "localita", "snc", "srl", "spa", "sas", "scarl"]);

/** Nome del negozio normalizzato: senza maiuscole, accenti, punteggiatura, indirizzo e numeri. Vuoto se non c'è un nome. */
export function normalizeStoreKey(store: string): string {
  // «Catena · Punto vendita»: vale la catena, che non cambia da un punto vendita all'altro
  const head = store.split("·")[0] ?? "";
  const words = stripAccents(head.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
  const kept: string[] = [];
  for (const word of words) {
    if ((kept.length > 0 && STORE_STOP.has(word)) || /\d/.test(word)) {
      if (kept.length > 0) break;
      continue;
    }
    kept.push(word);
  }
  return kept.join("-").slice(0, 60);
}

/** Chiave dell'archivio per un negozio; `""` (negozio assente) dà la memoria generale. */
export const memoryRowKey = (storeKey: string): string => `${RECEIPT_MEMORY_PREFIX}${storeKey === "" ? GENERAL_STORE_KEY : storeKey}`;

/** Parole che compaiono accanto a un prezzo o a un peso variabile e non dicono nulla sul prodotto. */
const VARIABLE_NOISE = new Set(["x", "kg", "g", "gr", "eur", "euro", "e", "al", "/kg", "eur/kg", "e/kg"]);
const DECIMAL = /^\d+[.,]\d+$/;
const PER_UNIT = String.raw`\s*\/\s*(?:kg|hg|g|l)\b`;
/** Il peso di un prodotto a peso è variabile solo se la riga dice anche il prezzo al chilo («kg x €/kg»): nel dubbio il numero resta. */
const VARIABLE_WEIGHT: readonly RegExp[] = [
  new RegExp(String.raw`\d+[.,]\d+\s*(?:kg|hg|g|l)\s*[x×]\s*\d+[.,]\d+\s*(?:eur|euro)?${PER_UNIT}`, "g"), // 0,834 kg x 2,49 eur/kg
  new RegExp(String.raw`\d+[.,]\d+\s*(?:kg|hg|g|l)\s+\d+[.,]\d+\s*(?:eur|euro)?${PER_UNIT}`, "g"), // 0,832 kg 2,49 eur/kg
  new RegExp(String.raw`\d+[.,]\d+\s*(?:eur|euro)?${PER_UNIT}`, "g"), // 2,49 eur/kg
];
/** Formato della confezione: numero (anche decimale) e unità, con o senza spazio. */
const PACK_FORMAT = /(^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|lt|l|kg|hg|gr|g|pz)\b(?![.,/]?\d)/g;
const FORMAT_BASE: Record<string, readonly [string, number]> = {
  ml: ["ml", 1],
  cl: ["ml", 10],
  dl: ["ml", 100],
  l: ["ml", 1000],
  lt: ["ml", 1000],
  g: ["g", 1],
  gr: ["g", 1],
  hg: ["g", 100],
  kg: ["g", 1000],
  pz: ["pz", 1],
};

/** «0,5 l», «0.5L» e «500 ml» sono lo stesso formato: unità di base, senza spazi. */
function packFormat(num: string, unit: string): string {
  const [base, factor] = FORMAT_BASE[unit];
  return `${Math.round(Number(num.replace(",", ".")) * factor * 100) / 100}${base}`;
}

/**
 * Testo della riga normalizzato: senza maiuscole, accenti, punteggiatura e spazi in più, e senza ciò che cambia a ogni
 * acquisto: prezzi, peso variabile dei prodotti a peso (con il prezzo al chilo), quantità moltiplicate dalla cassa.
 * Il formato della confezione ("1l", "0,5 kg", "125") fa parte della chiave, normalizzato: nel dubbio la chiave resta
 * distinta, perché non riconoscere un prodotto costa meno che riconoscerne uno sbagliato.
 * Se la riga stampata manca vale il nome letto. Vuoto se non resta nulla.
 */
export function normalizeLineKey(raw: string, fallbackName = ""): string {
  const source = raw.trim() !== "" ? raw : fallbackName;
  let text = stripAccents(source.toLowerCase()).replace(/€/g, " eur ");
  for (const pattern of VARIABLE_WEIGHT) text = text.replace(pattern, " ");
  text = text
    .replace(/\b\d+\s*[x×]\s*(?=\d+[.,]\d+)/g, " ") // "2 x 1,29"
    .replace(PACK_FORMAT, (_m, pre: string, num: string, unit: string) => `${pre} ${packFormat(num, unit)} `)
    .replace(/([a-z])\.(?=[a-z]|\s|$)/g, "$1") // "P.S." e "PS", "MOZZ." e "MOZZ"
    .replace(/[^a-z0-9.,/\s]/g, " ");
  const tokens = text.split(/\s+/).filter((t) => t !== "");
  const dropped = tokens.map((t) => DECIMAL.test(t));
  // le sigle di prezzo vicine a un numero tolto (o a un'altra sigla tolta) vanno via con lui
  let changed = true;
  while (changed) {
    changed = false;
    tokens.forEach((t, i) => {
      if (dropped[i] || !VARIABLE_NOISE.has(t)) return;
      if (dropped[i - 1] || dropped[i + 1]) {
        dropped[i] = true;
        changed = true;
      }
    });
  }
  return tokens
    .filter((_, i) => !dropped[i])
    .map((t) => t.replace(/^[.,/]+|[.,/]+$/g, ""))
    .filter((t) => t !== "")
    .join(" ")
    .slice(0, 100);
}

// ---------------------------------------------------------------- confronto

export const quantityKey = (q: string) => q.toLowerCase().replace(/\s+/g, "").replace(",", ".");

/** Due stati sono lo stesso se dicono la stessa cosa: nome senza maiuscole, quantità senza spazi, stessa categoria, luogo e codice. */
export function sameState(a: LineState, b: LineState): boolean {
  if (a.ignore || b.ignore) return a.ignore === b.ignore;
  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.category === b.category &&
    quantityKey(a.quantity) === quantityKey(b.quantity) &&
    a.location === b.location &&
    (a.barcode ?? "") === (b.barcode ?? "")
  );
}

export const stateOfEntry = (e: MemoryEntry): LineState => ({
  name: e.name,
  category: e.category,
  quantity: e.quantity,
  location: e.location,
  ignore: e.ignore,
  ...(e.barcode ? { barcode: e.barcode } : {}),
  ...(e.daysAfterOpening !== undefined ? { daysAfterOpening: e.daysAfterOpening } : {}),
});

// ---------------------------------------------------------------- lettura difensiva

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readEntry(value: unknown): MemoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const ignore = value.ignore === true;
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : "";
  const location = typeof value.location === "string" && (LOCATIONS as readonly string[]).includes(value.location) ? (value.location as Location) : undefined;
  const category = typeof value.category === "string" ? value.category : "";
  const quantity = typeof value.quantity === "string" ? value.quantity.trim().slice(0, 40) : "";
  if (!ignore && (name === "" || location === undefined || !isFoodCategory(category) || quantity === "")) return undefined;
  const strikes = typeof value.strikes === "number" && Number.isInteger(value.strikes) ? Math.min(UNSTABLE_AFTER, Math.max(0, value.strikes)) : 0;
  const barcode = typeof value.barcode === "string" && /^\d{8,14}$/.test(value.barcode) ? value.barcode : undefined;
  const dao =
    typeof value.daysAfterOpening === "number" && Number.isInteger(value.daysAfterOpening) && value.daysAfterOpening >= 1 && value.daysAfterOpening <= 3650
      ? value.daysAfterOpening
      : undefined;
  return {
    name,
    category: ignore ? "" : category,
    quantity: ignore ? "" : quantity,
    location: location ?? "frigo",
    ignore,
    ...(barcode ? { barcode } : {}),
    ...(dao !== undefined ? { daysAfterOpening: dao } : {}),
    ...(typeof value.seen === "string" && value.seen !== "" ? { seen: value.seen.slice(0, 40) } : {}),
    strikes,
    at: typeof value.at === "string" ? value.at : "",
  };
}

/** Ciò che arriva dall'archivio può essere stato importato da un file: si tiene solo ciò che è valido. */
export function readRow(value: unknown): MemoryRow {
  if (!isRecord(value) || !isRecord(value.entries)) return emptyRow();
  const pairs: [string, MemoryEntry][] = [];
  for (const [key, raw] of Object.entries(value.entries)) {
    const entry = readEntry(raw);
    if (entry && key !== "") pairs.push([key, entry]);
  }
  // fromEntries crea proprietà proprie anche per «__proto__»
  return { version: MEMORY_VERSION, entries: Object.fromEntries(pairs), usedAt: typeof value.usedAt === "string" ? value.usedAt : "" };
}

// ---------------------------------------------------------------- uso

export interface MemoryHit {
  source: "store" | "general";
  entry: MemoryEntry;
  /** Vero se si applica da sola: negozio noto e riga stabile. Altrimenti è solo una proposta. */
  auto: boolean;
}

export interface LoadedMemory {
  /** Chiave normalizzata del negozio; vuota se il negozio manca. */
  storeKey: string;
  /** Righe del negozio (o quelle generali, se il negozio manca). */
  row: MemoryRow;
}

export const emptyMemory = (): LoadedMemory => ({ storeKey: "", row: emptyRow() });

/** Con un negozio noto vale la memoria del negozio, applicata da sola se stabile; senza negozio vale la generale, solo come proposta. */
export function lookupLine(memory: LoadedMemory, lineKey: string, seen?: string): MemoryHit | undefined {
  if (lineKey === "") return undefined;
  const entry = entryOf(memory.row, lineKey);
  if (!entry) return undefined;
  if (memory.storeKey === "") return { source: "general", entry, auto: false };
  // un prodotto collegato dal codice a barre non si applica da solo se la quantità letta ora non è quella di allora
  const otherFormat = entry.barcode !== undefined && entry.seen !== undefined && seen !== undefined && entry.seen !== seen;
  return { source: "store", entry, auto: isStable(entry) && !otherFormat };
}

export interface LearnInput {
  key: string;
  /** Ciò che l'utente ha confermato per la riga. */
  final: LineState;
  /** Ciò che aveva proposto la lettura, prima di qualunque correzione; serve a capire se c'è stata una correzione. */
  proposed?: LineState;
  /** Quantità letta dalla foto, se c'era sullo scontrino. */
  seen?: string;
  now: string;
}

/**
 * Aggiorna la memoria con una riga confermata. Una correzione nuova sostituisce la vecchia; se la riga ricordata è stata
 * cambiata in modo diverso `UNSTABLE_AFTER` volte di fila non si applica più da sola, e torna stabile se l'utente la conferma.
 * Una riga mai ricordata si ricorda solo se è stata corretta, collegata a un prodotto o segnata «ignora sempre».
 */
export function learnLine(row: MemoryRow, input: LearnInput): MemoryRow {
  const { key, final, proposed, seen, now } = input;
  if (key === "") return row;
  const existing = entryOf(row, key);
  let strikes = 0;
  if (existing) {
    strikes = sameState(stateOfEntry(existing), final) ? 0 : Math.min(UNSTABLE_AFTER, existing.strikes + 1);
  } else {
    const corrected = final.ignore || final.barcode !== undefined || proposed === undefined || !sameState(proposed, final);
    if (!corrected) return row;
  }
  const entry: MemoryEntry = {
    name: final.name.trim().slice(0, 120),
    category: final.ignore ? "" : final.category,
    quantity: final.ignore ? "" : final.quantity.trim().slice(0, 40),
    location: final.location,
    ignore: final.ignore,
    ...(!final.ignore && final.barcode ? { barcode: final.barcode } : {}),
    ...(!final.ignore && final.daysAfterOpening !== undefined ? { daysAfterOpening: final.daysAfterOpening } : {}),
    ...(!final.ignore && seen ? { seen } : {}),
    strikes,
    at: now,
  };
  return prune({ ...row, entries: { ...row.entries, [key]: entry }, usedAt: now });
}

/** La riga senza la voce indicata («Non ignorarla più»). */
export function dropEntry(row: MemoryRow, key: string): MemoryRow {
  if (!Object.hasOwn(row.entries, key)) return row;
  return { ...row, entries: Object.fromEntries(Object.entries(row.entries).filter(([k]) => k !== key)) };
}

/** Quali negozi dimenticare perché ce ne sono più di `MAX_STORES`: i meno usati di recente, mai quello appena usato. */
export function storesToForget(stores: readonly { storeKey: string; usedAt: string }[], keep: string): string[] {
  const over = stores.length - MAX_STORES;
  if (over <= 0) return [];
  return stores
    .filter((s) => s.storeKey !== keep)
    .sort((a, b) => (a.usedAt < b.usedAt ? -1 : a.usedAt > b.usedAt ? 1 : 0))
    .slice(0, over)
    .map((s) => s.storeKey);
}

function prune(row: MemoryRow): MemoryRow {
  const keys = Object.keys(row.entries);
  if (keys.length <= MAX_ENTRIES) return row;
  const newest = keys.sort((a, b) => (row.entries[a].at < row.entries[b].at ? 1 : -1)).slice(0, MAX_ENTRIES);
  return { ...row, entries: Object.fromEntries(newest.map((k) => [k, row.entries[k]])) };
}
