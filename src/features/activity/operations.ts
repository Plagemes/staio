// «Ultime azioni»: il registro letto come elenco di azioni dell'utente, ognuna da annullare o da rifare.
// Un'azione è una chiamata di scrittura: i suoi eventi portano lo stesso `opId`. Gli eventi scritti prima che l'`opId`
// esistesse si tengono insieme per istante; quelli che, per un periodo, hanno ereditato l'`opId` dell'evento da cui
// sono stati riscritti stanno con l'annullamento scritto insieme a loro. Annullare e rifare sono solo eventi `void` nuovi; prima di restituirli si
// derivano dispensa e diario sulla parte di registro che l'azione tocca, per controllare che niente resti a metà.
// Logica pura: gli eventi si restituiscono, li scrive chi chiama.
import { QUICK_CONSUME_NOTE, deriveDiary, familyConsumes, type MealEvent } from "@/core/diary";
import { isKnownEvent, operationIdOf, validateAnyEvent, type AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import {
  derivePantry,
  generateId,
  isPantryEvent,
  sortEvents,
  supersededConsumes,
  voidEvent,
  type ConsumeEvent,
  type DeclareEvent,
  type IdGenerator,
  type LedgerEvent,
  type PantryState,
  type PurchaseEvent,
  type VoidEvent,
} from "@/core/ledger";
// `consumeRoots` non è tra le esportazioni del libro mastro: qui serve per ragionare per famiglie di consumi
import { consumeRoots } from "@/core/ledger/supersede";
import { derivePlan, resolveVoids } from "@/core/plan";
import { PREP_REPAIR_ID_PREFIX } from "@/core/prep";
import { drinkLinkNote } from "../drinks";
import { dayOf, formatCalendarDate, formatTime } from "../format";
import { undoBlockOf } from "../journal";
import { AUTOMATIC_NOTE, legacyBarcodeOfNote } from "../migrations";

export type OperationState =
  /** Vale ancora. */
  | "active"
  /** Annullata per intero da un «Annulla»: si può rifare. */
  | "undone"
  /** Corretta o tolta in parte da un'azione venuta dopo. */
  | "changed";

export interface Operation {
  /** L'id del primo evento. */
  id: string;
  /** `recordedAt` del primo evento. */
  at: string;
  deviceId: string;
  /** Tutti gli eventi dell'azione, annullamenti compresi, in ordine canonico. */
  events: AnyEvent[];
  state: OperationState;
  /**
   * Solo per `undone`: gli annullamenti che «Rifai» annulla. Sono quelli dell'ultimo «Annulla» che l'ha toccata, tutti
   * (anche su altre azioni, se quell'«Annulla» le aveva tolte insieme): ciò che era stato tolto prima resta tolto.
   */
  undoneBy?: VoidEvent[];
  /** Solo per `changed`: quando è stata scritta l'azione più recente che l'ha toccata. */
  changedAt?: string;
}

export type UndoCheck = { ok: true; events: VoidEvent[] } | { ok: false; reason: string };

export interface OperationContext {
  deviceId: string;
  /** Istante corrente, ISO UTC. */
  now: string;
  idGenerator?: IdGenerator;
  /** Per dire l'ora nei motivi e per riconoscere lo stesso momento del giorno. Predefinito: Roma. */
  timeZone?: string;
}

/** Un gruppo di eventi scritti insieme: un'azione, oppure un «Annulla» (solo annullamenti). */
export interface WriteGroup {
  id: string;
  at: string;
  deviceId: string;
  events: AnyEvent[];
}

/**
 * Per gli eventi senza `opId` (scritti da una versione di prima): stanno insieme quelli dello stesso dispositivo
 * registrati a pochi millisecondi dal primo. I costruttori usano un solo istante; `correctLot` e «Correggi» scrivono
 * l'ultimo evento uno o due millisecondi dopo. Una finestra più larga unirebbe due azioni fatte di fila.
 */
const LEGACY_WINDOW_MS = 10;
/**
 * Quanto possono distare tra loro gli eventi di una scrittura. I costruttori usano un solo istante (o uno o due
 * millisecondi dopo): se gli eventi di un `opId` distano di più, o vengono da dispositivi diversi, non sono una
 * scrittura sola, e non si può dire quale sia l'azione: non si annulla da qui. Due azioni vicine hanno `opId` diversi:
 * questa misura non le unisce mai.
 */
const OPERATION_SPAN_MS = 2000;
/** L'inizio della nota che lega un consumo alla sua bevanda (la scrive `drinks.ts`). */
const DRINK_LINK = drinkLinkNote("");

const ALREADY_UNDONE = "È già annullata: se serve, rifalla.";
const NOT_UNDONE = "Non è annullata: non c'è niente da rifare.";
const GONE = "Questa azione non c'è più.";
const NEWER_VERSION = "Viene da una versione più nuova dell'app: non si annulla da qui.";
const ALLERGENS = "Le conferme sugli allergeni non si annullano da qui.";
const REPAIR = "Le riparazioni delle preparazioni si gestiscono da Preparazioni.";
const ADDED_LATER = "Prima togli ciò che hai aggiunto dopo a questo pasto.";
const LINKED_TO_DRINK = "Prima annulla ciò che hai scalato dalla dispensa per questa bevanda.";
const CANNOT_UNDO = "Non riesco ad annullarla da qui.";
const UNSURE_DEVICE = "Questa azione è stata corretta su un altro dispositivo: non si annulla da qui.";
const UNSURE_TIME = "Questa azione è stata corretta in un modo che non riesco a ricostruire: non si annulla da qui.";
const BELOW_ZERO = "Annullarla lascerebbe meno di zero: nel frattempo ne hai mangiato.";
const CANNOT_REDO = "Non riesco a rifarla da qui.";
const REDO_NO_FOOD = "Non si può rifare: l'alimento non c'è più.";
const REDO_NOT_ENOUGH = "Non si può rifare: non ne resta abbastanza.";
const REDO_NO_MEAL = "Non si può rifare: il pasto non c'è più.";
const REDO_NO_DRINK = "Non si può rifare: la bevanda non c'è più.";
const REDO_CHANGED = "Non si può rifare: nel frattempo è stata corretta di nuovo.";
const REDO_ALREADY = "Non si può rifare: l'hai già segnato di nuovo.";
const LOSES_ALLERGEN = "Toglierebbe un allergene o un'esclusione: cambiali dal Piano.";
const RECIPE_IN_PLAN = "La ricetta è usata nel piano.";
const RECIPE_IN_PREP = "La ricetta è usata in una preparazione.";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

interface Group extends WriteGroup {
  atMs: number;
  /** Contiene almeno un evento che non è un annullamento. */
  hasNew: boolean;
  /** Scritto dall'app da sola (una migrazione): non è una riga dell'elenco. */
  automatic: boolean;
  /** Gli eventi sono già stati ordinati e controllati. */
  ready: boolean;
  /**
   * Non si sa se questi eventi siano una scrittura sola: portano un `opId` che compare anche su un altro dispositivo
   * (`device`) o a distanza di tempo (`time`), senza l'annullamento che lo spiegherebbe. Non si annulla e non si rifà.
   */
  unsure?: "device" | "time";
}

interface Analysis {
  size: number;
  byId: Map<string, AnyEvent>;
  msOf: Map<string, number>;
  /** Tutti gli eventi leggibili, per `recordedAt` e poi per `id`. */
  order: AnyEvent[];
  /** I gruppi di scrittura, dal più vecchio. */
  groups: Group[];
  groupById: Map<string, Group>;
  groupOf: Map<string, Group>;
  voids: VoidEvent[];
  /** Bersagli di un annullamento in vigore. */
  voided: Set<string>;
  /** Per bersaglio, gli annullamenti in vigore che lo colpiscono. */
  activeVoids: Map<string, VoidEvent[]>;
  activeVoidIds: Set<string>;
  /** Consumi che nessuno ha annullato ma che non contano: ne vale un altro della stessa famiglia. */
  superseded: Set<string>;
  winnerOf: Map<string, ConsumeEvent>;
  roots: Map<string, string>;
  /** Tutti i consumi di ogni famiglia, annullati compresi. */
  byRoot: Map<string, ConsumeEvent[]>;
  /** Per un evento che vale «finché non ne arriva uno più recente con la stessa chiave»: quello che ora vale al suo posto. */
  newerByKey: Map<string, AnyEvent>;
  /** Tutti gli eventi `meal` di ogni pasto, annullati compresi. */
  mealsById: Map<string, MealEvent[]>;
  liveMeals: Map<string, MealEvent[]>;
  countingByMeal: Map<string, ConsumeEvent[]>;
  /** I consumi che contano e che scalano la dispensa per una bevanda, per id della bevanda. */
  countingByDrink: Map<string, ConsumeEvent[]>;
  /** Gli eventi scritti dall'app da sola. */
  automatic: Set<string>;
  operations: Map<string, Operation | null>;
  touchedBy: Map<string, Group[]>;
  bases: Map<string, AnyEvent | null>;
}

const isVoid = (e: AnyEvent): e is VoidEvent => e.type === "void";
const isConsume = (e: AnyEvent): e is ConsumeEvent => e.type === "consume";
const isMeal = (e: AnyEvent): e is MealEvent => e.type === "meal";
const isCreation = (e: AnyEvent): e is PurchaseEvent | DeclareEvent => e.type === "purchase" || e.type === "declare";
const hasReplaces = (e: AnyEvent): boolean => typeof e.replaces === "string" && e.replaces !== "";

/**
 * Un evento che si può mettere in fila: ha un id, un dispositivo, un tipo e un istante di registrazione leggibile; un
 * annullamento ha il suo bersaglio. La validità completa si controlla dopo, solo dove serve (le righe dell'elenco e la
 * verifica prima di scrivere): l'archivio accetta solo eventi validi, e validarli tutti a ogni lettura costa troppo.
 */
function readable(e: unknown): e is AnyEvent {
  if (!isRecord(e) || typeof e.id !== "string" || e.id === "" || typeof e.deviceId !== "string") return false;
  if (typeof e.type !== "string" || e.type === "" || typeof e.recordedAt !== "string") return false;
  return e.type !== "void" || (typeof e.targetEventId === "string" && e.targetEventId !== "");
}

const soundness = new WeakMap<object, boolean>();
/** Un evento di un tipo noto è valido; uno di un tipo che questa versione non conosce passa (è una riga generica). */
function sound(e: AnyEvent): boolean {
  let ok = soundness.get(e);
  if (ok === undefined) {
    ok = !isKnownEvent(e) || validateAnyEvent(e).length === 0;
    soundness.set(e, ok);
  }
  return ok;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * La chiave degli eventi che non si correggono con un annullamento ma con un evento più recente che li sostituisce
 * (un pasto abituale rinominato, la settimana del piano riscritta). Chi è stato sostituito così è «corretto dopo».
 */
function replaceKey(e: AnyEvent): string | undefined {
  switch (e.type) {
    case "habit":
      return `habit:${e.habitId}`;
    case "mealDeclaration":
      return `declaration:${e.date}|${e.kind}`;
    case "planTargets":
      return `planTargets:${e.dayType}`;
    case "planStructure":
      return "planStructure";
    case "planWeek":
      return `planWeek:${e.weekStart}`;
    case "dayType":
      return `dayType:${e.date}`;
    case "recipe":
      return `recipe:${e.recipeId}`;
    case "dishRating":
      return `dishRating:${e.mealId}`;
    case "experiment":
      return `experiment:${e.experimentId}`;
    case "allergenConfirmation":
      return `allergenConfirmation:${e.key}`;
    default:
      return undefined;
  }
}

/** Un pasto senza voci proprie, nato insieme ai consumi che contiene: vale solo finché ne ha uno. */
function isShell(e: AnyEvent, own: readonly AnyEvent[]): boolean {
  return isMeal(e) && (e.items?.length ?? 0) === 0 && own.some((c) => isConsume(c) && c.mealId === e.mealId);
}

const laterGroup = (x: Group, y: Group): number => x.atMs - y.atMs || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * Che cosa annulla «Rifai»: gli annullamenti in vigore dell'ultimo «Annulla» che ha toccato l'azione. Se annullarli
 * non rimette in vigore niente che si veda (due telefoni l'hanno annullata ciascuno per conto suo; oppure torna solo il
 * pasto vuoto che faceva da contenitore), si aggiunge l'«Annulla» di prima.
 */
function redoVoids(g: Group, undoGroups: ReadonlyMap<Group, VoidEvent[]>, a: Analysis): VoidEvent[] {
  const own = g.events.filter((e) => !isVoid(e));
  const core = own.filter((e) => !isShell(e, own));
  const chosen = new Map<string, VoidEvent>();
  for (const by of [...undoGroups.keys()].sort(laterGroup).reverse()) {
    // un annullamento scritto nello stesso gruppo del suo bersaglio conta da solo: il resto del gruppo è l'azione
    const voids = by === g ? (undoGroups.get(by) as VoidEvent[]) : by.events.filter((v): v is VoidEvent => isVoid(v) && a.activeVoidIds.has(v.id));
    for (const v of voids) chosen.set(v.id, v);
    const back = core.some((e) => {
      const holding = a.activeVoids.get(e.id);
      return holding !== undefined && holding.every((v) => chosen.has(v.id));
    });
    if (back) break;
  }
  return sortEvents([...chosen.values()]);
}

function stateOf(g: Group, a: Analysis): { state: OperationState; touchedBy: Group[]; undoneBy?: VoidEvent[]; changedAt?: string } {
  const own = g.events.filter((e) => !isVoid(e));
  const touchers = new Set<Group>();
  const gone = new Set<string>();
  const undoGroups = new Map<Group, VoidEvent[]>();
  let corrected = false;

  for (const e of g.events) {
    const voids = a.activeVoids.get(e.id) ?? [];
    if (voids.length > 0) {
      gone.add(e.id);
      for (const v of voids) {
        const by = a.groupOf.get(v.id) as Group;
        if (by !== g) touchers.add(by);
        if (by !== g && by.hasNew) corrected = true;
        else push(undoGroups, by, v);
      }
      continue;
    }
    if (isVoid(e)) continue;
    const replacedBy = a.winnerOf.get(e.id) ?? a.newerByKey.get(e.id);
    const by = replacedBy ? a.groupOf.get(replacedBy.id) : undefined;
    if (by && by !== g) {
      corrected = true;
      touchers.add(by);
    }
  }

  const core = own.filter((e) => !isShell(e, own));
  const touchedBy = [...touchers].sort(laterGroup);
  const changedAt = touchedBy[touchedBy.length - 1]?.at;
  let state: OperationState = "active";
  if (corrected) state = "changed";
  else if (core.length > 0 && core.every((e) => gone.has(e.id))) state = "undone";
  else if (own.some((e) => gone.has(e.id))) state = "changed";

  return {
    state,
    touchedBy,
    ...(state === "undone" ? { undoneBy: redoVoids(g, undoGroups, a) } : {}),
    ...(state === "changed" && changedAt !== undefined ? { changedAt } : {}),
  };
}

/** Un `updateLot` che mette solo il codice a barre scritto nella nota dell'ingresso: la migrazione di prima del segno. */
function isLegacyMigration(e: AnyEvent, creations: ReadonlyMap<string, (PurchaseEvent | DeclareEvent)[]>): boolean {
  if (e.type !== "updateLot" || !isRecord(e.patch)) return false;
  const keys = Object.keys(e.patch);
  if (keys.length !== 1 || keys[0] !== "barcode" || typeof e.patch.barcode !== "string") return false;
  return (creations.get(e.lotId) ?? []).some((c) => legacyBarcodeOfNote(c.note) === e.patch.barcode);
}

/** Il primo indice di `events` (in ordine di tempo) registrato non prima di `from`. */
function firstFrom(events: readonly AnyEvent[], from: number, ms: (e: AnyEvent) => number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ms(events[mid]) < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cache = new WeakMap<readonly unknown[], Analysis>();

function analyze(log: readonly AnyEvent[]): Analysis {
  const hit = cache.get(log);
  if (hit && hit.size === log.length) return hit;

  const byId = new Map<string, AnyEvent>();
  const msOf = new Map<string, number>();
  for (const e of log as readonly unknown[]) {
    if (!readable(e) || byId.has(e.id)) continue;
    const ms = Date.parse(e.recordedAt);
    if (Number.isNaN(ms)) continue;
    byId.set(e.id, e);
    msOf.set(e.id, ms);
  }
  const ms = (e: AnyEvent): number => msOf.get(e.id) as number;
  const order = [...byId.values()].sort((x, y) => ms(x) - ms(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const groups: Group[] = [];
  const groupOf = new Map<string, Group>();
  const groupById = new Map<string, Group>();
  const start = (e: AnyEvent, at: number): Group => {
    const g: Group = { id: e.id, at: e.recordedAt, atMs: at, deviceId: e.deviceId, events: [], hasNew: false, automatic: false, ready: false };
    groups.push(g);
    groupById.set(g.id, g);
    return g;
  };
  const join = (g: Group, e: AnyEvent): void => {
    g.events.push(e);
    if (!isVoid(e)) g.hasNew = true;
    groupOf.set(e.id, g);
  };

  // per gli eventi senza `opId`, un gruppo aperto per dispositivo: quelli dell'altro telefono, in mezzo, non lo spezzano
  const open = new Map<string, Group>();
  /** Gli eventi di ogni `opId`, in ordine di tempo. */
  const byOperation = new Map<string, AnyEvent[]>();
  for (const e of order) {
    const opId = operationIdOf(e);
    if (opId !== undefined) {
      push(byOperation, opId, e);
      continue;
    }
    const at = ms(e);
    let g = open.get(e.deviceId);
    if (!g || at - g.atMs > LEGACY_WINDOW_MS) open.set(e.deviceId, (g = start(e, at)));
    join(g, e);
  }

  // Per un periodo un evento riscritto da uno di prima ne ha ereditato l'`opId` (quei registri non si riscrivono). Una
  // copia così è nata sempre insieme all'annullamento dell'evento da cui è stata copiata, e l'annullamento ha l'`opId`
  // giusto. Quindi è ereditato l'evento per cui lo stesso dispositivo, nello stesso istante, ha scritto un annullamento
  // con un altro `opId` che colpisce un evento con il suo stesso `opId`: sta con quell'annullamento, e l'originale è
  // l'evento colpito. Non dipende dall'ordine degli eventi né dagli orologi dei due telefoni.
  const writtenWith = new Map<string, VoidEvent>();
  for (const [opId, members] of byOperation) {
    for (const v of members) {
      if (!isVoid(v)) continue;
      const target = byId.get(v.targetEventId);
      const theirs = target ? operationIdOf(target) : undefined;
      if (theirs === undefined || theirs === opId) continue;
      const others = byOperation.get(theirs) as AnyEvent[];
      const at = ms(v);
      for (let i = firstFrom(others, at - LEGACY_WINDOW_MS, ms); i < others.length && ms(others[i]) <= at + LEGACY_WINDOW_MS; i++) {
        const e = others[i];
        if (e === target || isVoid(e) || e.deviceId !== v.deviceId) continue;
        const known = writtenWith.get(e.id);
        // tra più annullamenti, il più vicino; a pari distanza il primo per `id`
        const closer = known === undefined || Math.abs(ms(known) - ms(e)) > Math.abs(at - ms(e)) || (Math.abs(ms(known) - ms(e)) === Math.abs(at - ms(e)) && v.id < known.id);
        if (closer) writtenWith.set(e.id, v);
      }
    }
  }

  // Ciò che resta di un `opId` è una scrittura sola se viene da un dispositivo e sta in poco tempo. Se no (una copia
  // arrivata senza il suo annullamento, orologi incoerenti) non si indovina: ogni pezzo è una riga, ma non si annulla.
  for (const members of byOperation.values()) {
    const own = members.filter((e) => !writtenWith.has(e.id));
    if (own.length === 0) continue;
    const first = own[0];
    const oneDevice = own.every((e) => e.deviceId === first.deviceId);
    if (oneDevice && ms(own[own.length - 1]) - ms(first) < OPERATION_SPAN_MS) {
      const g = start(first, ms(first));
      for (const e of own) join(g, e);
      continue;
    }
    const pieces = new Map<string, Group>();
    for (const e of own) {
      const at = ms(e);
      let g = pieces.get(e.deviceId);
      if (!g || at - g.atMs >= OPERATION_SPAN_MS) {
        g = start(e, at);
        g.unsure = oneDevice ? "time" : "device";
        pieces.set(e.deviceId, g);
      }
      join(g, e);
    }
  }
  for (const [id, v] of writtenWith) join(groupOf.get(v.id) as Group, byId.get(id) as AnyEvent);
  groups.sort(laterGroup);

  const voids: VoidEvent[] = [];
  const consumes: ConsumeEvent[] = [];
  const creations = new Map<string, (PurchaseEvent | DeclareEvent)[]>();
  for (const e of order) {
    if (isVoid(e)) voids.push(e);
    else if (isConsume(e)) consumes.push(e);
    else if (isCreation(e)) push(creations, e.lotId, e);
  }

  const resolved = resolveVoids(
    voids.map((v) => ({ id: v.id, targetEventId: v.targetEventId })),
    new Set(byId.keys()),
  );
  const cyclic = new Set(resolved.findings.filter((f) => f.code === "void_cycle").map((f) => f.eventId));
  const voided = resolved.voided;
  const activeVoids = new Map<string, VoidEvent[]>();
  const activeVoidIds = new Set<string>();
  for (const v of voids) {
    if (cyclic.has(v.id) || voided.has(v.id)) continue;
    push(activeVoids, v.targetEventId, v);
    activeVoidIds.add(v.id);
  }

  // Le famiglie si calcolano sui soli consumi, più ciò che citano e che un consumo non è: per il nucleo un consumo che
  // cita un acquisto è capostipite di se stesso, e senza l'acquisto sembrerebbe citare un consumo non ancora arrivato.
  const cited: AnyEvent[] = [];
  for (const c of consumes) {
    const target = hasReplaces(c) ? byId.get(c.replaces as string) : undefined;
    if (target && !isConsume(target)) cited.push(target);
  }
  const family = [...consumes, ...cited];
  const superseded = supersededConsumes(family, voided);
  const roots = consumeRoots(family);
  const byRoot = new Map<string, ConsumeEvent[]>();
  for (const c of consumes) push(byRoot, roots.get(c.id) ?? c.id, c);
  const winnerOf = new Map<string, ConsumeEvent>();
  if (superseded.size > 0) {
    for (const members of byRoot.values()) {
      const winner = members.find((c) => !voided.has(c.id) && !superseded.has(c.id));
      if (winner) for (const c of members) if (superseded.has(c.id)) winnerOf.set(c.id, winner);
    }
  }

  const newestOfKey = new Map<string, AnyEvent>();
  const keyed: [AnyEvent, string][] = [];
  const mealsById = new Map<string, MealEvent[]>();
  const liveMeals = new Map<string, MealEvent[]>();
  const countingByMeal = new Map<string, ConsumeEvent[]>();
  const countingByDrink = new Map<string, ConsumeEvent[]>();
  for (const e of order) {
    if (isVoid(e)) continue;
    if (isMeal(e)) push(mealsById, e.mealId, e);
    if (voided.has(e.id)) continue;
    if (isMeal(e)) push(liveMeals, e.mealId, e);
    else if (isConsume(e)) {
      if (superseded.has(e.id)) continue;
      if (typeof e.mealId === "string" && e.mealId !== "") push(countingByMeal, e.mealId, e);
      if (typeof e.note === "string" && e.note.startsWith(DRINK_LINK)) push(countingByDrink, e.note.slice(DRINK_LINK.length), e);
    } else {
      const key = replaceKey(e);
      if (key === undefined) continue;
      keyed.push([e, key]);
      // `order` è già per `recordedAt` e poi `id`: l'ultimo incontrato è il più recente
      newestOfKey.set(key, e);
    }
  }
  const newerByKey = new Map<string, AnyEvent>();
  for (const [e, key] of keyed) {
    const newest = newestOfKey.get(key);
    if (newest && newest !== e) newerByKey.set(e.id, newest);
  }

  const automatic = new Set<string>();
  for (const g of groups) {
    if (!g.hasNew) continue;
    g.automatic = g.events.every((e) => isVoid(e) || e.note === AUTOMATIC_NOTE || isLegacyMigration(e, creations));
    if (g.automatic) for (const e of g.events) automatic.add(e.id);
  }

  const out: Analysis = {
    size: log.length,
    byId,
    msOf,
    order,
    groups,
    groupById,
    groupOf,
    voids,
    voided,
    activeVoids,
    activeVoidIds,
    superseded,
    winnerOf,
    roots,
    byRoot,
    newerByKey,
    mealsById,
    liveMeals,
    countingByMeal,
    countingByDrink,
    automatic,
    operations: new Map(),
    touchedBy: new Map(),
    bases: new Map(),
  };
  cache.set(log, out);
  return out;
}

/**
 * L'operazione di un gruppo, se è una riga dell'elenco: ha almeno un evento valido che non sia un annullamento, e non
 * l'ha scritta l'app da sola. Si costruisce la prima volta che serve: per l'elenco, solo quelle degli ultimi giorni.
 */
function operationOf(g: Group | undefined, a: Analysis): Operation | undefined {
  if (!g || !g.hasNew || g.automatic) return undefined;
  const known = a.operations.get(g.id);
  if (known !== undefined) return known ?? undefined;
  if (!g.ready) {
    g.events = sortEvents(g.events.filter(sound));
    g.ready = true;
  }
  if (!g.events.some((e) => !isVoid(e))) {
    a.operations.set(g.id, null);
    return undefined;
  }
  const { touchedBy, ...rest } = stateOf(g, a);
  const op: Operation = { id: g.id, at: g.at, deviceId: g.deviceId, events: g.events, ...rest };
  a.operations.set(g.id, op);
  a.touchedBy.set(g.id, touchedBy);
  return op;
}

/** Tutti i gruppi di scrittura del registro, dal più vecchio, compresi quelli di soli annullamenti (che non sono righe). */
export function groupWrites(log: readonly AnyEvent[]): WriteGroup[] {
  return analyze(log).groups.map((g) => ({ id: g.id, at: g.at, deviceId: g.deviceId, events: sortEvents(g.events) }));
}

/** Le operazioni con almeno un evento che non sia un annullamento, dalla più recente, da `since` (ISO) in poi. */
export function groupOperations(log: readonly AnyEvent[], options: { since: string }): Operation[] {
  const a = analyze(log);
  const since = Date.parse(options.since);
  const out: Operation[] = [];
  // i gruppi sono in ordine di tempo: si parte dal fondo e ci si ferma al primo più vecchio di `since`
  for (let i = a.groups.length - 1; i >= 0; i--) {
    const g = a.groups[i];
    if (!Number.isNaN(since) && g.atMs < since) break;
    const op = operationOf(g, a);
    if (op) out.push(op);
  }
  return out.sort((x, y) => (a.msOf.get(y.id) as number) - (a.msOf.get(x.id) as number) || (x.id < y.id ? 1 : -1));
}

const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** L'ora di un'azione e, se non è di oggi, il suo giorno («16 nov 2026»). */
function whenOf(at: string, ctx: Pick<OperationContext, "now" | "timeZone">): { time: string; day?: string } {
  const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const day = dayOf(at, tz);
  return { time: formatTime(at, tz), ...(day === dayOf(ctx.now, tz) ? {} : { day: formatCalendarDate(day) }) };
}

function changedReason(op: Operation, a: Analysis, ctx: Pick<OperationContext, "now" | "timeZone">): string {
  const latest = (id: string): Group | undefined => {
    const touchers = a.touchedBy.get(id) ?? [];
    return touchers[touchers.length - 1];
  };
  let last = latest(op.id);
  if (!last) return CANNOT_UNDO;
  // Se anche la correzione è stata corretta, si indica l'ultima della catena: è quella da annullare per prima.
  const seen = new Set<string>([op.id]);
  while (last.hasNew && operationOf(last, a)?.state === "changed" && !seen.has(last.id)) {
    seen.add(last.id);
    const next = latest(last.id);
    if (!next || !next.hasNew) break;
    last = next;
  }
  const { time, day } = whenOf(last.at, ctx);
  if (last.hasNew) return `È stata corretta dopo: annulla prima la correzione ${day ? `del ${day}, alle ${time}` : `delle ${time}`}.`;
  return `Ne è stata tolta una parte dopo, ${day ? `il ${day} alle ${time}` : `alle ${time}`}: non si annulla più da qui.`;
}

/**
 * Perché un'operazione non si tocca: non si sa se i suoi eventi siano una scrittura sola, oppure il suo ultimo
 * «Annulla» è in un gruppo così. Annullarla o rifarla potrebbe valere per metà di un'azione, o per due insieme.
 */
function unsureReason(op: Operation, a: Analysis): string | undefined {
  const reason = (g: Group | undefined): string | undefined => (g?.unsure === "device" ? UNSURE_DEVICE : g?.unsure === "time" ? UNSURE_TIME : undefined);
  const own = reason(a.groupById.get(op.id));
  if (own) return own;
  for (const v of op.undoneBy ?? []) {
    const by = reason(a.groupOf.get(v.id));
    if (by) return by;
  }
  return undefined;
}

/** L'evento in fondo a una catena di annullamenti: quello che, alla fine, torna o smette di valere. */
function baseOf(id: string, a: Analysis): AnyEvent | undefined {
  const known = a.bases.get(id);
  if (known !== undefined) return known ?? undefined;
  const seen = new Set<string>();
  let cur = a.byId.get(id);
  while (cur && isVoid(cur) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = a.byId.get(cur.targetEventId);
  }
  const base = cur && !isVoid(cur) ? cur : undefined;
  a.bases.set(id, base ?? null);
  return base;
}

/** L'evento che un annullamento dell'elenco rimetterebbe in vigore, se nessun altro annullamento lo tiene annullato. */
function restoredBy(v: AnyEvent, targets: ReadonlyMap<string, AnyEvent>, a: Analysis): AnyEvent | undefined {
  if (!isVoid(v)) return undefined;
  const target = a.byId.get(v.targetEventId);
  if (!target) return undefined;
  return (a.activeVoids.get(target.id) ?? []).every((x) => targets.has(x.id)) ? target : undefined;
}

/** Dopo l'annullamento resta in vigore un evento `meal` con questo `mealId`: un altro, o quello che torna. */
function mealStays(mealId: string, targets: ReadonlyMap<string, AnyEvent>, a: Analysis): boolean {
  if ((a.liveMeals.get(mealId) ?? []).some((m) => !targets.has(m.id))) return true;
  for (const v of targets.values()) {
    const back = restoredBy(v, targets, a);
    if (back && isMeal(back) && back.mealId === mealId) return true;
  }
  return false;
}

/** L'annullamento rimette in vigore un altro ingresso dello stesso alimento (una quantità d'ingresso corretta). */
function lotStays(lotId: string, targets: ReadonlyMap<string, AnyEvent>, a: Analysis): boolean {
  for (const v of targets.values()) {
    const back = restoredBy(v, targets, a);
    if (back && isCreation(back) && back.lotId === lotId) return true;
  }
  return false;
}

/** Ciò che da «Ultime azioni» non si tocca mai, nemmeno attraverso una catena di annullamenti. */
function untouchable(ids: Iterable<string>, a: Analysis): string | undefined {
  for (const id of ids) {
    const base = baseOf(id, a);
    if (!base) continue;
    if (!isKnownEvent(base)) return NEWER_VERSION;
    // una conferma che torna valida allargherebbe il controllo degli allergeni senza che nessuno la riveda
    if (base.type === "allergenConfirmation") return ALLERGENS;
    if (isConsume(base) && base.id.startsWith(PREP_REPAIR_ID_PREFIX)) return REPAIR;
  }
  return undefined;
}

/**
 * Che cosa annullare per riportare tutto a prima dell'operazione, o perché non si può. Sono gli eventi dell'operazione
 * non ancora annullati (annullamenti compresi) più, per ogni consumo nato qui, tutta la sua famiglia ancora valida: un
 * sostituto scritto da un altro telefono tornerebbe a contare da solo.
 */
function undoTargets(
  op: Operation,
  a: Analysis,
  pantry: PantryState,
  ctx: Pick<OperationContext, "now" | "timeZone">,
): { ok: true; targets: Map<string, AnyEvent> } | { ok: false; reason: string } {
  const unsure = unsureReason(op, a);
  if (unsure) return no(unsure);
  if (op.state === "undone") return no(ALREADY_UNDONE);
  if (op.state === "changed") return no(changedReason(op, a, ctx));
  if (op.events.some((e) => !isKnownEvent(e))) return no(NEWER_VERSION);

  const targets = new Map<string, AnyEvent>();
  for (const e of op.events) if (!a.voided.has(e.id)) targets.set(e.id, e);
  for (const e of op.events) {
    if (!isConsume(e) || a.voided.has(e.id) || hasReplaces(e)) continue;
    for (const c of a.byRoot.get(a.roots.get(e.id) ?? e.id) ?? []) if (!a.voided.has(c.id)) targets.set(c.id, c);
  }
  // ciò che l'app ha scritto da sola su un alimento segue il suo ingresso: da solo resterebbe senza alimento
  for (const e of op.events) {
    if (!isCreation(e) || !targets.has(e.id)) continue;
    for (const h of pantry.lots.find((l) => l.lotId === e.lotId)?.history ?? []) {
      const extra = a.automatic.has(h.eventId) ? a.byId.get(h.eventId) : undefined;
      if (extra && !a.voided.has(extra.id)) targets.set(extra.id, extra);
    }
  }
  const blocked = untouchable(targets.keys(), a);
  if (blocked) return no(blocked);

  const own = op.events.filter((e) => !isVoid(e));
  for (const m of [...targets.values()]) {
    if (!isMeal(m)) continue;
    const others = (a.countingByMeal.get(m.mealId) ?? []).filter((c) => !targets.has(c.id));
    if (others.length === 0 || mealStays(m.mealId, targets, a)) continue;
    // Il pasto nato da un «Mangiato» è solo il contenitore del suo momento: se dopo vi è finito altro resta, e si
    // toglie soltanto ciò che questo tocco ha segnato (come `undoPlacement`). Un pasto registrato non si spezza.
    const quick = isShell(m, own) && own.every((c) => !isConsume(c) || c.mealId !== m.mealId || c.note === QUICK_CONSUME_NOTE);
    if (!quick) return no(ADDED_LATER);
    targets.delete(m.id);
  }

  // una bevanda annullata lascerebbe scalata la dispensa senza che il diario dica perché
  for (const d of targets.values()) {
    if (d.type === "drink" && (a.countingByDrink.get(d.id) ?? []).some((c) => !targets.has(c.id))) return no(LINKED_TO_DRINK);
  }

  const together = new Set(targets.keys());
  for (const e of targets.values()) {
    if (isVoid(e) || !isPantryEvent(e)) continue;
    if (isCreation(e) && lotStays(e.lotId, targets, a)) continue;
    const reason = undoBlockOf(e as LedgerEvent, pantry, together);
    if (reason) return no(reason);
  }
  if (targets.size === 0) return no(CANNOT_UNDO);
  return { ok: true, targets };
}

function redoBlock(op: Operation, a: Analysis): string | undefined {
  const unsure = unsureReason(op, a);
  if (unsure) return unsure;
  if (op.state !== "undone") return NOT_UNDONE;
  if (op.events.some((e) => !isKnownEvent(e))) return NEWER_VERSION;
  const voids = op.undoneBy ?? [];
  if (voids.length === 0) return CANNOT_REDO;
  return untouchable(voids.map((v) => v.id), a);
}

/**
 * Perché la riga non può avere il suo comando («Annulla» se vale ancora, «Rifai» se è annullata), senza la verifica
 * finale sulle derivazioni: serve a disegnare l'elenco. `undefined` se il comando si può mostrare; `undoOperation` e
 * `redoOperation` fanno poi il controllo completo.
 */
export function commandBlock(
  op: Operation,
  log: readonly AnyEvent[],
  pantry: PantryState,
  ctx: Pick<OperationContext, "now" | "timeZone">,
): string | undefined {
  const a = analyze(log);
  const cur = operationOf(a.groupById.get(op.id), a);
  if (!cur) return GONE;
  if (cur.state === "undone") return redoBlock(cur, a);
  const plan = undoTargets(cur, a, pantry, ctx);
  return plan.ok ? undefined : plan.reason;
}

type AnomalyLike = { code: string; eventId?: string; lotId?: string; targetEventId?: string; mealId?: string; eventType?: string };
const anomalyKey = (x: AnomalyLike): string => [x.code, x.eventId ?? "", x.lotId ?? "", x.targetEventId ?? "", x.mealId ?? "", x.eventType ?? ""].join("\u0000");

/** Le anomalie che prima non c'erano (con molteplicità: la stessa due volte è nuova una volta). */
function newAnomalies<T extends AnomalyLike>(before: readonly T[], after: readonly T[]): T[] {
  const left = new Map<string, number>();
  for (const x of before) left.set(anomalyKey(x), (left.get(anomalyKey(x)) ?? 0) + 1);
  const out: T[] = [];
  for (const x of after) {
    const n = left.get(anomalyKey(x)) ?? 0;
    if (n > 0) left.set(anomalyKey(x), n - 1);
    else out.push(x);
  }
  return out;
}

/** I consumi che contano ma non hanno più ciò a cui sono legati: il pasto del loro `mealId`, o la loro bevanda. */
function orphanConsumes(a: Analysis): Map<string, "meal" | "drink"> {
  const out = new Map<string, "meal" | "drink">();
  for (const [mealId, consumes] of a.countingByMeal) {
    if ((a.liveMeals.get(mealId)?.length ?? 0) === 0) for (const c of consumes) out.set(c.id, "meal");
  }
  for (const [drinkId, consumes] of a.countingByDrink) {
    // una bevanda non ancora arrivata dall'altro telefono non è una bevanda tolta
    if (a.byId.has(drinkId) && a.voided.has(drinkId)) for (const c of consumes) out.set(c.id, "drink");
  }
  return out;
}

const fold = (s: string): string => s.trim().toLowerCase();

/** Allergeni ed esclusioni dichiarati nel piano: annullare o rifare non deve mai toglierne uno senza dirlo. */
function declaredLimits(events: readonly AnyEvent[]): Set<string> {
  const structure = derivePlan(events).structure;
  return new Set([...(structure?.allergens ?? []).map((x) => `a:${fold(x)}`), ...(structure?.excludedFoods ?? []).map((x) => `e:${fold(x)}`)]);
}

interface Scope {
  /** La parte di registro da cui dipende ciò che gli annullamenti nuovi toccano, in ordine. */
  events: AnyEvent[];
  /** Gli eventi che tornano o smettono di valere. */
  bases: AnyEvent[];
}

/**
 * La parte di registro che basta a verificare un annullamento: tutti gli eventi degli alimenti e dei pasti toccati, le
 * famiglie dei consumi toccati, ciò che vale «per chiave» insieme a loro, le bevande legate, e ogni annullamento che
 * alla fine cade su uno di questi. Dispensa e diario si derivano per alimento e per pasto: su questa parte danno, per
 * ciò che è toccato, lo stesso risultato che sul registro intero, senza rifare i conti di anni di eventi.
 */
function scopeOf(targetIds: Iterable<string>, a: Analysis): Scope {
  const bases = new Map<string, AnyEvent>();
  for (const id of targetIds) {
    const base = baseOf(id, a);
    if (base) bases.set(base.id, base);
  }

  const ids = new Set<string>(bases.keys());
  const lots = new Set<string>();
  const meals = new Set<string>();
  const keys = new Set<string>();
  const drinks = new Set<string>();
  let recipes = false;
  const mark = (e: AnyEvent): void => {
    const rec = e as { lotId?: unknown; mealId?: unknown };
    if (typeof rec.lotId === "string" && rec.lotId !== "") lots.add(rec.lotId);
    if (typeof rec.mealId === "string" && rec.mealId !== "") meals.add(rec.mealId);
  };
  for (const b of bases.values()) {
    mark(b);
    const key = replaceKey(b);
    if (key !== undefined) keys.add(key);
    if (b.type === "drink") drinks.add(b.id);
    if (b.type === "recipe") recipes = true;
    if (isConsume(b)) {
      if (typeof b.note === "string" && b.note.startsWith(DRINK_LINK)) drinks.add(b.note.slice(DRINK_LINK.length));
      for (const c of a.byRoot.get(a.roots.get(b.id) ?? b.id) ?? []) {
        ids.add(c.id);
        mark(c);
      }
    }
  }

  const chosen = new Set<string>();
  for (const e of a.order) {
    if (isVoid(e)) continue;
    const rec = e as { lotId?: unknown; mealId?: unknown; note?: unknown };
    const key = keys.size > 0 ? replaceKey(e) : undefined;
    if (
      ids.has(e.id) ||
      (typeof rec.lotId === "string" && lots.has(rec.lotId)) ||
      (typeof rec.mealId === "string" && meals.has(rec.mealId)) ||
      (key !== undefined && keys.has(key)) ||
      (drinks.size > 0 && (drinks.has(e.id) || (typeof rec.note === "string" && rec.note.startsWith(DRINK_LINK) && drinks.has(rec.note.slice(DRINK_LINK.length))))) ||
      (recipes && (e.type === "planWeek" || e.type === "prep"))
    ) {
      chosen.add(e.id);
    }
  }
  for (const v of a.voids) {
    const base = baseOf(v.id, a);
    if (base && chosen.has(base.id)) chosen.add(v.id);
  }
  return { events: a.order.filter((e) => chosen.has(e.id)), bases: [...bases.values()] };
}

/** Il momento di un consumo: il giorno e il tipo del suo pasto. Senza pasto, il suo istante. */
function slotOf(c: ConsumeEvent, a: Analysis, timeZone: string): string {
  const versions = c.mealId ? a.mealsById.get(c.mealId) : undefined;
  const meal = versions?.[versions.length - 1];
  return meal ? `${dayOf(meal.at, timeZone)}|${meal.kind}` : `@${c.at}`;
}

/**
 * La verifica prima di restituire, sulla parte di registro toccata: con gli annullamenti nuovi non devono nascere
 * anomalie né consumi senza pasto o senza bevanda, né sparire allergeni dichiarati o ricette ancora usate; e ciò che
 * si rifà deve tornare a contare, una volta sola. `undefined` se va tutto bene.
 */
function verify(scope: Scope, a: Analysis, added: readonly VoidEvent[], kind: "undo" | "redo", op: Operation, ctx: OperationContext): string | undefined {
  const generic = kind === "undo" ? CANNOT_UNDO : CANNOT_REDO;
  const before = scope.events;
  const after = [...before, ...added];
  if (scope.bases.some((e) => !sound(e))) return generic;

  const pantryAfter = derivePantry(after);
  const pantryNew = newAnomalies(derivePantry(before).anomalies, pantryAfter.anomalies);
  if (pantryNew.length > 0 || pantryAfter.lots.some((l) => l.remaining < 0)) {
    const only = (code: string): boolean => pantryNew.length > 0 && pantryNew.every((x) => x.code === code);
    if (kind === "undo") return only("over_consumption") ? BELOW_ZERO : generic;
    if (only("over_consumption")) return REDO_NOT_ENOUGH;
    return pantryNew.length > 0 && pantryNew.every((x) => x.code === "unknown_lot" || x.code === "over_consumption") ? REDO_NO_FOOD : generic;
  }

  if (newAnomalies(deriveDiary(before).anomalies, deriveDiary(after).anomalies).length > 0) return generic;

  const sa = analyze(before);
  const sb = analyze(after);
  const orphansBefore = orphanConsumes(sa);
  for (const [id, what] of orphanConsumes(sb)) {
    if (orphansBefore.has(id)) continue;
    if (what === "drink") return kind === "redo" ? REDO_NO_DRINK : LINKED_TO_DRINK;
    return kind === "redo" ? REDO_NO_MEAL : ADDED_LATER;
  }

  if (scope.bases.some((e) => e.type === "planStructure")) {
    const limits = declaredLimits(after);
    for (const x of declaredLimits(before)) if (!limits.has(x)) return LOSES_ALLERGEN;
  }

  // una ricetta che resterebbe senza nessuna versione, mentre il piano o una preparazione la citano ancora
  const recipeIds = new Set(scope.bases.flatMap((e) => (e.type === "recipe" ? [e.recipeId] : [])));
  for (const recipeId of recipeIds) {
    const versions = before.filter((e) => e.type === "recipe" && e.recipeId === recipeId);
    if (!versions.some((e) => !sa.voided.has(e.id)) || versions.some((e) => !sb.voided.has(e.id))) continue;
    for (const e of after) {
      if (sb.voided.has(e.id)) continue;
      if (e.type === "planWeek" && !sb.newerByKey.has(e.id) && e.entries.some((x) => x.item.kind === "recipe" && x.item.recipeId === recipeId)) return RECIPE_IN_PLAN;
      if (e.type === "prep" && e.recipeId === recipeId) return RECIPE_IN_PREP;
    }
  }

  if (kind === "redo") {
    const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;
    const undoneAt = Math.max(...added.map((v) => a.groupOf.get(v.targetEventId)?.atMs ?? Number.NEGATIVE_INFINITY));
    const own = new Set(op.events.map((e) => e.id));
    for (const e of scope.bases) {
      if (sb.voided.has(e.id)) continue;
      // ciò che si rifà deve tornare a valere davvero: non coperto da una correzione venuta dopo
      const covering = own.has(e.id) ? (sb.winnerOf.get(e.id) ?? sb.newerByKey.get(e.id)) : undefined;
      // (i gruppi sono quelli del registro intero: su una sua parte le scritture non si riconoscono allo stesso modo)
      if (covering && a.groupOf.get(covering.id) !== a.groupOf.get(e.id)) return REDO_CHANGED;
      // e non una seconda volta: dopo l'annullamento lo stesso consumo è stato segnato di nuovo a mano
      if (!isConsume(e) || !sa.voided.has(e.id)) continue;
      const slot = slotOf(e, a, timeZone);
      const again = after.some(
        (d) =>
          isConsume(d) &&
          d.id !== e.id &&
          d.lotId === e.lotId &&
          !sb.voided.has(d.id) &&
          !sb.superseded.has(d.id) &&
          d.quantity.unit === e.quantity.unit &&
          d.quantity.value === e.quantity.value &&
          (sb.msOf.get(d.id) as number) > undoneAt &&
          sb.roots.get(d.id) !== sb.roots.get(e.id) &&
          (d.mealId === e.mealId || slotOf(d, a, timeZone) === slot),
      );
      if (again) return REDO_ALREADY;
    }
  }
  return undefined;
}

const factory = (ctx: OperationContext) => ({ idGenerator: ctx.idGenerator ?? generateId, now: () => ctx.now, deviceId: ctx.deviceId });

/**
 * Gli annullamenti che riportano tutto a prima dell'operazione; oppure perché non si può. `pantry` è la dispensa
 * derivata da questo stesso registro.
 */
export function undoOperation(op: Operation, log: readonly AnyEvent[], pantry: PantryState, ctx: OperationContext): UndoCheck {
  const a = analyze(log);
  const cur = operationOf(a.groupById.get(op.id), a);
  if (!cur) return no(GONE);
  const plan = undoTargets(cur, a, pantry, ctx);
  if (!plan.ok) return plan;

  const targets = plan.targets;
  const scope = scopeOf(targets.keys(), a);
  // la regola del nucleo per le famiglie: deve dare gli stessi consumi già messi in elenco
  const born = cur.events.filter((e): e is ConsumeEvent => isConsume(e) && targets.has(e.id) && !hasReplaces(e));
  if (born.length > 0) for (const c of familyConsumes(scope.events, born)) if (!targets.has(c.id)) targets.set(c.id, c as AnyEvent);

  const f = factory(ctx);
  const events = sortEvents([...targets.values()]).map((t) => voidEvent(t, f));
  const problem = verify(scope, a, events, "undo", cur, ctx);
  return problem ? no(problem) : { ok: true, events };
}

/**
 * Rifà un'operazione annullata: annulla gli annullamenti dell'ultimo «Annulla» che l'ha toccata, e riporta così tutto
 * a com'era subito prima di quell'«Annulla». `pantry` è la dispensa derivata da questo stesso registro.
 */
export function redoOperation(op: Operation, log: readonly AnyEvent[], pantry: PantryState, ctx: OperationContext): UndoCheck {
  void pantry;
  const a = analyze(log);
  const cur = operationOf(a.groupById.get(op.id), a);
  if (!cur) return no(GONE);
  const blocked = redoBlock(cur, a);
  if (blocked) return no(blocked);

  const voids = cur.undoneBy ?? [];
  const f = factory(ctx);
  const events = voids.map((v) => voidEvent(v, f));
  const problem = verify(scopeOf(voids.map((v) => v.id), a), a, events, "redo", cur, ctx);
  return problem ? no(problem) : { ok: true, events };
}
