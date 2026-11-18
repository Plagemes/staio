// Lettura condivisa del registro: una sola osservazione per tutta l'app, e le derivazioni calcolate una volta per
// elenco di eventi. I ganci di `hooks.ts` leggono da qui. Chi vuole l'archivio (dopo una scrittura, fuori dai ganci)
// continua a chiamare `getAllEvents`, `getPantry`, `getDiary`: qui non c'è memoria di quelle letture.
import type { Observable } from "dexie";
import { deriveDiary, type DiaryState } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type PantryState } from "@/core/ledger";
import { derivePlan, type PlanState } from "@/core/plan";
import { derivePreps, type PrepState } from "@/core/prep";
import { deriveRecipes, type RecipesState } from "@/core/recipes";
import { liveEvents } from "./eventStore";

/** In sviluppo e nei test i dati condivisi sono congelati: una schermata che li modifica sul posto lancia subito. */
const FREEZE_SHARED = process.env.NODE_ENV !== "production";

function refuseChange(): never {
  throw new TypeError("I dati dei ganci sono condivisi tra le schermate: non si modificano sul posto. Lavora su una copia.");
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value) || ArrayBuffer.isView(value)) return;
  const isMap = value instanceof Map;
  const isSet = value instanceof Set;
  // `Object.freeze` non ferma `set` e `add` di mappe e insiemi: si chiudono i loro metodi su questo oggetto
  if (isMap || isSet) {
    for (const method of isMap ? ["set", "delete", "clear"] : ["add", "delete", "clear"]) {
      Object.defineProperty(value, method, { value: refuseChange });
    }
  }
  // prima l'oggetto, poi ciò che contiene: un giro di riferimenti si ferma al controllo qui sopra
  Object.freeze(value);
  if (isMap) {
    for (const [key, item] of value) {
      deepFreeze(key);
      deepFreeze(item);
    }
  } else if (isSet) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
}

/** Congela in profondità un dato condiviso (solo in sviluppo e nei test); in produzione lo restituisce com'è. */
export function freezeShared<T>(value: T): T {
  if (FREEZE_SHARED) deepFreeze(value);
  return value;
}

interface Store<S> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): S;
  /** Dopo un errore riparte la lettura (lo stato resta l'errore finché l'archivio non risponde); `false` se non c'era un errore. */
  retry(): boolean;
}

/**
 * Una sola iscrizione alla sorgente, aperta alla prima richiesta e mai chiusa: i dati restano in memoria passando da
 * una pagina all'altra. Ogni emissione è uno stato nuovo, senza confronti con quello di prima (un'unione tra due
 * telefoni può cambiare il contenuto di un evento senza cambiare né il numero degli eventi né l'ultimo).
 */
function createStore<T, S>(source: () => Observable<T>, loading: S, ofValue: (value: T) => S, ofError: (error: unknown) => S): Store<S> {
  let snapshot = loading;
  let connection: { stop(): void } | null = null;
  /** L'ultima cosa arrivata dalla sorgente è un errore: la prossima iscrizione riprova da capo. */
  let failed = false;
  const listeners = new Set<() => void>();

  const publish = (next: S) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  function connect() {
    // sul server non c'è archivio: lo stato resta «in caricamento»
    if (typeof indexedDB === "undefined") return;
    connection?.stop();
    failed = false;
    let live = true;
    let subscription: { unsubscribe(): void } | undefined;
    connection = {
      stop() {
        live = false;
        subscription?.unsubscribe();
      },
    };
    const fail = (error: unknown) => {
      if (!live) return;
      failed = true;
      publish(ofError(error ?? new Error("storage_error")));
    };
    try {
      subscription = source().subscribe({
        next: (value) => {
          if (!live) return;
          failed = false;
          publish(ofValue(value));
        },
        error: fail,
      });
    } catch (error) {
      fail(error);
    }
    // fermata mentre si iscriveva
    if (!live) subscription?.unsubscribe();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      // Dopo un errore chi si iscrive di nuovo (la schermata rimontata) fa ripartire la lettura. Lo stato resta
      // l'errore finché l'archivio non risponde: tornare a «in caricamento» farebbe girare in tondo una schermata che
      // monta qualcosa solo quando c'è l'errore.
      if (connection === null || failed) connect();
      return () => {
        // l'iscrizione alla sorgente resta: chi arriva dopo trova i dati già in memoria
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    retry() {
      if (!failed) return false;
      connect();
      return true;
    },
  };
}

/** Il valore di una sorgente in un istante: lo stesso oggetto per tutti finché la sorgente non emette di nuovo. */
export interface SharedSnapshot<V> {
  /** undefined finché la sorgente non ha risposto la prima volta, e dopo un errore. */
  value: V | undefined;
  error: unknown;
}

export interface SharedValue<V> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SharedSnapshot<V>;
  /** Dopo un errore riparte la lettura; `false` se non c'era un errore. */
  retry(): boolean;
}

/** Lo stato prima della prima risposta, uguale per tutte le sorgenti; è anche quello del rendering sul server. */
export const LOADING_VALUE: SharedSnapshot<never> = Object.freeze({ value: undefined, error: undefined });

/**
 * Mette in comune una sorgente dell'archivio che non è il registro (i prodotti letti dal codice a barre).
 * `shape` dà al valore la forma che serve a chi lo legge: gira una volta per emissione, non una per schermata.
 */
export function createSharedValue<T, V>(source: () => Observable<T>, shape: (value: T) => V): SharedValue<V> {
  return createStore<T, SharedSnapshot<V>>(
    source,
    LOADING_VALUE,
    (value) => Object.freeze({ value: freezeShared(shape(value)), error: undefined }),
    (error) => Object.freeze({ value: undefined, error }),
  );
}

/** Lo stato del registro in un istante: lo stesso oggetto per tutti finché non arriva una scrittura. */
export interface LogSnapshot {
  /** undefined finché l'archivio non ha risposto la prima volta. */
  events: readonly AnyEvent[] | undefined;
  error: unknown;
}

export interface SharedLog {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LogSnapshot;
  /** Dopo un errore dell'archivio riparte la lettura («Riprova»); `false` se non c'era un errore. */
  retry(): boolean;
}

/** Lo stato prima della prima risposta dell'archivio; è anche quello del rendering sul server. */
export const LOADING_LOG: LogSnapshot = Object.freeze({ events: undefined, error: undefined });

/** Costruisce il magazzino su una sorgente di eventi (in produzione `liveEvents`; nei test una finta). */
export function createSharedLog(source: () => Observable<AnyEvent[]>): SharedLog {
  return createStore<AnyEvent[], LogSnapshot>(
    source,
    LOADING_LOG,
    (events) => Object.freeze({ events: freezeShared(events), error: undefined }),
    (error) => Object.freeze({ events: undefined, error }),
  );
}

let appLog: SharedLog | undefined;

/** Il magazzino dell'app, creato alla prima richiesta. */
export function sharedLog(): SharedLog {
  appLog ??= createSharedLog(liveEvents);
  return appLog;
}

/** Le derivazioni di un elenco di eventi: ognuna calcolata una volta sola, alla prima richiesta. */
export interface Derived {
  readonly pantry: PantryState;
  readonly diary: DiaryState;
  readonly plan: PlanState;
  readonly recipes: RecipesState;
  readonly preps: PrepState;
}

type Cell = { ok: true; value: unknown } | { ok: false; error: unknown };

class LazyDerived implements Derived {
  private readonly cells = new Map<keyof Derived, Cell>();

  constructor(private readonly events: readonly AnyEvent[]) {}

  /** Un errore resta di questa derivazione (le altre si calcolano lo stesso) e si rilancia uguale a ogni lettura. */
  private read<T>(key: keyof Derived, compute: () => T): T {
    let cell = this.cells.get(key);
    if (cell === undefined) {
      try {
        cell = { ok: true, value: freezeShared(compute()) };
      } catch (error) {
        cell = { ok: false, error };
      }
      this.cells.set(key, cell);
    }
    if (!cell.ok) throw cell.error;
    return cell.value as T;
  }

  get pantry(): PantryState {
    return this.read("pantry", () => derivePantry(this.events));
  }

  get diary(): DiaryState {
    return this.read("diary", () => deriveDiary(this.events));
  }

  get plan(): PlanState {
    return this.read("plan", () => derivePlan(this.events));
  }

  get recipes(): RecipesState {
    return this.read("recipes", () => deriveRecipes(this.events));
  }

  get preps(): PrepState {
    // le preparazioni si appoggiano alla dispensa degli stessi eventi: riceve quella già calcolata invece di rifarla
    return this.read("preps", () => derivePreps(this.events, { pantry: this.pantry }));
  }
}

const derivedByEvents = new WeakMap<readonly AnyEvent[], Derived>();

export function derivedOf(events: readonly AnyEvent[]): Derived {
  let derived = derivedByEvents.get(events);
  if (derived === undefined) {
    derived = new LazyDerived(events);
    derivedByEvents.set(events, derived);
  }
  return derived;
}
