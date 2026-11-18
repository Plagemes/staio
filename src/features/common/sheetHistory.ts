// Il foglio dal basso e il tasto indietro del telefono.
//
// Dove il sistema manda già al `dialog` la richiesta di chiusura (Android, con CloseWatcher) non serve altro.
// Altrove il foglio aggiunge un passo alla cronologia con lo stesso indirizzo (`history.pushState`, che il router di
// Next integra): il tasto indietro toglie quel passo e il foglio si chiude; una chiusura da codice lo toglie con
// `history.back()`. A ogni `popstate` il router ripristina la pagina e scarta la navigazione in corso: per questo una
// navigazione che segue la chiusura parte solo dopo, con `closeSheetThen`.
//
// Dentro un passo interno del foglio (`onBack`) l'«indietro» non chiude: torna al passo prima. Sulla prima strada basta
// impedire la chiusura. Sulla seconda il passo è già stato tolto e va rimesso: si torna avanti sullo stesso passo, che
// è ancora lì (`history.forward()`). Aggiungerne uno nuovo senza un tocco non regge: Chrome e Safari, tornando
// indietro, saltano i passi nati senza un gesto di chi usa l'app.
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

/** Che cosa fa un «indietro» a foglio aperto: lo chiude, torna al passo prima dentro il foglio, o niente. */
export type BackRequest = "close" | "back" | "stay";

export interface BackRequestContext {
  /** Il foglio è in un passo interno: chi lo usa ha passato `onBack`. */
  hasBack: boolean;
  /** Azione in corso. */
  busy: boolean;
  /** L'«indietro» ha portato su un'altra pagina: il foglio non ha più dove stare. */
  leftPage?: boolean;
}

/** La scelta per il tasto indietro del telefono, lo scorrimento dal bordo ed Esc. «Chiudi» e il tocco fuori non passano da qui. */
export function backRequest({ hasBack, busy, leftPage = false }: BackRequestContext): BackRequest {
  if (leftPage) return "close";
  if (busy) return "stay";
  return hasBack ? "back" : "close";
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
  /** Torna al passo prima, dentro il foglio. */
  back: () => void;
  /** Lo stato del foglio adesso, per `backRequest`. */
  context: () => BackRequestContext;
  /** L'indirizzo della pagina su cui il foglio è aperto, cioè del passo sotto il suo. */
  href: string;
  /** Falso dove il sistema chiude già il `dialog`: lì il foglio non ha un passo nella cronologia. */
  step: boolean;
  /** Senza il suo passo in cima finché la cronologia si muove: lo aggiunge, se manca, quando il browser ha finito. */
  waiting: boolean;
}

/**
 * Uno spostamento nella cronologia chiesto da qui, di cui si aspetta il `popstate`:
 * `unmount` toglie il passo di un foglio chiuso, `skip` salta il passo rimasto di un foglio che non c'è più,
 * `forward` rimedia a un `unmount` arrivato dopo che il router aveva già aggiunto una pagina,
 * `restore` torna avanti sul passo di un foglio che resta aperto dopo un «indietro».
 */
type Flight = "unmount" | "skip" | "forward" | "restore";

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
  if (kind === "forward" || kind === "restore") window.history.forward();
  else window.history.back();
}

/** Mette in cima il passo del foglio. Sopra il passo rimasto di un altro foglio lo sostituisce: mai due passi di fogli in fila. */
function claim(sheet: MountedSheet): void {
  const top = sheetMarkerOf(window.history.state);
  if (top === sheet.id) return;
  sheet.href = window.location.href;
  const next = withSheetMarker(window.history.state, sheet.id);
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
    claim(sheet);
  }
  if (afterClose.length > 0 && !removalAhead()) runAfterClose();
}

function onPopState(): void {
  const done = flight;
  flight = null;
  clearTimeout(flightTimer);
  const marker = sheetMarkerOf(window.history.state);

  if (done !== null && marker !== null && done !== "forward" && done !== "restore") {
    // `unmount`: tra la richiesta e lo spostamento il router ha aggiunto una pagina, e si è tornati da quella sul passo
    // del foglio: si torna avanti. `skip`: sotto c'era il passo rimasto di un altro foglio.
    travel(done === "unmount" ? "forward" : "skip");
    return;
  }
  // Il resto parte a evento finito. L'ascoltatore del router sta sulla stessa finestra e può venire dopo questo:
  // il suo ripristino scarterebbe una navigazione fatta partire da qui dentro.
  setTimeout(() => {
    if (done === null) afterTraversal(marker);
    // il foglio si è chiuso mentre si tornava sul suo passo: il passo va tolto prima di far partire ciò che aspettava
    else if (done === "restore" && flight === null && staleStepOnTop()) travel("skip");
    else settle();
  }, 0);
}

/** In cima c'è il passo di un foglio che non è più montato. */
function staleStepOnTop(): boolean {
  const marker = sheetMarkerOf(window.history.state);
  return marker !== null && !mounted.some((sheet) => sheet.id === marker);
}

/**
 * Il foglio resta aperto dopo un «indietro» che ha tolto il suo passo: si torna avanti su quel passo.
 * Se il browser non ci torna, `settle` ne aggiunge uno nuovo con lo stesso segno.
 */
function restore(sheet: MountedSheet): void {
  sheet.waiting = true;
  if (flight === null) travel("restore");
}

/** Tasto indietro, o avanti, del telefono: `marker` è il segno del passo su cui si è arrivati. */
function afterTraversal(marker: string | null): void {
  for (const sheet of [...mounted]) {
    if (!sheet.step || sheet.waiting || sheet.id === marker) continue;
    const request = backRequest({ ...sheet.context(), leftPage: window.location.href !== sheet.href });
    if (request === "close") {
      sheet.close();
      continue;
    }
    restore(sheet);
    if (request === "back") sheet.back();
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
  else claim(sheet);
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
  /** La richiesta di chiusura che arriva dal sistema (evento `cancel`: tasto indietro di Android, Esc): chiude, torna al passo prima o non fa niente. */
  back: () => void;
}

export interface SheetInnerStep {
  /** C'è quando il foglio è in un passo interno: l'«indietro» la chiama e il foglio resta aperto. */
  onBack?: () => void;
  /** Azione in corso: l'«indietro» non fa niente. */
  busy?: boolean;
}

/**
 * Tiene nella cronologia il passo del foglio finché il componente è montato, dove serve.
 * Quando il passo è stato tolto da fuori (tasto indietro, scorrimento dal bordo) chiama `close` oppure, dentro un passo
 * interno, `onBack`: in quel caso il passo torna al suo posto.
 */
export function useSheetHistory(close: () => void, { onBack, busy = false }: SheetInnerStep = {}): SheetHistory {
  const idRef = useRef<string | null>(null);
  const closeRef = useRef(close);
  const onBackRef = useRef(onBack);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = close;
    onBackRef.current = onBack;
    busyRef.current = busy;
  }, [close, onBack, busy]);

  useEffect(() => {
    const id = (idRef.current ??= newSheetId());
    const sheet: MountedSheet = {
      id,
      close: () => closeRef.current(),
      back: () => onBackRef.current?.(),
      context: () => ({ hasBack: onBackRef.current !== undefined, busy: busyRef.current }),
      href: window.location.href,
      step: stepNeeded(),
      waiting: false,
    };
    attach(sheet);
    return () => detach(sheet);
  }, []);

  const closeThen = useCallback((run: () => void) => closeSheetThen(run), []);
  const back = useCallback(() => {
    const request = backRequest({ hasBack: onBackRef.current !== undefined, busy: busyRef.current });
    if (request === "back") onBackRef.current?.();
    else if (request === "close") closeRef.current();
  }, []);
  return useMemo(() => ({ closeThen, back }), [closeThen, back]);
}
