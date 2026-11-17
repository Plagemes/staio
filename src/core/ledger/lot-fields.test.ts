// Campi descrittivi del lotto (ultima scrittura per registrazione), date di apertura/congelamento
// e valori non serializzabili in mergeEvents.
import { describe, expect, it } from "vitest";
import { correct, correctLot } from "./correct";
import { derivePantry } from "./derive";
import { mergeEvents } from "./merge";
import {
  consume,
  declare,
  move,
  open,
  purchase,
  q,
  seededRandom,
  shuffled,
  updateLot,
} from "./test-helpers";
import type { Expiry, LedgerEvent, PurchaseEvent } from "./types";

const D = (day: number, h = 10) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const seq = () => {
  let n = 0;
  return () => `g${String(++n).padStart(3, "0")}`;
};

function invariant(events: LedgerEvent[], seed = 21) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

const withUseBy = (date: string): Expiry => ({ date, kind: "use_by" });

const original = purchase("p1", D(1), {
  lotId: "L1",
  productRef: "affettato",
  quantity: q(200),
  location: "frigo",
  expiry: withUseBy("2026-11-05"),
});
const enrich = updateLot("u1", D(2), {
  lotId: "L1",
  patch: { expiry: withUseBy("2026-11-30") },
});

const fixedPurchase = (extra: Record<string, unknown> = {}) =>
  ({
    type: "purchase",
    lotId: "L1",
    productRef: "affettato",
    quantity: q(200),
    location: "frigo",
    certainty: "measured",
    source: "manual",
    ...extra,
  }) as Parameters<typeof correct>[1];

describe("A. campi descrittivi: solo updateLot, vince la registrazione e non `at`", () => {
  it("correct() con `at` spostato non tocca la scadenza: quella passata nella sostituzione è ignorata", () => {
    const [v, next] = correct(
      original,
      fixedPurchase({ at: D(3), expiry: withUseBy("2026-11-08") }),
      { now: () => D(10), idGenerator: seq() },
    );
    expect((next as PurchaseEvent).expiry).toEqual(withUseBy("2026-11-05")); // copiata dall'originale
    const state = invariant([original, enrich, v, next]);
    expect(state.lots[0].expiry).toEqual(withUseBy("2026-11-30")); // l'updateLot resta
    // l'updateLot del 2 precede la nuova creazione del 3: solo un avviso, l'evento è applicato
    expect(state.anomalies).toEqual([{ code: "event_before_lot", eventId: "u1", lotId: "L1" }]);
  });

  it("per cambiare la scadenza con `at` spostato serve correctLot (void + creazione + updateLot)", () => {
    const events = correctLot(
      original,
      { at: D(3), expiry: withUseBy("2026-11-08") },
      { now: () => D(10), idGenerator: seq() },
    );
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "updateLot"]);
    expect(invariant([original, enrich, ...events]).lots[0].expiry).toEqual(withUseBy("2026-11-08"));
  });

  it("una creazione corretta senza scadenza non cancella quella di un updateLot precedente", () => {
    const bare = purchase("p0", D(1), {
      lotId: "L1",
      productRef: "affettato",
      quantity: q(200),
      location: "frigo",
    });
    const [v, next] = correct(bare, fixedPurchase({ productRef: "prosciutto" }), {
      now: () => D(10),
      idGenerator: seq(),
    });
    const state = invariant([bare, enrich, v, next]);
    expect(state.lots[0].expiry).toEqual(withUseBy("2026-11-30"));
    expect(state.lots[0].productRef).toBe("affettato"); // anche il productRef si cambia solo con updateLot
  });

  it("un updateLot registrato dopo la correzione prevale, anche con `at` anteriore", () => {
    const [v, next] = correct(original, fixedPurchase({ at: D(3) }), {
      now: () => D(10),
      idGenerator: seq(),
    });
    const late = updateLot("u2", D(1, 5), {
      lotId: "L1",
      recordedAt: D(12),
      patch: { expiry: withUseBy("2026-11-25") },
    });
    expect(invariant([original, enrich, v, next, late]).lots[0].expiry).toEqual(
      withUseBy("2026-11-25"),
    );
  });

  it("i null degli updateLot sono cancellazioni esplicite e seguono la stessa regola, anche dopo una correzione", () => {
    const full = purchase("p1", D(1), {
      lotId: "L1",
      productRef: "affettato",
      quantity: q(200),
      priceCents: 300,
      store: "Coop",
      location: "frigo",
      expiry: withUseBy("2026-11-05"),
    });
    const clear = updateLot("c1", D(20), {
      lotId: "L1",
      recordedAt: D(5),
      patch: { priceCents: null, store: null, expiry: null },
    });
    const set = updateLot("c2", D(2), { lotId: "L1", recordedAt: D(7), patch: { priceCents: 450 } });
    const [v, next] = correct(full, fixedPurchase({ priceCents: 1, store: "X" }), {
      now: () => D(10),
      idGenerator: seq(),
    });
    const state = invariant([full, clear, set, v, next]).lots[0];
    expect(state.expiry).toBeUndefined();
    expect(state.store).toBeUndefined();
    expect(state.priceCents).toBe(450);
    // senza i due updateLot la creazione d'origine mantiene i propri valori
    expect(derivePantry([full, v, next]).lots[0]).toMatchObject({
      priceCents: 300,
      store: "Coop",
      expiry: withUseBy("2026-11-05"),
    });
  });

  it("a pari recordedAt decide l'id, indipendentemente dall'ordine di ingresso", () => {
    const a = updateLot("a", D(2), { lotId: "L1", recordedAt: D(6), patch: { store: "A" } });
    const b = updateLot("b", D(3), { lotId: "L1", recordedAt: D(6), patch: { store: "B" } });
    expect(invariant([original, a, b]).lots[0].store).toBe("B");
  });
});

describe("C. apertura e congelamento conservano l'at originale", () => {
  const dec = declare("d1", D(20), {
    lotId: "L2",
    productRef: "affettato",
    quantity: q(200),
    location: "frigo",
  });

  it("open prima della creazione: openedAt resta il 17, con l'avviso", () => {
    const o = open("o1", D(17), { lotId: "L2" });
    const state = invariant([dec, o]);
    expect(state.lots[0].openedAt).toBe(D(17));
    expect(state.anomalies).toEqual([{ code: "event_before_lot", eventId: "o1", lotId: "L2" }]);
  });

  it("move prima della creazione: frozenAt e thawedAt originali", () => {
    const state = invariant([
      dec,
      move("m1", D(16), { lotId: "L2", to: "freezer" }),
      move("m2", D(18), { lotId: "L2", to: "frigo" }),
    ]);
    // nell'ordine canonico m1 e m2 precedono la creazione ma si applicano in sequenza
    expect(state.lots[0]).toMatchObject({ frozenAt: D(16), thawedAt: D(18), location: "frigo" });
  });

  it("un open dopo la creazione non cambia", () => {
    expect(derivePantry([dec, open("o1", D(21), { lotId: "L2" })]).lots[0].openedAt).toBe(D(21));
  });
});

describe("B. mergeEvents e valori non serializzabili", () => {
  const base = purchase("p1", D(1), {
    lotId: "L1",
    productRef: "x",
    quantity: q(100),
    location: "frigo",
  });
  const eat = consume("c1", D(2), { lotId: "L1", quantity: q(30) });

  it("una Date in un campo extra è serializzata come ISO: l'evento resta valido e applicato", () => {
    const withDate = { ...eat, extra: new Date("2026-11-02T10:00:00.000Z") } as LedgerEvent;
    const m = mergeEvents([base], [withDate]);
    expect(m.events.map((e) => e.id)).toEqual(["p1", "c1"]);
    expect(m.rejected).toEqual([]);
    expect(derivePantry([base, withDate]).lots[0].remaining).toBe(70);
    expect(derivePantry([base, withDate]).anomalies).toEqual([]);
  });

  it("le voci davvero non serializzabili sono riportate in `rejected`, senza duplicati e in ordine stabile", () => {
    class Box {
      v = 1;
    }
    const klass = { ...eat, id: "k", extra: new Box() } as unknown as LedgerEvent;
    const big = { ...eat, id: "b", extra: BigInt(1) } as unknown as LedgerEvent;
    const badDate = { ...eat, id: "d", extra: new Date(Number.NaN) } as unknown as LedgerEvent;
    const junk = 42 as unknown as LedgerEvent;
    const ab = mergeEvents([base, klass, big], [badDate, junk, klass]);
    const ba = mergeEvents([klass, junk, badDate], [big, base]);
    expect(ab.events.map((e) => e.id)).toEqual(["p1"]);
    expect(ab.rejected).toHaveLength(4);
    expect(ab.rejected).toEqual(ba.rejected);
    expect(ab.rejected).toContain(klass);
    expect(ab.rejected).toContain(junk);
    // i campi esistenti non cambiano
    expect(ab.conflicts).toEqual([]);
  });
});
