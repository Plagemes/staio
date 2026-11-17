// correctLot: l'aiuto che sceglie gli eventi giusti per modificare un lotto.
import { describe, expect, it } from "vitest";
import { correct, correctLot, voidEvent } from "./correct";
import { derivePantry } from "./derive";
import { declare, purchase, q, seededRandom, shuffled, updateLot } from "./test-helpers";
import type { Expiry, LedgerEvent, PurchaseEvent } from "./types";
import { validateEvent } from "./validate";

const D = (day: number, h = 10) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const withUseBy = (date: string): Expiry => ({ date, kind: "use_by" });

const ids = () => {
  let n = 0;
  return () => `g${String(++n).padStart(3, "0")}`;
};
const opts = (day = 10) => ({ now: () => D(day), idGenerator: ids() });

function invariant(events: LedgerEvent[], seed = 41) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

const original = purchase("p1", D(1), {
  lotId: "L1",
  productRef: "prosciutto",
  quantity: q(200),
  priceCents: 400,
  store: "Coop",
  location: "frigo",
  expiry: withUseBy("2026-11-05"),
});
const wrong = updateLot("u1", D(2), { lotId: "L1", patch: { expiry: withUseBy("2026-11-30") } });

describe("correctLot: il caso del 5 e del 30 novembre", () => {
  it("correct() con una scadenza nella sostituzione non la cambia: resta il 30", () => {
    const [v, next] = correct(original, { ...original, id: undefined, recordedAt: undefined } as never, opts());
    expect(invariant([original, wrong, v, next]).lots[0].expiry).toEqual(withUseBy("2026-11-30"));
  });

  it("correctLot riporta il 5, anche senza conoscere lo stato attuale del lotto", () => {
    const events = correctLot(original, { expiry: withUseBy("2026-11-05") }, opts());
    expect(events.map((e) => e.type)).toEqual(["updateLot"]); // uguale all'originale ma l'updateLot è comunque emesso
    expect(invariant([original, wrong, ...events]).lots[0].expiry).toEqual(withUseBy("2026-11-05"));
  });

  it("con lo stato attuale, omette le modifiche già uguali e emette quelle diverse", () => {
    const current = { productRef: "prosciutto", expiry: withUseBy("2026-11-30"), priceCents: 400, store: "Coop" };
    expect(correctLot(original, { expiry: withUseBy("2026-11-30"), store: "Coop" }, { ...opts(), lot: current })).toEqual([]);
    const events = correctLot(original, { expiry: withUseBy("2026-11-05") }, { ...opts(), lot: current });
    expect(events.map((e) => e.type)).toEqual(["updateLot"]);
    expect(events[0]).toMatchObject({ patch: { expiry: withUseBy("2026-11-05") } });
  });

  it("annullare l'updateLot sbagliato ripristina il valore d'origine, anche dopo una correzione", () => {
    const pair = correctLot(original, { quantity: q(250) }, opts());
    const undo = voidEvent(wrong, { now: () => D(12), idGenerator: () => "undo1" });
    const state = invariant([original, wrong, ...pair, undo]);
    expect(state.lots[0]).toMatchObject({ initial: 250, expiry: withUseBy("2026-11-05") });
    expect(state.voidedEventIds).toEqual(["p1", "u1"]);
    // e se l'annullamento è a sua volta annullato, torna il 30
    const redo = voidEvent(undo, { now: () => D(13), idGenerator: () => "undo2" });
    expect(invariant([original, wrong, ...pair, undo, redo]).lots[0].expiry).toEqual(
      withUseBy("2026-11-30"),
    );
  });
});

describe("correctLot: quali eventi restituisce", () => {
  it("solo campi descrittivi (prezzo): solo l'updateLot, registrato dopo", () => {
    const events = correctLot(original, { priceCents: 450 }, opts());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "updateLot",
      lotId: "L1",
      patch: { priceCents: 450 },
      recordedAt: "2026-11-10T10:00:00.001Z",
    });
    const state = invariant([original, wrong, ...events]).lots[0];
    expect(state).toMatchObject({ priceCents: 450, expiry: withUseBy("2026-11-30"), store: "Coop" });
  });

  it("sola quantità: coppia void + nuova creazione, che eredita i campi descrittivi", () => {
    const events = correctLot(original, { quantity: q(250) }, opts());
    expect(events.map((e) => e.type)).toEqual(["void", "purchase"]);
    expect(events[1]).toMatchObject({
      replaces: "p1",
      at: original.at,
      quantity: q(250),
      priceCents: 400,
      store: "Coop",
      expiry: withUseBy("2026-11-05"),
    });
    expect(invariant([original, wrong, ...events]).lots[0]).toMatchObject({
      initial: 250,
      expiry: withUseBy("2026-11-30"),
    });
  });

  it("quantità, luogo e at insieme a prezzo e scadenza: void + creazione + updateLot", () => {
    const events = correctLot(
      original,
      {
        quantity: q(250),
        location: "freezer",
        at: D(3),
        priceCents: 450,
        expiry: withUseBy("2026-11-09"),
        productRef: "prosciutto cotto",
        store: null,
      },
      opts(),
    );
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "updateLot"]);
    for (const e of events) expect(validateEvent(e)).toEqual([]);
    const [, created, upd] = events;
    expect(created.recordedAt < upd.recordedAt).toBe(true);
    const state = invariant([original, wrong, ...events]);
    expect(state.lots[0]).toMatchObject({
      initial: 250,
      location: "freezer",
      createdAt: D(3),
      priceCents: 450,
      productRef: "prosciutto cotto",
      expiry: withUseBy("2026-11-09"),
    });
    expect(state.lots[0].store).toBeUndefined();
  });

  it("nessuna modifica: lista vuota; modifiche uguali all'originale non generano la coppia", () => {
    expect(correctLot(original, {}, opts())).toEqual([]);
    expect(
      correctLot(original, { quantity: q(200), location: "frigo", at: original.at, note: "" }, opts()),
    ).toEqual([]);
  });

  it("vale anche per una dichiarazione: il prezzo arriva con un updateLot", () => {
    const dec = declare("d1", D(1), {
      lotId: "L2",
      productRef: "riso",
      quantity: q(500),
      location: "dispensa",
    });
    const events = correctLot(dec, { quantity: q(600), priceCents: 150 }, opts());
    expect(events.map((e) => e.type)).toEqual(["void", "declare", "updateLot"]);
    for (const e of events) expect(validateEvent(e)).toEqual([]);
    expect(invariant([dec, ...events]).lots[0]).toMatchObject({ initial: 600, priceCents: 150 });
  });

  it("usa il dispositivo indicato, altrimenti quello dell'acquisto", () => {
    expect(correctLot(original, { priceCents: 1 }, opts())[0].deviceId).toBe("dev-a");
    expect(correctLot(original, { priceCents: 1 }, { ...opts(), deviceId: "dev-b" })[0].deviceId).toBe(
      "dev-b",
    );
  });

  it("una correzione di una correzione resta coerente (catena e permutazioni)", () => {
    const gen = ids();
    const first = correctLot(original, { quantity: q(250) }, { now: () => D(10), idGenerator: gen });
    const p2 = first[1] as PurchaseEvent;
    const second = correctLot(
      p2,
      { quantity: q(260), expiry: withUseBy("2026-11-07") },
      { now: () => D(11), idGenerator: gen },
    );
    const state = invariant([original, wrong, ...first, ...second]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots[0]).toMatchObject({ initial: 260, expiry: withUseBy("2026-11-07") });
  });
});
