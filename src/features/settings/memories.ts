// Che cosa l'app ricorda per far fare prima, e dove: il catalogo delle «Memorie» di Impostazioni › Dati.
// Una memoria propone e non decide: si può dimenticare senza perdere nulla di ciò che l'utente ha registrato o scritto
// apposta. Chi aggiunge una memoria nuova la registra qui, con le sue chiavi; una chiave che non è qui non viene mai
// toccata da «Dimentica».
// Funzioni pure: leggere e togliere le chiavi dall'archivio sta in `memoriesStore.ts`.

export interface MemoryDefinition {
  id: string;
  label: string;
  /** Una frase: che cosa ricorda. */
  hint: string;
  /** Chiavi esatte. */
  keys: readonly string[];
  /** Chiavi che cominciano così (una per codice, per negozio…). Ogni chiave conta una voce. */
  prefixes: readonly string[];
}

export const MEMORIES: readonly MemoryDefinition[] = [
  { id: "items", label: "Alimenti aggiunti", hint: "Categoria, posto e quantità che hai usato per ogni alimento.", keys: ["itemDefaults.v1"], prefixes: [] },
  { id: "portions", label: "Porzioni abituali", hint: "Quanto prendi di solito di ogni alimento.", keys: ["portions.v1"], prefixes: [] },
  { id: "barcodes", label: "Codici a barre", hint: "Che cosa hai scelto per ogni codice letto.", keys: [], prefixes: ["barcode.choice.", "barcode.category."] },
  { id: "receipts", label: "Scontrini", hint: "Come leggo le righe degli scontrini, negozio per negozio.", keys: [], prefixes: ["receipt.memory."] },
  { id: "zones", label: "Dove metti gli alimenti", hint: "Da foto della dispensa: dove sta di solito ogni alimento.", keys: ["ai.zones"], prefixes: [] },
  { id: "foods", label: "Alimenti riconosciuti a mano", hint: "Gli alimenti che hai scelto quando non li riconoscevo.", keys: ["foodOverrides"], prefixes: [] },
  { id: "classes", label: "Classificazioni corrette", hint: "Come hai detto che vanno contati certi alimenti in «Qualità di ciò che mangi».", keys: ["quality.classOverrides"], prefixes: [] },
  { id: "drinks", label: "Tè e caffè", hint: "Il prodotto che hai usato l'ultima volta.", keys: [], prefixes: ["drinkProduct."] },
  { id: "quickAdd", label: "Ultima scelta in «Più alimenti»", hint: "Comprati o già in casa.", keys: ["quickAdd.mode"], prefixes: [] },
  { id: "kept", label: "Pasti tenuti in Oggi", hint: "I pasti che hai tenuto così come sono.", keys: ["today.keptMeals.v1"], prefixes: [] },
  { id: "briefing", label: "Righe lasciate così", hint: "Le righe di «Da guardare oggi» che hai chiuso.", keys: ["briefing.dismissed"], prefixes: [] },
  { id: "shopping", label: "Scelte della spesa", hint: "Voci confermate, tolte o rifiutate nella lista.", keys: ["shopping.decisions", "shopping.rejections"], prefixes: [] },
  { id: "stores", label: "Negozi e ordine della spesa", hint: "Le ultime spese, per ordinare la lista come il negozio.", keys: ["shopping.history"], prefixes: [] },
];

/**
 * Ciò che NON è una memoria e «Dimentica» non tocca mai: dichiarazioni, profilo, scelte scritte apposta, chiavi segrete,
 * stato di una cosa in corso (la cucina, la bozza dello scontrino), tecnica. Elenco di sicurezza: `keysOf` lo applica
 * anche a una chiave che il catalogo, per errore, includesse.
 */
export const NOT_MEMORIES = {
  keys: [
    "recipes.prefs",
    "nutritionProfile",
    "quality.goals",
    "quality.eaten.level",
    "waterGoalMl",
    "assistant.pinned",
    "shopping.manual",
    "shopping.stock",
    "shopping.trip",
    "shopping.lastTrip",
    "shopping.budget",
    "shopping.monthlyBudget",
    "recipes.cookSession",
    "receipt.draft",
    "ai.settings",
    "video.service",
    "deviceId",
  ],
  prefixes: ["migrations.", "diet.", "backup.", "appearance."],
} as const;

/** La chiave è di quelle che non si dimenticano mai. */
export function isProtectedKey(key: string): boolean {
  return NOT_MEMORIES.keys.some((k) => k === key) || NOT_MEMORIES.prefixes.some((p) => key.startsWith(p));
}

/** Le chiavi di una memoria tra quelle presenti, mai una protetta. */
export function keysOf(memory: MemoryDefinition, allKeys: readonly string[]): string[] {
  return allKeys.filter((key) => !isProtectedKey(key) && (memory.keys.includes(key) || memory.prefixes.some((p) => key.startsWith(p))));
}

/** Tutte le chiavi che sono memorie, tra quelle presenti. */
export function memoryKeys(allKeys: readonly string[]): string[] {
  const found = new Set(MEMORIES.flatMap((m) => keysOf(m, allKeys)));
  return allKeys.filter((key) => found.has(key));
}

export interface MemorySummary {
  id: string;
  label: string;
  hint: string;
  /** Quante voci: elementi dell'elenco o dell'oggetto, o chiavi per i prefissi. Mai zero. */
  count: number;
  keys: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Le voci di un valore: gli elementi di un elenco, le chiavi di un oggetto, 1 per un valore singolo, 0 se non c'è niente. */
export function entriesIn(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return typeof value === "string" && value === "" ? 0 : 1;
}

/** Le scelte della spesa tengono tre elenchi nello stesso oggetto: si contano tutte, non le tre sezioni. */
const GROUPED: Record<string, readonly string[]> = { "shopping.decisions": ["confirmed", "quantities", "dismissed"], "shopping.rejections": ["entries"] };

function countKey(key: string, value: unknown): number {
  const groups = GROUPED[key];
  if (groups !== undefined) return isRecord(value) ? groups.reduce((sum, g) => sum + entriesIn(value[g]), 0) : entriesIn(value);
  return entriesIn(value);
}

/**
 * Le memorie che hanno almeno una voce, nell'ordine del catalogo. Per una chiave con prefisso ogni chiave è una voce;
 * per una chiave sola si contano le voci del suo valore.
 */
export function listMemories(rows: readonly { key: string; value: unknown }[]): MemorySummary[] {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: MemorySummary[] = [];
  for (const memory of MEMORIES) {
    const keys = keysOf(memory, [...byKey.keys()]).sort();
    let count = 0;
    for (const key of keys) count += memory.prefixes.some((p) => key.startsWith(p)) ? (entriesIn(byKey.get(key)) > 0 ? 1 : 0) : countKey(key, byKey.get(key));
    if (count > 0) out.push({ id: memory.id, label: memory.label, hint: memory.hint, count, keys });
  }
  return out;
}

/** «312 voci» · «1 scelta». */
export const countText = (count: number): string => (count === 1 ? "1 scelta" : `${count} voci`);

/** Il totale delle voci ricordate, per la riga di Impostazioni. */
export const totalEntries = (memories: readonly MemorySummary[]): number => memories.reduce((sum, m) => sum + m.count, 0);

/** «Dimenticato: porzioni abituali.» */
export const forgotText = (label: string): string => `Dimenticato: ${label[0].toLowerCase()}${label.slice(1)}.`;

export const FORGOT_ALL_TEXT = "Dimenticate tutte le memorie.";

/**
 * Il valore da rimettere con «Annulla» se nel frattempo la chiave è stata riscritta: due oggetti si uniscono (vince
 * ciò che c'è adesso sulle stesse voci), altrimenti resta ciò che c'è adesso. Mai si perde una scelta fatta dopo.
 */
export function mergeForUndo(before: unknown, now: unknown): unknown {
  if (now === undefined) return before;
  if (isRecord(before) && isRecord(now)) return { ...before, ...now };
  return now;
}
