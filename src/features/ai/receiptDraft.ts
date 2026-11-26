"use client";

// La bozza dello scontrino: la revisione si salva sul telefono mentre la fai, perché una lettura si paga e una chiusura
// dell'app non deve buttarla. Sta nella tabella `settings` (`receipt.draft`), fuori dal registro: nulla entra in
// dispensa prima del tocco di conferma. Non è una «memoria» di ciò che l'app impara: è lavoro a metà, e scade.
//
// Un salvataggio non scrive mai due volte la stessa riga: gli id degli eventi nascono dalla lettura e dalla riga
// (`receiptIdGenerator`), quindi riscrivere una riga già scritta è un'operazione che l'archivio ignora, anche se
// l'app si è chiusa tra la scrittura e l'aggiornamento della bozza.
import { useEffect, useMemo } from "react";
import type { IdGenerator } from "@/core/ledger";
import { getSetting, removeSetting, setSetting, useSetting } from "@/data";
import { dayOf, relativeDay } from "../format";
import type { ReceiptReadResult } from "./readReceipt";
import type { ReviewLine } from "./receiptEvents";
import type { ReviewLayout } from "./receiptReview";

export const RECEIPT_DRAFT_KEY = "receipt.draft";
/** Una bozza non toccata da tanti giorni si toglie da sola. */
export const RECEIPT_DRAFT_DAYS = 7;
/** Quanto si aspetta, dopo l'ultimo cambio, prima di scrivere la bozza. */
export const DRAFT_WRITE_DELAY_MS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReceiptDraft {
  v: 1;
  /** Istante dell'ultima scrittura (ISO): da qui contano i 7 giorni. */
  savedAt: string;
  /** Istante della lettura (ISO): è il «letto ieri» della frase. */
  readAt: string;
  /** Identifica la lettura: con la riga dà gli id degli eventi (`receiptIdGenerator`). */
  readingId: string;
  result: ReceiptReadResult;
  lines: ReviewLine[];
  layout: ReviewLayout;
  open: Record<string, boolean>;
  storeName: string;
  /** `YYYY-MM-DD` o vuoto. */
  date: string;
  readingNo: number;
  /** Righe già scritte nel registro da un salvataggio parziale: non stanno più in `lines`. */
  savedLineIds?: string[];
}

/* ---------- lettura di ciò che è scritto ---------- */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isIsoInstant = (v: unknown): v is string => isString(v) && Number.isFinite(Date.parse(v));
const LOCATIONS = new Set(["frigo", "freezer", "dispensa"]);

function isLine(v: unknown): v is ReviewLine {
  if (!isObject(v)) return false;
  if (!isString(v.key) || v.key === "" || typeof v.include !== "boolean" || !isString(v.name) || !isString(v.quantityText)) return false;
  if (typeof v.quantityGuessed !== "boolean" || !isString(v.category) || !isString(v.location) || !LOCATIONS.has(v.location)) return false;
  if (!isNumber(v.discountCents) || !isString(v.raw) || typeof v.isFood !== "boolean") return false;
  if (v.priceCents !== undefined && !isNumber(v.priceCents)) return false;
  if (v.expiry !== undefined && !(isObject(v.expiry) && isString(v.expiry.date) && (v.expiry.via === "shortcut" || v.expiry.via === "label"))) return false;
  if (v.remembered !== undefined && !(isObject(v.remembered) && isObject(v.remembered.entry))) return false;
  if (v.proposed !== undefined && !isObject(v.proposed)) return false;
  return true;
}

function isResult(v: unknown): v is ReceiptReadResult {
  if (!isObject(v) || !isObject(v.reading) || !isObject(v.check) || !isObject(v.usage)) return false;
  if (!Array.isArray(v.reading.lines) || !Array.isArray(v.reading.problems)) return false;
  if (!isNumber(v.usage.inputTokens) || !isNumber(v.usage.outputTokens)) return false;
  if (!isString(v.check.status) || !isString(v.provider) || !isString(v.model) || !isString(v.currency)) return false;
  return typeof v.usageEstimated === "boolean" && typeof v.truncated === "boolean" && (v.cost === null || isNumber(v.cost));
}

function isLayout(v: unknown): v is ReviewLayout {
  return isObject(v) && isStringArray(v.order) && isStringArray(v.excluded);
}

/**
 * La bozza com'è scritta, se è una bozza valida e non scaduta; altrimenti `undefined` (forma rotta, versione diversa,
 * più vecchia di `RECEIPT_DRAFT_DAYS` giorni o con la data nel futuro).
 */
export function parseReceiptDraft(raw: unknown, now: Date): ReceiptDraft | undefined {
  if (!isObject(raw) || raw.v !== 1) return undefined;
  if (!isIsoInstant(raw.savedAt) || !isIsoInstant(raw.readAt) || !isString(raw.readingId) || raw.readingId === "") return undefined;
  const age = now.getTime() - Date.parse(raw.savedAt);
  if (!(age < RECEIPT_DRAFT_DAYS * DAY_MS) || age < -DAY_MS) return undefined;
  if (!isResult(raw.result) || !Array.isArray(raw.lines) || !raw.lines.every(isLine) || !isLayout(raw.layout)) return undefined;
  if (!isObject(raw.open) || !Object.values(raw.open).every((o) => typeof o === "boolean")) return undefined;
  if (!isString(raw.storeName) || !isString(raw.date) || !isNumber(raw.readingNo)) return undefined;
  if (raw.savedLineIds !== undefined && !isStringArray(raw.savedLineIds)) return undefined;
  return raw as unknown as ReceiptDraft;
}

/* ---------- la frase ---------- */

const rowsText = (n: number) => (n === 1 ? "1 riga" : `${n} righe`);

/** «Conad, 12 righe, letto ieri»; senza negozio «12 righe, letto oggi». */
export function draftSummary(draft: Pick<ReceiptDraft, "storeName" | "lines" | "readAt">, now: Date): string {
  const store = draft.storeName.trim();
  const when = relativeDay(dayOf(draft.readAt), dayOf(now.toISOString()));
  return `${store === "" ? "" : `${store}, `}${rowsText(draft.lines.length)}, letto ${when}`;
}

/* ---------- da cosa è fatta ---------- */

export interface DraftInput {
  readingId: string;
  readAt: string;
  result: ReceiptReadResult;
  lines: readonly ReviewLine[];
  layout: ReviewLayout;
  open: Readonly<Record<string, boolean>>;
  storeName: string;
  date: string;
  readingNo: number;
  savedLineIds?: readonly string[];
}

/** La bozza dallo stato della schermata: una copia, che non cambia più. */
export function buildDraft(input: DraftInput, now: Date): ReceiptDraft {
  return {
    v: 1,
    savedAt: now.toISOString(),
    readAt: input.readAt,
    readingId: input.readingId,
    result: input.result,
    lines: input.lines.map((l) => ({ ...l })),
    layout: { order: [...input.layout.order], excluded: [...input.layout.excluded] },
    open: { ...input.open },
    storeName: input.storeName,
    date: input.date,
    readingNo: input.readingNo,
    ...(input.savedLineIds && input.savedLineIds.length > 0 ? { savedLineIds: [...input.savedLineIds] } : {}),
  };
}

/* ---------- id che non si ripetono ---------- */

// «line-12» → «line-0012»: nello stesso istante gli eventi si ordinano per id, e le righe restano nell'ordine dello scontrino
const sortable = (key: string) => key.replace(/\d+/g, (d) => d.padStart(4, "0"));

/** Gli id che `receiptIdGenerator` dà all'acquisto di una riga: dell'evento e del lotto. */
export function lineIds(readingId: string, lineKey: string): { eventId: string; lotId: string } {
  return { eventId: `${readingId}:${sortable(lineKey)}:e`, lotId: `${readingId}:${sortable(lineKey)}:l` };
}

/**
 * Il generatore da passare a `buildReceiptEvents` per le righe `lineKeys` (le incluse, nell'ordine): prima l'id dello
 * scontrino (`readingId`), poi per ogni riga l'id dell'evento e quello del lotto. Così una riga scritta due volte ha
 * gli stessi id, e l'archivio ignora la seconda.
 */
export function receiptIdGenerator(readingId: string, lineKeys: readonly string[]): IdGenerator {
  const ids: string[] = [readingId];
  for (const key of lineKeys) {
    const { eventId, lotId } = lineIds(readingId, key);
    ids.push(eventId, lotId);
  }
  let next = 0;
  // oltre l'elenco (non dovrebbe succedere) un id che non può coincidere con nessun altro
  return () => ids[next++] ?? `${readingId}:extra:${next}`;
}

/** Le righe della revisione che il registro conosce già, divise tra vive e tolte dopo il salvataggio. */
export interface LedgerView {
  /** Id di tutti gli eventi del registro. */
  written: ReadonlySet<string>;
  /** Id degli eventi annullati (da «Ultime azioni»): ci sono, ma non contano più. */
  voided: ReadonlySet<string>;
}

const NO_LEDGER: LedgerView = { written: new Set(), voided: new Set() };

/**
 * Prima di un salvataggio, le righe della revisione: `already` sono già in dispensa, `removed` ci sono state e sono state
 * tolte (il loro id esiste: riscriverle non farebbe niente), `toSave` sono quelle incluse che vanno scritte.
 */
export function splitForSave(lines: readonly ReviewLine[], readingId: string, ledger: LedgerView): { already: ReviewLine[]; removed: ReviewLine[]; todo: ReviewLine[]; toSave: ReviewLine[] } {
  const already: ReviewLine[] = [];
  const removed: ReviewLine[] = [];
  const todo: ReviewLine[] = [];
  for (const line of lines) {
    const id = lineIds(readingId, line.key).eventId;
    if (line.include && ledger.written.has(id)) (ledger.voided.has(id) ? removed : already).push(line);
    else todo.push(line);
  }
  return { already, removed, todo, toSave: todo.filter((l) => l.include) };
}

/** Dopo `appendEvents`: l'evento `i` è della riga `i` tra quelle scritte, e `rejected` dice quali indici non sono entrati. */
export function settleSave(toSave: readonly ReviewLine[], rejectedIndexes: Iterable<number>): { saved: ReviewLine[]; rejected: ReviewLine[] } {
  const bad = new Set(rejectedIndexes);
  return { saved: toSave.filter((_, i) => !bad.has(i)), rejected: toSave.filter((_, i) => bad.has(i)) };
}

export interface ReviewState {
  lines: ReviewLine[];
  layout: ReviewLayout;
  open: Record<string, boolean>;
}

/** La revisione senza le righe `done` (già nel registro); le `reopen` restano aperte, con il loro errore in vista. */
export function reviewWithout(state: ReviewState, done: ReadonlySet<string>, reopen: readonly string[] = []): ReviewState {
  const keep = (key: string) => !done.has(key);
  return {
    lines: state.lines.filter((l) => keep(l.key)),
    layout: { order: state.layout.order.filter(keep), excluded: state.layout.excluded.filter(keep) },
    open: { ...Object.fromEntries(Object.entries(state.open).filter(([key]) => keep(key))), ...Object.fromEntries(reopen.map((key) => [key, true])) },
  };
}

/** Il testo vero quando non resta niente da salvare: ciò che c'era è in dispensa, o è stato tolto dopo. */
export function nothingLeftText(inPantry: number, removed: number): string {
  if (removed === 0) return "Questo scontrino era già in dispensa.";
  if (inPantry === 0) return "Le righe di questo scontrino erano state tolte dopo il salvataggio. Per averle di nuovo, rileggile da una foto nuova.";
  return "Questo scontrino era già stato salvato, ma alcune righe sono state tolte dopo. Per averle di nuovo, rileggile da una foto nuova.";
}

/**
 * Le righe della bozza che non sono ancora nel registro: tolte quelle dichiarate salvate, quelle i cui eventi ci sono
 * già e quelle che ci sono state e sono state annullate (`removed`). `saved` sono le chiavi delle righe che non si
 * riscrivono più, `inPantry` quante di esse sono ancora in dispensa.
 */
export function pendingLines(draft: ReceiptDraft, ledger: LedgerView = NO_LEDGER): ReviewState & { saved: string[]; removed: string[]; inPantry: number } {
  const declared = new Set(draft.savedLineIds ?? []);
  const saved = new Set<string>(declared);
  const removed = new Set<string>();
  for (const l of draft.lines) {
    const id = lineIds(draft.readingId, l.key).eventId;
    if (!ledger.written.has(id)) continue;
    saved.add(l.key);
    if (ledger.voided.has(id)) removed.add(l.key);
  }
  const rest = reviewWithout(draft, saved);
  return { ...rest, saved: [...saved], removed: [...removed], inPantry: saved.size - removed.size };
}

/* ---------- una lettura nuova non riscrive ciò che è già stato scritto ---------- */

/** Chi è una riga di scontrino: il testo stampato e il prezzo. */
export function lineSignature(line: Pick<ReviewLine, "raw" | "priceCents">): string {
  return `${line.raw.trim().replace(/\s+/g, " ").toLowerCase()}|${line.priceCents ?? ""}`;
}

/** Ciò che serve a dire se una lettura nuova è lo stesso scontrino: la data e il totale letti. */
export interface ReadingId {
  date?: string;
  totalCents?: number;
}

/** Le righe già scritte di uno scontrino: per ogni firma, quante (due righe identiche sono due). */
export interface WrittenReceipt {
  date: string;
  totalCents?: number;
  signatures: ReadonlyMap<string, number>;
}

/** Le righe `keys` di una lettura (le chiavi sono `line-<posizione>` nella lettura) come già scritte. */
export function writtenReceipt(reading: ReadingId, readingLines: readonly Pick<ReviewLine, "key" | "raw" | "priceCents">[], keys: Iterable<string>): WrittenReceipt {
  const wanted = new Set(keys);
  const signatures = new Map<string, number>();
  for (const l of readingLines) {
    if (!wanted.has(l.key)) continue;
    const sig = lineSignature(l);
    signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
  }
  return { date: reading.date ?? "", ...(reading.totalCents !== undefined ? { totalCents: reading.totalCents } : {}), signatures };
}

/** La stessa lettura: data letta (e non vuota) uguale, e totale uguale se ci sono tutti e due. */
export function sameReceipt(written: WrittenReceipt, reading: ReadingId): boolean {
  const date = reading.date ?? "";
  if (date === "" || written.date !== date) return false;
  return written.totalCents === undefined || reading.totalCents === undefined || written.totalCents === reading.totalCents;
}

/** Aggiunge le righe scritte ora a quelle di prima, se è lo stesso scontrino; altrimenti valgono solo le nuove. */
export function mergeWritten(before: WrittenReceipt | null, now: WrittenReceipt): WrittenReceipt {
  if (before === null || !sameReceipt(before, { date: now.date, totalCents: now.totalCents })) return now;
  const signatures = new Map(before.signatures);
  for (const [sig, n] of now.signatures) signatures.set(sig, (signatures.get(sig) ?? 0) + n);
  return { ...now, signatures };
}

/**
 * Una lettura nuova dello stesso scontrino: le righe uguali a quelle già scritte dalla bozza di prima non tornano
 * incluse, tante quante ne sono state scritte (la riga resta, spenta e «toccata» perché la memoria non la riaccenda).
 * Se non è lo stesso scontrino (`same` falso) non si spegne niente, e chi chiama azzera ciò che ricordava.
 */
export function excludeWritten(lines: readonly ReviewLine[], written: WrittenReceipt | null, reading: ReadingId): { lines: ReviewLine[]; excluded: number; same: boolean } {
  if (written === null || !sameReceipt(written, reading)) return { lines: [...lines], excluded: 0, same: false };
  const left = new Map(written.signatures);
  let excluded = 0;
  const out = lines.map((l) => {
    const sig = lineSignature(l);
    const n = left.get(sig) ?? 0;
    if (!l.include || n === 0) return l;
    left.set(sig, n - 1);
    excluded += 1;
    return { ...l, include: false, touched: true };
  });
  return { lines: out, excluded, same: true };
}

/** «3 righe erano già in dispensa: le ho lasciate fuori.» */
export function leftOutText(n: number): string {
  return n === 1 ? "1 riga era già in dispensa: l'ho lasciata fuori." : `${n} righe erano già in dispensa: le ho lasciate fuori.`;
}

/* ---------- dove sta ---------- */

export interface DraftStore {
  get(): Promise<unknown>;
  set(draft: ReceiptDraft): Promise<void>;
  remove(): Promise<void>;
}

export const settingsDraftStore: DraftStore = {
  get: () => getSetting(RECEIPT_DRAFT_KEY),
  set: (draft) => setSetting(RECEIPT_DRAFT_KEY, draft),
  remove: () => removeSetting(RECEIPT_DRAFT_KEY),
};

export interface DraftWriter {
  /** Scrive la bozza dopo `delayMs` senza altri cambi; una nuova chiamata prende il posto della precedente. */
  schedule(draft: ReceiptDraft): void;
  /** Scrive subito ciò che è in attesa. */
  flush(): Promise<void>;
  /** Scrive subito questa bozza. */
  writeNow(draft: ReceiptDraft): Promise<void>;
  /** Toglie la bozza: ciò che è in attesa non si scrive più e una scrittura in corso finisce prima. */
  clear(): Promise<void>;
}

/**
 * Una scrittura per volta, nell'ordine in cui sono chieste. Un errore dell'archivio non ferma la schermata: la bozza è
 * un aiuto, e il salvataggio vero non passa da qui.
 */
export function createDraftWriter(store: DraftStore = settingsDraftStore, delayMs: number = DRAFT_WRITE_DELAY_MS): DraftWriter {
  let pending: ReceiptDraft | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch(() => undefined);
    return queue;
  };

  const writer: DraftWriter = {
    schedule(draft) {
      pending = draft;
      stop();
      timer = setTimeout(() => void writer.flush(), delayMs);
    },
    flush() {
      stop();
      const draft = pending;
      pending = null;
      return draft === null ? queue : enqueue(() => store.set(draft));
    },
    writeNow(draft) {
      pending = draft;
      return writer.flush();
    },
    clear() {
      stop();
      pending = null;
      return enqueue(() => store.remove());
    },
  };
  return writer;
}

/**
 * La bozza salvata, aggiornata quando cambia. Una bozza rotta o scaduta si toglie da sola (qui e solo qui, quando la
 * si legge). `ready` è falso finché non è stata letta.
 */
export function useReceiptDraft(now: string | null): { draft: ReceiptDraft | undefined; ready: boolean } {
  const live = useSetting<unknown>(RECEIPT_DRAFT_KEY);
  const stored = live.data;
  const instant = now === null ? null : new Date(now);
  const draft = useMemo(() => (instant === null ? undefined : parseReceiptDraft(stored, instant)), [stored, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const stale = !live.loading && stored !== undefined && stored !== null && instant !== null && draft === undefined;
  useEffect(() => {
    if (stale) void removeSetting(RECEIPT_DRAFT_KEY).catch(() => undefined);
  }, [stale]);
  return { draft, ready: !live.loading && now !== null };
}
