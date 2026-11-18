import "fake-indexeddb/auto";
import type { Observable } from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDiary } from "@/core/diary";
import { drink, meal, water } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { mixedLog } from "@/core/events/test-helpers";
import { derivePantry, sortEvents, type LedgerEvent } from "@/core/ledger";
import { consume, purchase, q, seededRandom, shuffled } from "@/core/ledger/test-helpers";
import { derivePlan } from "@/core/plan";
import { derivePreps } from "@/core/prep";
import { deriveRecipes } from "@/core/recipes";
import { appendEvents, exportBackup, getAllEvents, getPantry, importBackup, importEvents, liveEvents, wipeAll } from "./index";
import { liveValueOf } from "./hooks";
import { LOADING_LOG, createSharedLog, createSharedValue, derivedOf, type LogSnapshot, type SharedLog } from "./shared";

// Le derivazioni vere, contate: una spia per ciascuna.
vi.mock("@/core/ledger", async (original) => {
  const actual = await original<typeof import("@/core/ledger")>();
  return { ...actual, derivePantry: vi.fn(actual.derivePantry) };
});
vi.mock("@/core/diary", async (original) => {
  const actual = await original<typeof import("@/core/diary")>();
  return { ...actual, deriveDiary: vi.fn(actual.deriveDiary) };
});
vi.mock("@/core/plan", async (original) => {
  const actual = await original<typeof import("@/core/plan")>();
  return { ...actual, derivePlan: vi.fn(actual.derivePlan) };
});
vi.mock("@/core/recipes", async (original) => {
  const actual = await original<typeof import("@/core/recipes")>();
  return { ...actual, deriveRecipes: vi.fn(actual.deriveRecipes) };
});
vi.mock("@/core/prep", async (original) => {
  const actual = await original<typeof import("@/core/prep")>();
  return { ...actual, derivePreps: vi.fn(actual.derivePreps) };
});

/** Una sorgente finta: emette quando lo dice il test e conta le iscrizioni. */
function fakeSource<T>() {
  type Observer = { next: (value: T) => void; error: (error: unknown) => void };
  const observers = new Set<Observer>();
  let opened = 0;
  const source = () =>
    ({
      subscribe(observer: Observer) {
        opened++;
        observers.add(observer);
        return { closed: false, unsubscribe: () => void observers.delete(observer) };
      },
    }) as unknown as Observable<T>;
  return {
    source,
    emit: (value: T) => [...observers].forEach((o) => o.next(value)),
    fail: (error: unknown) => [...observers].forEach((o) => o.error(error)),
    /** Quante volte ci si è iscritti alla sorgente, in tutto. */
    opened: () => opened,
    /** Quante iscrizioni sono aperte adesso. */
    open: () => observers.size,
  };
}

const buy = (id: string, at: string, lotId = `lot-${id}`, value = 500) =>
  purchase(id, at, { lotId, productRef: "farina", quantity: q(value), location: "dispensa" });

const T1 = "2026-01-01T10:00:00.000Z";
const T2 = "2026-01-02T10:00:00.000Z";

describe("createSharedLog", () => {
  it("non si iscrive finché nessuno ascolta, e lo stato è «in caricamento»", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    expect(fake.opened()).toBe(0);
    expect(log.getSnapshot()).toBe(LOADING_LOG);
    expect(log.getSnapshot()).toEqual({ events: undefined, error: undefined });
  });

  it("una iscrizione sola con più ascoltatori; ogni emissione li avvisa una volta", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const calls = [vi.fn(), vi.fn(), vi.fn()];
    calls.forEach((c) => log.subscribe(c));
    expect(fake.opened()).toBe(1);
    fake.emit([buy("a", T1)]);
    calls.forEach((c) => expect(c).toHaveBeenCalledTimes(1));
    expect(log.getSnapshot().events?.map((e) => e.id)).toEqual(["a"]);
  });

  it("lo stato è lo stesso oggetto tra due emissioni e uno nuovo dopo ogni emissione", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    log.subscribe(() => {});
    const events = [buy("a", T1)];
    fake.emit(events);
    const first = log.getSnapshot();
    expect(log.getSnapshot()).toBe(first);
    expect(first.events).toBe(events);
    // stesso numero di eventi, stesso ultimo id, perfino lo stesso elenco: è comunque uno stato nuovo
    fake.emit(events);
    expect(log.getSnapshot()).not.toBe(first);
    fake.emit([buy("a", T1, "lot-a", 900)]);
    expect((log.getSnapshot().events?.[0] as { quantity: { value: number } }).quantity.value).toBe(900);
  });

  it("resta iscritto quando non ascolta più nessuno, e chi arriva dopo trova i dati di adesso", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const stop = log.subscribe(() => {});
    fake.emit([buy("a", T1)]);
    stop();
    expect(fake.open()).toBe(1);
    // una scrittura tra una pagina e l'altra
    fake.emit([buy("a", T1), buy("b", T2)]);
    expect(log.getSnapshot().events).toHaveLength(2);
    const late = vi.fn();
    log.subscribe(late);
    expect(fake.opened()).toBe(1);
    expect(late).not.toHaveBeenCalled();
    expect(log.getSnapshot().events).toHaveLength(2);
  });

  it("montaggio doppio (iscrizione, disiscrizione, iscrizione): una sola iscrizione alla sorgente", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const listener = vi.fn();
    log.subscribe(listener)();
    log.subscribe(listener);
    expect(fake.opened()).toBe(1);
    fake.emit([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("chi si è disiscritto non viene più avvisato", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const gone = vi.fn();
    const here = vi.fn();
    const stop = log.subscribe(gone);
    log.subscribe(here);
    stop();
    fake.emit([]);
    expect(gone).not.toHaveBeenCalled();
    expect(here).toHaveBeenCalledTimes(1);
  });

  it("errore dell'archivio: lo stato porta l'errore; alla prossima iscrizione si ritenta", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const first = vi.fn();
    log.subscribe(first);
    const broken = new Error("archivio chiuso");
    fake.fail(broken);
    expect(log.getSnapshot()).toEqual({ events: undefined, error: broken });
    expect(first).toHaveBeenCalledTimes(1);

    // la schermata rimontata («Riprova»): un'iscrizione nuova, e la vecchia è chiusa; finché l'archivio non risponde resta l'errore
    const failedState = log.getSnapshot();
    const second = vi.fn();
    log.subscribe(second);
    expect(fake.opened()).toBe(2);
    expect(fake.open()).toBe(1);
    expect(log.getSnapshot()).toBe(failedState);
    expect(first).toHaveBeenCalledTimes(1);

    // un'altra iscrizione mentre si riprova non ne apre una terza
    log.subscribe(() => {});
    expect(fake.opened()).toBe(2);

    fake.emit([buy("a", T1)]);
    expect(log.getSnapshot().error).toBeUndefined();
    expect(log.getSnapshot().events).toHaveLength(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("se anche il nuovo tentativo fallisce lo stato è un errore nuovo, e si può riprovare ancora", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    log.subscribe(() => {});
    fake.fail(new Error("uno"));
    log.subscribe(() => {});
    const again = new Error("due");
    fake.fail(again);
    expect(log.getSnapshot()).toEqual({ events: undefined, error: again });
    log.subscribe(() => {});
    expect(fake.opened()).toBe(3);
    expect(fake.open()).toBe(1);
  });

  it("dopo un errore, se la stessa osservazione torna a emettere, lo stato torna buono senza altre iscrizioni", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    log.subscribe(() => {});
    fake.emit([buy("a", T1)]);
    fake.fail(new Error("lettura fallita"));
    expect(log.getSnapshot().events).toBeUndefined();
    fake.emit([buy("a", T1)]);
    expect(log.getSnapshot().events).toHaveLength(1);
    log.subscribe(() => {});
    expect(fake.opened()).toBe(1);
  });

  it("«Riprova» (retry): dopo un errore riparte la lettura, senza rimontare niente; senza errore non fa niente", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    const listener = vi.fn();
    log.subscribe(listener);
    expect(log.retry()).toBe(false);
    expect(fake.opened()).toBe(1);

    fake.fail(new Error("archivio chiuso"));
    const failedState = log.getSnapshot();
    expect(log.retry()).toBe(true);
    expect(fake.opened()).toBe(2);
    expect(fake.open()).toBe(1);
    // finché l'archivio non risponde resta l'errore
    expect(log.getSnapshot()).toBe(failedState);

    fake.emit([buy("a", T1)]);
    expect(log.getSnapshot().events).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(2);
    // tornato buono: un altro tocco non apre altre letture
    expect(log.retry()).toBe(false);
    expect(fake.opened()).toBe(2);
  });

  it("un errore senza valore resta un errore", () => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    log.subscribe(() => {});
    fake.fail(undefined);
    expect(log.getSnapshot().error).toBeInstanceOf(Error);
  });
});

describe("createSharedValue", () => {
  it("dà forma al valore una volta per emissione, per tutti", () => {
    const fake = fakeSource<number[]>();
    const shape = vi.fn((list: number[]) => new Map(list.map((n) => [n, n * 2])));
    const shared = createSharedValue(fake.source, shape);
    shared.subscribe(() => {});
    shared.subscribe(() => {});
    expect(shared.getSnapshot()).toEqual({ value: undefined, error: undefined });
    fake.emit([1, 2]);
    const snapshot = shared.getSnapshot();
    expect(shared.getSnapshot()).toBe(snapshot);
    expect(snapshot.value?.get(2)).toBe(4);
    expect(shape).toHaveBeenCalledTimes(1);
    // la mappa è condivisa: chi prova a cambiarla viene fermato
    expect(() => (snapshot.value as Map<number, number>).set(3, 6)).toThrow(TypeError);
    expect(() => (snapshot.value as Map<number, number>).clear()).toThrow(TypeError);
    expect(snapshot.value?.size).toBe(2);
  });
});

describe("derivedOf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stesso elenco, stesso oggetto; elenchi diversi, oggetti diversi", () => {
    const events = mixedLog().all;
    expect(derivedOf(events)).toBe(derivedOf(events));
    expect(derivedOf([...events])).not.toBe(derivedOf(events));
  });

  it("ogni derivazione si calcola una volta sola, e solo se qualcuno la chiede", () => {
    const events = sortEvents(mixedLog().all);
    // il registro di prova si costruisce derivando: si conta da qui
    vi.clearAllMocks();
    const derived = derivedOf(events);
    expect(derivePantry).not.toHaveBeenCalled();
    expect(derivePlan).not.toHaveBeenCalled();

    // due schermate chiedono la dispensa
    const pantry = derived.pantry;
    expect(derivedOf(events).pantry).toBe(pantry);
    expect(derivePantry).toHaveBeenCalledTimes(1);
    expect(deriveDiary).not.toHaveBeenCalled();

    expect(derived.diary).toBe(derived.diary);
    expect(derived.plan).toBe(derived.plan);
    expect(derived.recipes).toBe(derived.recipes);
    expect(derived.preps).toBe(derived.preps);
    expect(deriveDiary).toHaveBeenCalledTimes(1);
    expect(derivePlan).toHaveBeenCalledTimes(1);
    expect(deriveRecipes).toHaveBeenCalledTimes(1);
    expect(derivePreps).toHaveBeenCalledTimes(1);
    // le preparazioni usano la dispensa già calcolata
    expect(derivePantry).toHaveBeenCalledTimes(1);
  });

  it("le preparazioni chieste per prime calcolano la dispensa una volta, e resta quella per tutti", () => {
    // senza l'annullamento della preparazione, che nel registro di prova la toglie
    const events = sortEvents(mixedLog().all.filter((e) => e.id !== "v-prep"));
    vi.clearAllMocks();
    const derived = derivedOf(events);
    expect(derived.preps.preps).toHaveLength(1);
    expect(derived.pantry.lots.length).toBeGreaterThan(0);
    expect(derivePantry).toHaveBeenCalledTimes(1);
  });

  it("i risultati sono uguali, campo per campo, a quelli delle funzioni di sempre sugli stessi eventi", () => {
    const { all } = mixedLog();
    for (const events of [sortEvents(all), all, shuffled(all, seededRandom(7)), [] as AnyEvent[]]) {
      const derived = derivedOf(events);
      expect(derived.pantry).toEqual(derivePantry(events));
      expect(derived.diary).toEqual(deriveDiary(events));
      expect(derived.plan).toEqual(derivePlan(events));
      expect(derived.recipes).toEqual(deriveRecipes(events));
      expect(derived.preps).toEqual(derivePreps(events));
    }
    // il registro di prova ha davvero qualcosa in ogni famiglia
    const full = derivedOf(sortEvents(all));
    expect(full.pantry.lots.length).toBeGreaterThan(0);
    expect(full.diary.days.length).toBeGreaterThan(0);
    expect(full.recipes.recipes.length).toBeGreaterThan(0);
    expect(full.preps.voidedPrepIds.length + full.preps.preps.length).toBeGreaterThan(0);
  });

  it("una derivazione che lancia non rompe le altre, e rilancia lo stesso errore senza ricalcolare", () => {
    const events = sortEvents(mixedLog().all);
    const broken = new Error("evento rotto");
    vi.mocked(derivePlan).mockImplementationOnce(() => {
      throw broken;
    });
    const derived = derivedOf(events);
    expect(() => derived.plan).toThrow(broken);
    expect(() => derived.plan).toThrow(broken);
    expect(derivePlan).toHaveBeenCalledTimes(1);
    expect(derived.pantry.lots.length).toBeGreaterThan(0);
    expect(derived.diary.days.length).toBeGreaterThan(0);
  });

  it("in sviluppo le derivazioni sono congelate in profondità: modificare un lotto condiviso lancia", () => {
    const events = sortEvents(mixedLog().all);
    const { pantry, diary } = derivedOf(events);
    expect(() => pantry.lots.sort(() => 0)).toThrow(TypeError);
    expect(() => pantry.lots.push(pantry.lots[0])).toThrow(TypeError);
    expect(() => {
      pantry.lots[0].remaining = 0;
    }).toThrow(TypeError);
    expect(() => {
      pantry.lots[0].history[0].eventId = "altro";
    }).toThrow(TypeError);
    expect(() => diary.days.push(diary.days[0])).toThrow(TypeError);
    expect(() => {
      diary.days[0].waterMl = 0;
    }).toThrow(TypeError);
  });
});

describe("liveValueOf (ciò che restituiscono i ganci)", () => {
  const snapshotOf = (events: AnyEvent[]): LogSnapshot => {
    const fake = fakeSource<AnyEvent[]>();
    const log = createSharedLog(fake.source);
    log.subscribe(() => {});
    fake.emit(events);
    return log.getSnapshot();
  };

  it("in caricamento finché l'archivio non ha risposto", () => {
    expect(liveValueOf(LOADING_LOG, "pantry")).toEqual({ data: undefined, loading: true, error: undefined });
    expect(liveValueOf(LOADING_LOG, "events")).toEqual({ data: undefined, loading: true, error: undefined });
  });

  it("lo stesso oggetto per lo stesso stato, uno nuovo per uno stato nuovo", () => {
    const events = sortEvents(mixedLog().all);
    const snapshot = snapshotOf(events);
    const pantry = liveValueOf(snapshot, "pantry");
    expect(liveValueOf(snapshot, "pantry")).toBe(pantry);
    expect(pantry).toEqual({ data: derivePantry(events), loading: false, error: undefined });
    expect(liveValueOf(snapshot, "events").data).toBe(events);
    expect(liveValueOf(snapshot, "diary").data).toEqual(deriveDiary(events));
    expect(liveValueOf(snapshot, "plan").data).toEqual(derivePlan(events));
    expect(liveValueOf(snapshot, "recipes").data).toEqual(deriveRecipes(events));
    expect(liveValueOf(snapshot, "preps").data).toEqual(derivePreps(events));

    const next = snapshotOf(events);
    expect(liveValueOf(next, "pantry")).not.toBe(pantry);
    // stesso elenco, stesse derivazioni: i dati sono gli stessi oggetti
    expect(liveValueOf(next, "pantry").data).toBe(pantry.data);
  });

  it("errore dell'archivio: tutti i ganci portano l'errore", () => {
    const broken = new Error("archivio chiuso");
    const snapshot: LogSnapshot = { events: undefined, error: broken };
    for (const view of ["events", "pantry", "diary", "plan", "recipes", "preps"] as const) {
      expect(liveValueOf(snapshot, view)).toEqual({ data: undefined, loading: false, error: broken });
    }
  });

  it("una derivazione che lancia porta l'errore solo nel suo gancio", () => {
    const broken = new Error("evento rotto");
    vi.mocked(deriveRecipes).mockImplementationOnce(() => {
      throw broken;
    });
    const snapshot = snapshotOf(sortEvents(mixedLog().all));
    expect(liveValueOf(snapshot, "recipes")).toEqual({ data: undefined, loading: false, error: broken });
    expect(liveValueOf(snapshot, "pantry").error).toBeUndefined();
    expect(liveValueOf(snapshot, "pantry").data).toBeDefined();
  });
});

describe("con l'archivio vero e liveEvents", () => {
  let log: SharedLog;

  /** Aspetta uno stato diverso da `before` che soddisfi la condizione (le emissioni arrivano un attimo dopo la scrittura). */
  async function stateAfter(before: LogSnapshot, test: (events: readonly AnyEvent[]) => boolean = () => true): Promise<readonly AnyEvent[]> {
    const start = Date.now();
    for (;;) {
      const now = log.getSnapshot();
      if (now.error !== undefined) throw now.error;
      if (now !== before && now.events !== undefined && test(now.events)) return now.events;
      if (Date.now() - start > 5000) throw new Error("nessuno stato nuovo dal registro condiviso");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  beforeEach(async () => {
    await wipeAll();
    log = createSharedLog(liveEvents);
    log.subscribe(() => {});
    await stateAfter(LOADING_LOG, (events) => events.length === 0);
  });

  it("dopo appendEvents lo stato è nuovo e le derivazioni danno lo stato nuovo, tutte dallo stesso elenco", async () => {
    const before = log.getSnapshot();
    const notified = vi.fn();
    log.subscribe(notified);
    await appendEvents([
      buy("a", T1),
      meal("m", T2, { mealId: "meal-1", kind: "lunch" }),
      consume("c", T2, { lotId: "lot-a", quantity: q(120), mealId: "meal-1" }),
    ]);
    const events = await stateAfter(before, (e) => e.length === 3);
    expect(notified).toHaveBeenCalled();
    expect(events).toEqual(await getAllEvents());
    const derived = derivedOf(events);
    expect(derived.pantry.lots.map((l) => [l.lotId, l.remaining])).toEqual([["lot-a", 380]]);
    expect(derived.diary.days.map((d) => d.meals.length)).toEqual([1]);
    expect(derived.pantry).toEqual(await getPantry());
  });

  it("una scrittura mentre nessuno ascolta: chi arriva dopo trova i dati nuovi", async () => {
    const before = log.getSnapshot();
    await appendEvents([water("w", T1, { ml: 200 })]);
    const events = await stateAfter(before, (e) => e.length === 1);
    expect(derivedOf(events).diary.days[0].waterMl).toBe(200);
  });

  it("importEvents che sostituisce il contenuto di un evento (stesso numero, stesso ultimo id): lo stato è nuovo", async () => {
    const old = buy("a", T1, "l", 500);
    await appendEvents([old, drink("z", T2, { name: "Tè", ml: 200 })]);
    const first = await stateAfter(LOADING_LOG, (e) => e.length === 2);
    expect(derivedOf(first).pantry.lots[0].initial).toBe(500);

    const before = log.getSnapshot();
    const newer = { ...old, recordedAt: "2026-01-05T10:00:00.000Z", quantity: q(900) };
    const result = await importEvents([newer as LedgerEvent]);
    expect(result.added).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    const events = await stateAfter(before);
    expect(events).toHaveLength(first.length);
    expect(events[events.length - 1].id).toBe(first[first.length - 1].id);
    expect(events).not.toBe(first);
    expect(derivedOf(events).pantry.lots[0].initial).toBe(900);
    // lo stato di prima resta com'era: nessuno lo ha toccato
    expect(derivedOf(first).pantry.lots[0].initial).toBe(500);
  });

  it("importBackup (ripristino) e wipeAll: lo stato è nuovo; dopo wipeAll registro e dispensa sono vuoti", async () => {
    await appendEvents([buy("a", T1), buy("b", T2)]);
    await stateAfter(LOADING_LOG, (e) => e.length === 2);
    const backup = JSON.stringify(await exportBackup());

    let before = log.getSnapshot();
    await wipeAll();
    const wiped = await stateAfter(before, (e) => e.length === 0);
    expect(derivedOf(wiped).pantry.lots).toEqual([]);
    expect(derivedOf(wiped).diary.days).toEqual([]);

    before = log.getSnapshot();
    const restored = await importBackup(backup);
    expect(restored).toMatchObject({ ok: true, added: 2 });
    const events = await stateAfter(before, (e) => e.length === 2);
    expect(derivedOf(events).pantry.lots.map((l) => l.lotId)).toEqual(["lot-a", "lot-b"]);
  });

  it("in sviluppo l'elenco e ogni evento sono congelati: modificarli lancia", async () => {
    await appendEvents([buy("a", T1), buy("b", T2)]);
    const events = (await stateAfter(LOADING_LOG, (e) => e.length === 2)) as AnyEvent[];
    expect(() => events.push(events[0])).toThrow(TypeError);
    expect(() => events.sort(() => -1)).toThrow(TypeError);
    expect(() => {
      events[0].note = "cambiato";
    }).toThrow(TypeError);
    expect(() => {
      (events[0] as { quantity: { value: number } }).quantity.value = 1;
    }).toThrow(TypeError);
    // l'archivio non ne risente
    expect(((await getAllEvents())[0] as { quantity: { value: number } }).quantity.value).toBe(500);
  });

  it("getAllEvents e getPantry leggono dall'archivio, non dalla memoria del registro condiviso", async () => {
    const before = log.getSnapshot();
    await appendEvents([buy("a", T1)]);
    // subito dopo la scrittura, prima che l'osservazione abbia emesso
    expect(await getAllEvents()).toHaveLength(1);
    expect((await getPantry()).lots).toHaveLength(1);
    const events = await stateAfter(before, (e) => e.length === 1);
    expect(await getAllEvents()).not.toBe(events);
  });
});

/** Circa 28 eventi al giorno: spesa settimanale, tre pasti con tre consumi, acqua, bevande. */
function generateLog(days: number): AnyEvent[] {
  const out: AnyEvent[] = [];
  let n = 0;
  const id = () => `e${String(n++).padStart(7, "0")}`;
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const lots: { lotId: string; left: number }[] = [];
  for (let d = 0; d < days; d++) {
    const at = (hour: number, minute = 0) => new Date(start + d * 86_400_000 + hour * 3_600_000 + minute * 60_000).toISOString();
    if (d % 7 === 0) {
      for (let i = 0; i < 21; i++) {
        const lotId = `lot${d}-${i}`;
        out.push(purchase(id(), at(9, i), { lotId, productRef: `Alimento ${i % 14}`, quantity: q(180), location: i % 2 ? "frigo" : "dispensa", priceCents: 199 }));
        lots.push({ lotId, left: 180 });
      }
    }
    for (const [kind, hour] of [["breakfast", 7], ["lunch", 12], ["dinner", 19]] as const) {
      const mealId = `meal${d}-${kind}`;
      out.push(meal(id(), at(hour, 5), { mealId, kind }));
      for (let i = 0; i < 3 && lots.length > 0; i++) {
        const lot = lots[0];
        out.push(consume(id(), at(hour, 5), { lotId: lot.lotId, quantity: q(60), mealId }));
        lot.left -= 60;
        lots.push(...lots.splice(0, 1).filter((l) => l.left > 0));
      }
    }
    for (let i = 0; i < 10; i++) out.push(water(id(), at(7 + i, 20), { ml: 200 }));
    out.push(drink(id(), at(7, 10), { name: "Caffè", ml: 40, caffeineMg: 60 }));
    out.push(drink(id(), at(15, 40), { name: "Tè", ml: 200, caffeineMg: 40 }));
    out.push(drink(id(), at(21, 10), { name: "Tisana", ml: 200 }));
  }
  return out;
}

describe("misura (stampa i tempi, non fallisce per il tempo)", () => {
  // I ganci montati insieme in Oggi, come erano: ognuno riordinava il registro e rifaceva la sua derivazione.
  const THIRTY: ReadonlyArray<"events" | "pantry" | "diary" | "plan" | "recipes" | "preps"> = [
    ...Array<"pantry">(8).fill("pantry"),
    ...Array<"events">(7).fill("events"),
    ...Array<"diary">(6).fill("diary"),
    ...Array<"preps">(5).fill("preps"),
    ...Array<"plan">(3).fill("plan"),
    "recipes",
  ];

  function measure(days: number) {
    const stored = shuffled(generateLog(days), seededRandom(3));
    const oldWay = () => {
      for (const view of THIRTY) {
        const events = sortEvents(stored);
        if (view === "pantry") derivePantry(events);
        else if (view === "diary") deriveDiary(events);
        else if (view === "plan") derivePlan(events);
        else if (view === "recipes") deriveRecipes(events);
        else if (view === "preps") derivePreps(events);
      }
    };
    const newWay = () => {
      const fake = fakeSource<AnyEvent[]>();
      const log = createSharedLog(fake.source);
      log.subscribe(() => {});
      fake.emit(sortEvents(stored));
      const snapshot = log.getSnapshot();
      for (const view of THIRTY) liveValueOf(snapshot, view);
    };
    const time = (run: () => void) => {
      const start = performance.now();
      run();
      return Math.round(performance.now() - start);
    };
    // la vecchia maniera una volta sola (sono già trenta giri); la nuova è il mediano di tre
    const before = time(oldWay);
    const after = [time(newWay), time(newWay), time(newWay)].sort((a, b) => a - b)[1];
    console.log(`[misura 3A] ${stored.length} eventi · trenta ganci alla vecchia maniera: ${before} ms · una volta sola (con il congelamento di sviluppo): ${after} ms`);
    return { events: stored.length, before, after };
  }

  it("5.000 eventi su 180 giorni", { timeout: 120_000 }, () => {
    const result = measure(180);
    expect(result.events).toBeGreaterThan(4900);
    expect(result.events).toBeLessThan(5200);
  });

  // dieci volte tanto: lungo, gira solo a richiesta (BENCH_50K=1). I tempi si leggono con `--silent=false`.
  it.runIf(process.env.BENCH_50K === "1")("50.000 eventi", { timeout: 300_000 }, () => {
    expect(measure(1790).events).toBeGreaterThan(49_000);
  });
});
