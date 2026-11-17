// Il foglio dal basso e il tasto indietro del telefono.
//
// Dove il sistema manda già al `dialog` la richiesta di chiusura (Android, con CloseWatcher) non serve altro.
// Altrove il foglio aggiunge un passo alla cronologia con lo stesso indirizzo (`history.pushState`, che il router di
// Next integra): il tasto indietro toglie quel passo e il foglio si chiude; una chiusura da codice lo toglie con
// `history.back()`. A ogni `popstate` il router ripristina la pagina e scarta la navigazione in corso: per questo una
// navigazione che segue la chiusura parte solo dopo, con `closeSheetThen`.
import { useCallback, useEffect, useMemo, useRef } from "react";

const MARKER = "__sheet";

type HistoryState = Record<string, unknown>;

function asRecord(state: unknown): HistoryState {
  return typeof state === "object" && state !== null ? (state as HistoryState) : {};
}

/** Lo stato di prima, con in più il segno del foglio. */
export function withSheetMarker(state: unknown, id: string): HistoryState {
  return { ...asRecord(state), [MARKER]: id };
}

/** Il foglio a cui appartiene questo passo della cronologia; `null` se è il passo di una pagina. */
export function sheetMarkerOf(state: unknown): string | null {
  const marker = asRecord(state)[MARKER];
  return typeof marker === "string" && marker !== "" ? marker : null;
}

export function isOwnEntry(state: unknown, id: string): boolean {
  return sheetMarkerOf(state) === id;
}

/** Un indirizzo dentro l'app («/app/oggi»). Quelli con un dominio, anche scritti «//dominio», e le ancore restano al browser. */
export function isInternalHref(href: string | null | undefined): boolean {
  if (typeof href !== "string") return false;
  return /^\/(?![/\\])/.test(href.trim());
}

export interface CloseRequestEnvironment {
  hasCloseWatcher: boolean;
  userAgent: string;
  /** `navigator.userAgentData.platform`, dove esiste. */
  platform?: string;
}

/**
 * Vero dove il tasto indietro del sistema chiude da solo un `dialog` modale (evento `cancel`): Android con CloseWatcher.
 * Sul computer CloseWatcher esiste ma risponde solo a Esc, e su iPhone lo scorrimento dal bordo è sempre un passo di cronologia.
 */
export function systemClosesDialogs(env: CloseRequestEnvironment): boolean {
  return env.hasCloseWatcher && (env.platform === "Android" || /\bAndroid\b/i.test(env.userAgent));
}

/* ------------------------------------------------------------------------------------------------
   Stato condiviso tra i fogli della pagina. Tutto ciò che segue vive solo nel browser.
   ------------------------------------------------------------------------------------------------ */

interface MountedSheet {
  id: string;
  /** Chiude il foglio: chi lo usa smette di renderlo. Vale una volta sola. */
  close: () => void;
  /** Falso dove il sistema chiude già il `dialog`: lì il foglio non ha un passo nella cronologia. */
  step: boolean;
  /** Montato mentre un passo stava tornando indietro: aggiunge il suo quando il browser ha finito. */
  waiting: boolean;
}

/**
 * Uno spostamento nella cronologia chiesto da qui, di cui si aspetta il `popstate`:
 * `unmount` toglie il passo di un foglio chiuso, `skip` salta il passo rimasto di un foglio che non c'è più,
 * `forward` rimedia a un `unmount` arrivato dopo che il router aveva già aggiunto una pagina.
 */
type Flight = "unmount" | "skip" | "forward";

/** Se il browser non si sposta (nessun passo dietro), il `popstate` non arriva: dopo questo tempo non lo si aspetta più. */
const FLIGHT_TIMEOUT_MS = 800;
/** Quanto si aspetta, al massimo, che un foglio chiuso tolga il suo passo prima di proseguire comunque. */
const CLOSE_TIMEOUT_MS = 1000;

const mounted: MountedSheet[] = [];
const pendingBacks = new Map<string, ReturnType<typeof setTimeout>>();
const afterClose: Array<() => void> = [];
let afterCloseTimer: ReturnType<typeof setTimeout> | undefined;
let flight: Flight | null = null;
let flightTimer: ReturnType<typeof setTimeout> | undefined;
let counter = 0;

function newSheetId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

function stepNeeded(): boolean {
  const nav = window.navigator as Navigator & { userAgentData?: { platform?: string } };
  return !systemClosesDialogs({ hasCloseWatcher: "CloseWatcher" in window, userAgent: nav.userAgent, platform: nav.userAgentData?.platform });
}

function travel(kind: Flight): void {
  flight = kind;
  clearTimeout(flightTimer);
  flightTimer = setTimeout(() => {
    flight = null;
    settle();
  }, FLIGHT_TIMEOUT_MS);
  if (kind === "forward") window.history.forward();
  else window.history.back();
}

/** Mette in cima il passo del foglio. Sopra il passo rimasto di un altro foglio lo sostituisce: mai due passi di fogli in fila. */
function claim(id: string): void {
  const top = sheetMarkerOf(window.history.state);
  if (top === id) return;
  const next = withSheetMarker(window.history.state, id);
  if (top === null) window.history.pushState(next, "");
  else window.history.replaceState(next, "");
}

/** C'è ancora il passo di un foglio da togliere (o lo si sta togliendo). */
function removalAhead(): boolean {
  return flight !== null || pendingBacks.size > 0 || mounted.some((sheet) => sheet.step && !sheet.waiting);
}

function runAfterClose(): void {
  clearTimeout(afterCloseTimer);
  for (const run of afterClose.splice(0)) run();
}

/** La cronologia è ferma: i fogli in attesa aggiungono il loro passo, e parte ciò che aspettava la chiusura. */
function settle(): void {
  if (flight !== null) return;
  for (const sheet of mounted) {
    if (!sheet.waiting) continue;
    sheet.waiting = false;
    claim(sheet.id);
  }
  if (afterClose.length > 0 && !removalAhead()) runAfterClose();
}

function onPopState(): void {
  const done = flight;
  flight = null;
  clearTimeout(flightTimer);
  const marker = sheetMarkerOf(window.history.state);

  if (done !== null && marker !== null && done !== "forward") {
    // `unmount`: tra la richiesta e lo spostamento il router ha aggiunto una pagina, e si è tornati da quella sul passo
    // del foglio: si torna avanti. `skip`: sotto c'era il passo rimasto di un altro foglio.
    travel(done === "unmount" ? "forward" : "skip");
    return;
  }
  // Il resto parte a evento finito. L'ascoltatore del router sta sulla stessa finestra e può venire dopo questo:
  // il suo ripristino scarterebbe una navigazione fatta partire da qui dentro.
  setTimeout(() => {
    if (done !== null) settle();
    else afterTraversal(marker);
  }, 0);
}

/** Tasto indietro, o avanti, del telefono: `marker` è il segno del passo su cui si è arrivati. */
function afterTraversal(marker: string | null): void {
  for (const sheet of [...mounted]) {
    if (sheet.step && !sheet.waiting && sheet.id !== marker) sheet.close();
  }
  if (flight === null && marker !== null && isOwnEntry(window.history.state, marker) && !mounted.some((sheet) => sheet.id === marker)) travel("skip");
}

function attach(sheet: MountedSheet): void {
  const pending = pendingBacks.get(sheet.id);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingBacks.delete(sheet.id);
  }
  if (process.env.NODE_ENV !== "production" && mounted.length > 0) {
    console.warn("Due fogli aperti insieme: ne va mostrato uno alla volta. Resta in funzione l'ultimo.");
  }
  mounted.push(sheet);
  if (!sheet.step) return;
  if (flight !== null) sheet.waiting = true;
  else claim(sheet.id);
}

function detach(sheet: MountedSheet): void {
  const at = mounted.indexOf(sheet);
  if (at >= 0) mounted.splice(at, 1);
  if (!sheet.step || sheet.waiting) {
    settle();
    return;
  }
  // In sviluppo React smonta e rimonta subito gli effetti: il passo si toglie un attimo dopo, e solo se il foglio non è tornato.
  const timer = setTimeout(() => {
    pendingBacks.delete(sheet.id);
    if (flight === null && isOwnEntry(window.history.state, sheet.id)) travel("unmount");
    else settle();
  }, 0);
  pendingBacks.set(sheet.id, timer);
}

/**
 * Chiude il foglio aperto, se c'è, e poi fa `run`: subito se il foglio non ha un passo nella cronologia, altrimenti
 * quando il passo è stato tolto. Va usata per ogni navigazione che segue una chiusura (`closeSheetThen(() => router.push(…))`):
 * partita prima, il router la scarterebbe al `popstate` del passo tolto.
 */
export function closeSheetThen(run: () => void): void {
  if (typeof window === "undefined") return;
  for (const sheet of [...mounted]) sheet.close();
  if (!removalAhead()) {
    run();
    return;
  }
  afterClose.push(run);
  clearTimeout(afterCloseTimer);
  // chi usa il foglio non l'ha smontato, o il browser non si è mosso: si prosegue lo stesso
  afterCloseTimer = setTimeout(runAfterClose, CLOSE_TIMEOUT_MS);
}

if (typeof window !== "undefined") {
  // Un solo ascoltatore anche dopo un ricaricamento a caldo del modulo, in sviluppo: quello della versione vecchia si toglie.
  const slot = Symbol.for("features/common/sheetHistory.popstate");
  const holder = window as unknown as Record<symbol, (() => void) | undefined>;
  if (holder[slot]) window.removeEventListener("popstate", holder[slot]);
  holder[slot] = onPopState;
  window.addEventListener("popstate", onPopState);
  // Pagina ricaricata con il passo di un foglio in cima: nessun foglio si riapre, e il passo non deve restare «a vuoto».
  if (sheetMarkerOf(window.history.state) !== null) travel("skip");
}

export interface SheetHistory {
  /** Chiude questo foglio e poi fa `run`, quando il suo passo nella cronologia è stato tolto. */
  closeThen: (run: () => void) => void;
}

/**
 * Tiene nella cronologia il passo del foglio finché il componente è montato, dove serve.
 * `close` viene chiamata anche quando il passo è stato tolto da fuori (tasto indietro, scorrimento dal bordo).
 */
export function useSheetHistory(close: () => void): SheetHistory {
  const idRef = useRef<string | null>(null);
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    const id = (idRef.current ??= newSheetId());
    const sheet: MountedSheet = { id, close: () => closeRef.current(), step: stepNeeded(), waiting: false };
    attach(sheet);
    return () => detach(sheet);
  }, []);

  const closeThen = useCallback((run: () => void) => closeSheetThen(run), []);
  return useMemo(() => ({ closeThen }), [closeThen]);
}
