// Difetti trovati in revisione indipendente, ognuno con il suo test.
import { describe, expect, it } from "vitest";
import { correct } from "./correct";
import { derivePantry } from "./derive";
import { canonicalStringify, mergeEventLists, mergeEvents } from "./merge";
import { InvalidPeriodError, wasteByReason } from "./selectors";
import {
  adjust,
  consume,
  declare,
  discard,
  purchase,
  q,
  seededRandom,
  shuffled,
  updateLot,
  voidOf,
} from "./test-helpers";
import type { LedgerEvent } from "./types";
import { validateEvent } from "./validate";

const T = (h: number, m = 0, s = 0) =>
  `2026-03-10T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;

const buy = (id = "p1", at = T(8), extra: Partial<LedgerEvent> = {}) =>
  purchase(id, at, {
    lotId: "L1",
    productRef: "latte",
    quantity: q(1000, "ml"),
    priceCents: 200,
    location: "frigo",
    ...extra,
  });

function expectPermutationInvariant(events: LedgerEvent[], seed = 11) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

describe("1. eventi che precedono la creazione del lotto non si perdono", () => {
  it("(a) correct() su un acquisto con un consumo allo stesso `at`", () => {
    const original = buy("p1", T(8));
    const eat = consume("c1", T(8), {
      lotId: "L1",
      quantity: q(200, "ml"),
      recordedAt: T(8, 0, 30),
    });
    const [v, next] = correct(
      original,
      {
        type: "purchase",
        lotId: "L1",
        productRef: "latte intero",
        quantity: q(1000, "ml"),
        location: "frigo",
        certainty: "measured",
        source: "manual",
      },
      { now: () => T(12), idGenerator: (() => { let n = 0; return () => `g${++n}`; })() },
    );
    expect(next.recordedAt).toBe(T(12)); // dopo il consumo nell'ordine canonico
    const state = expectPermutationInvariant([original, eat, v, next]);
    expect(state.lots[0]).toMatchObject({ productRef: "latte", remaining: 800 });
    expect(state.anomalies).toEqual([]);
  });

  it("(b) consumo registrato prima di declare con lo stesso `at`", () => {
    const eat = consume("c1", T(8), { lotId: "L1", quantity: q(100, "g"), recordedAt: T(8, 0, 1) });
    const dec = declare("d1", T(8), {
      lotId: "L1",
      productRef: "riso",
      quantity: q(500, "g"),
      location: "dispensa",
      recordedAt: T(8, 0, 2),
    });
    const state = expectPermutationInvariant([eat, dec]);
    expect(state.lots[0].remaining).toBe(400);
    expect(state.anomalies).toEqual([]);
  });

  it("(c) orologi sfasati: consumo 12:05 su un acquisto registrato alle 12:10", () => {
    const events = [
      buy("p1", T(12, 10)),
      consume("c1", T(12, 5), { lotId: "L1", quantity: q(300, "ml"), deviceId: "dev-b" }),
      adjust("a1", T(12, 6), { lotId: "L1", remaining: q(900, "ml"), deviceId: "dev-b" }),
    ];
    const state = expectPermutationInvariant(events);
    // c1 e a1 sono trattati come avvenuti alla creazione, nell'ordine canonico: 1000-300=700, poi adjust a 900
    expect(state.lots[0].remaining).toBe(900);
    expect(state.lots[0].createdAt).toBe(T(12, 10));
    expect(state.lots[0].history.map((h) => [h.eventId, h.at])).toEqual([
      ["p1", T(12, 10)],
      ["c1", T(12, 10)],
      ["a1", T(12, 10)],
    ]);
    expect(state.anomalies).toEqual([
      { code: "event_before_lot", eventId: "c1", lotId: "L1" },
      { code: "event_before_lot", eventId: "a1", lotId: "L1" },
    ]);
  });

  it("tra due creazioni con lo stesso lotId vince la prima nell'ordine canonico", () => {
    const first = buy("p-a", T(8));
    const second = buy("p-b", T(9), { productRef: "altro" } as Partial<LedgerEvent>);
    const eat = consume("c1", T(8, 30), { lotId: "L1", quantity: q(100, "ml") });
    const state = expectPermutationInvariant([second, eat, first]);
    expect(state.lots).toHaveLength(1);
    expect(state.lots[0]).toMatchObject({ productRef: "latte", remaining: 900 });
    expect(state.anomalies).toEqual([{ code: "duplicate_lot", eventId: "p-b", lotId: "L1" }]);
  });

  it("un lotto davvero sconosciuto resta unknown_lot", () => {
    const state = derivePantry([consume("c", T(8), { lotId: "NOPE", quantity: q(1) })]);
    expect(state.anomalies).toEqual([{ code: "unknown_lot", eventId: "c", lotId: "NOPE" }]);
  });
});

describe("2. asOf con void e con correct()", () => {
  const deviceOpts = () => {
    let n = 0;
    return { now: () => T(12), idGenerator: () => `g${++n}` };
  };

  it("correggere un consumo da 100 a 150: la vista intermedia vede solo 150", () => {
    const p = buy();
    const eat = consume("c1", T(9), { lotId: "L1", quantity: q(100, "ml") });
    const [v, next] = correct(
      eat,
      { type: "consume", lotId: "L1", quantity: q(150, "ml"), certainty: "measured", source: "manual" },
      deviceOpts(),
    );
    const events = [p, eat, v, next];
    expect(next.at).toBe(T(9));
    expect(v.at).toBe(T(12)); // il void nasce dopo asOf
    const mid = derivePantry(events, { asOf: T(10) });
    expect(mid.lots[0].remaining).toBe(850);
    expect(mid.anomalies).toEqual([]);
    expect(derivePantry(events).lots[0].remaining).toBe(850);
    expect(derivePantry(shuffled(events, seededRandom(3)), { asOf: T(10) })).toEqual(mid);
  });

  it("correggere un acquisto: nessun duplicate_lot nella vista asOf", () => {
    const p = buy();
    const [v, next] = correct(
      p,
      {
        type: "purchase",
        lotId: "L1",
        productRef: "latte intero",
        quantity: q(1000, "ml"),
        location: "frigo",
        certainty: "measured",
        source: "manual",
      },
      deviceOpts(),
    );
    const mid = derivePantry([p, v, next], { asOf: T(10) });
    expect(mid.anomalies).toEqual([]);
    expect(mid.lots).toHaveLength(1);
    expect(mid.lots[0].productRef).toBe("latte");
  });

  it("un void il cui bersaglio è dopo asOf resta escluso, anche a catena", () => {
    const p = buy();
    const late = consume("c1", T(15), { lotId: "L1", quantity: q(100, "ml") });
    const v1 = voidOf("v1", T(16), "c1");
    const v2 = voidOf("v2", T(17), "v1");
    const mid = derivePantry([p, late, v1, v2], { asOf: T(10) });
    expect(mid.lots[0].remaining).toBe(1000);
    expect(mid.voidedEventIds).toEqual([]);
    expect(mid.anomalies).toEqual([]);
    // void di void con bersaglio incluso: la catena si applica anche se i void sono "successivi"
    const early = consume("c0", T(9), { lotId: "L1", quantity: q(100, "ml") });
    const w1 = voidOf("w1", T(16), "c0");
    const w2 = voidOf("w2", T(17), "w1");
    expect(derivePantry([p, early, w1, w2], { asOf: T(10) }).lots[0].remaining).toBe(900);
  });
});

describe("3. mergeEvents: una copia non valida non nasconde quella valida", () => {
  const good = consume("c1", T(9), { lotId: "L1", quantity: q(100, "ml") });
  const corrupt = { ...good, recordedAt: T(20), quantity: q(-5, "ml") } as LedgerEvent;
  const corrupt2 = { ...good, recordedAt: T(21), certainty: "boh" } as unknown as LedgerEvent;

  it("vince la versione valida, in entrambi gli ordini, e il conflitto è segnalato", () => {
    const ab = mergeEvents([good], [corrupt]);
    const ba = mergeEvents([corrupt], [good]);
    expect(ab.events).toEqual([good]);
    expect(ba.events).toEqual([good]);
    expect(ab.conflicts).toEqual([{ id: "c1", kept: good, discarded: [corrupt] }]);
    expect(ba.conflicts).toEqual(ab.conflicts);
  });

  it("l'ordine resta totale: idempotente, commutativo e associativo su permutazioni", () => {
    const pool = [good, corrupt, corrupt2, buy()];
    const reference = mergeEventLists([pool]).events;
    expect(reference).toContainEqual(good);
    const random = seededRandom(5);
    for (let i = 0; i < 25; i++) {
      const s = shuffled(pool, random);
      const i1 = Math.floor(random() * s.length);
      const [a, b, c] = [s.slice(0, i1), s.slice(i1, i1 + 2), s.slice(i1 + 2)];
      expect(mergeEvents(mergeEvents(a, b).events, c).events).toEqual(reference);
      expect(mergeEvents(a, mergeEvents(b, c).events).events).toEqual(reference);
      expect(mergeEvents(reference, reference).events).toEqual(reference);
    }
  });

  it("derivePantry applica la copia valida", () => {
    const state = derivePantry([corrupt, buy(), good]);
    expect(state.lots[0].remaining).toBe(900);
    expect(state.anomalies.map((a) => a.code)).toEqual(["id_conflict"]);
  });

  it("NaN, Infinity e null non collassano nella stessa forma canonica", () => {
    expect(canonicalStringify({ v: Number.NaN })).not.toBe(canonicalStringify({ v: null }));
    expect(canonicalStringify({ v: Infinity })).not.toBe(canonicalStringify({ v: null }));
    const x = { ...good, quantity: { value: Number.NaN, unit: "ml" } } as LedgerEvent;
    const y = { ...good, quantity: { value: null, unit: "ml" } } as unknown as LedgerEvent;
    expect(mergeEvents([x], [y]).events).toEqual(mergeEvents([y], [x]).events);
  });
});

describe("4. stringhe vuote nei campi facoltativi", () => {
  it("non invalidano l'evento", () => {
    const p = buy("p1", T(8), { note: "", store: "", receiptId: "" } as Partial<LedgerEvent>);
    expect(validateEvent(p)).toEqual([]);
    expect(
      validateEvent(consume("c", T(9), { lotId: "L1", quantity: q(1), mealId: "", note: "" })),
    ).toEqual([]);
    expect(
      validateEvent(updateLot("u", T(9), { lotId: "L1", patch: { store: "" } })),
    ).toEqual([]);
  });

  it("valgono come assenti nella dispensa derivata", () => {
    const state = derivePantry([
      buy("p1", T(8), { store: "", receiptId: "" } as Partial<LedgerEvent>),
      updateLot("u", T(9), { lotId: "L1", patch: { store: "" } }),
    ]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots[0].store).toBeUndefined();
    expect(state.lots[0].receiptId).toBeUndefined();
  });

  it("restano invalidi i tipi sbagliati e le stringhe vuote nei campi obbligatori", () => {
    expect(validateEvent({ ...buy(), note: 5 }).map((e) => e.path)).toEqual(["note"]);
    expect(validateEvent({ ...buy(), productRef: "" }).map((e) => e.path)).toEqual(["productRef"]);
  });
});

describe("5. valori non serializzabili non fanno lanciare", () => {
  const good = consume("c1", T(9), { lotId: "L1", quantity: q(100, "ml") });
  const big = { ...good, id: "big", note: BigInt(10) } as unknown as LedgerEvent;
  const extra = { ...good, id: "extra", unknownField: BigInt(10) } as unknown as LedgerEvent;
  const cyclic: Record<string, unknown> = { ...good, id: "cyc" };
  cyclic.self = cyclic;
  const fn = { ...good, id: "fn", cb: () => 1 } as unknown as LedgerEvent;
  const events = [buy(), good, big, extra, cyclic as unknown as LedgerEvent, fn];

  it("mergeEvents non lancia e scarta le voci non serializzabili", () => {
    const m = mergeEvents(events, [good]);
    expect(m.events.map((e) => e.id)).toEqual(["p1", "c1"]);
  });

  it("derivePantry classifica le voci come invalid_event con il loro id, senza lanciare", () => {
    const state = derivePantry(events);
    expect(state.lots[0].remaining).toBe(900);
    const bad = state.anomalies.filter((a) => a.code === "invalid_event");
    expect(bad.map((a) => a.eventId).sort()).toEqual(["big", "cyc", "extra", "fn"]);
    expect(bad.every((a) => (a.errors?.length ?? 0) > 0)).toBe(true);
  });

  it("validateEvent non lancia con bigint nei campi", () => {
    const e = { ...good, quantity: { value: BigInt(5), unit: "ml" } };
    expect(validateEvent(e)).toEqual([{ path: "quantity.value", code: "invalid_value" }]);
  });

  it("l'ordine di ingresso non cambia lo stato", () => {
    expectPermutationInvariant(events);
  });
});

describe("6. istanti non validi", () => {
  const events = [buy(), consume("c", T(9), { lotId: "L1", quantity: q(100, "ml") })];

  it("derivePantry con asOf non valido: anomalia esplicita e nessuno stato", () => {
    for (const asOf of ["ieri", "2026-03-10", "", "2026-03-10T09:00:00+01:00"]) {
      expect(derivePantry(events, { asOf })).toEqual({
        lots: [],
        anomalies: [{ code: "invalid_as_of" }],
        voidedEventIds: [],
      });
    }
  });

  it("wasteByReason con from o to non validi lancia un errore tipizzato", () => {
    const state = derivePantry([
      buy(),
      discard("d", T(9), { lotId: "L1", quantity: q(100, "ml"), reason: "expired" }),
    ]);
    expect(() => wasteByReason(state, { from: "oggi" })).toThrow(InvalidPeriodError);
    expect(() => wasteByReason(state, { to: "2026-03-10" })).toThrow(InvalidPeriodError);
    expect(() => wasteByReason(state, { from: T(8), to: T(10) })).not.toThrow();
    expect(wasteByReason(state, { from: T(8), to: T(10) })).toHaveLength(1);
  });
});

describe("7. costo dello spreco mai oltre il prezzo pagato", () => {
  const base = purchase("p", T(8), {
    lotId: "L",
    productRef: "x",
    quantity: q(100),
    priceCents: 50,
    location: "frigo",
  });

  it("dopo un adjust verso l'alto e uno scarto grande", () => {
    const state = derivePantry([
      base,
      adjust("a", T(9), { lotId: "L", remaining: q(250) }),
      discard("d", T(10), { lotId: "L", quantity: q(250), reason: "expired" }),
    ]);
    const [entry] = wasteByReason(state);
    expect(entry).toMatchObject({ quantity: 250, costCents: 50 });
  });

  it("anche sommando più scarti dello stesso lotto, e contando quelli fuori periodo", () => {
    const events = [
      base,
      discard("d1", T(9), { lotId: "L", quantity: q(100), reason: "expired" }),
      adjust("a", T(10), { lotId: "L", remaining: q(100) }),
      discard("d2", T(11), { lotId: "L", quantity: q(100), reason: "expired" }),
    ];
    const state = derivePantry(events);
    expect(wasteByReason(state)[0]).toMatchObject({ quantity: 200, events: 2, costCents: 50 });
    // nel solo secondo periodo il primo scarto ha già consumato tutto il prezzo
    expect(wasteByReason(state, { from: T(10, 30) })[0]).toMatchObject({ quantity: 100, costCents: 0 });
  });

  it("senza adjust il costo resta proporzionale", () => {
    const state = derivePantry([
      base,
      discard("d", T(9), { lotId: "L", quantity: q(40), reason: "leftover" }),
    ]);
    expect(wasteByReason(state)[0].costCents).toBe(20);
  });
});
