// Codice a barre: campo descrittivo del lotto, trattato come la categoria.
import { describe, expect, it } from "vitest";
import { correct, correctLot } from "./correct";
import { derivePantry } from "./derive";
import { declare, purchase, q, seededRandom, shuffled, updateLot } from "./test-helpers";
import type { LedgerEvent, PurchaseEvent } from "./types";
import { validateEvent } from "./validate";

const D = (day: number, h = 10) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const opts = (day = 10) => {
  let n = 0;
  return { now: () => D(day), idGenerator: () => `g${String(++n).padStart(3, "0")}` };
};

function invariant(events: LedgerEvent[], seed = 61) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

const EAN13 = "8001234567890";
const EAN8 = "96385074";

const milk = purchase("p1", D(1), {
  lotId: "L1",
  productRef: "latte",
  barcode: EAN13,
  quantity: q(1000, "ml"),
  location: "frigo",
});

describe("codice a barre alla creazione", () => {
  it("purchase e declare lo conservano nello stato del lotto", () => {
    const dec = declare("d1", D(1), {
      lotId: "L2",
      productRef: "riso",
      barcode: EAN8,
      quantity: q(500),
      location: "dispensa",
    });
    const state = invariant([milk, dec]);
    expect(state.lots.map((l) => [l.lotId, l.barcode])).toEqual([
      ["L1", EAN13],
      ["L2", EAN8],
    ]);
  });

  it("assente o stringa vuota: nessun codice", () => {
    const none = purchase("p2", D(1), {
      lotId: "L3",
      productRef: "x",
      barcode: "",
      quantity: q(1),
      location: "frigo",
    });
    expect(validateEvent(none)).toEqual([]);
    expect("barcode" in derivePantry([none]).lots[0]).toBe(false);
  });

  it("validazione: solo cifre, da 8 a 14", () => {
    const paths = (barcode: unknown) =>
      validateEvent({ ...milk, barcode }).map((e) => `${e.path}:${e.code}`);
    expect(paths("12345678")).toEqual([]);
    expect(paths("12345678901234")).toEqual([]);
    expect(paths("1234567")).toEqual(["barcode:invalid_value"]);
    expect(paths("123456789012345")).toEqual(["barcode:invalid_value"]);
    expect(paths("80012345678AB")).toEqual(["barcode:invalid_value"]);
    expect(paths("8001 2345 6789")).toEqual(["barcode:invalid_value"]);
    expect(paths(" 12345678")).toEqual(["barcode:invalid_value"]);
    expect(paths(12345678)).toEqual(["barcode:invalid_type"]);
    expect(paths(null)).toEqual(["barcode:invalid_type"]);
  });

  it("un codice non valido rende non valido l'evento: la dispensa lo scarta con anomalia", () => {
    const bad = { ...milk, barcode: "abc" } as LedgerEvent;
    const state = derivePantry([bad]);
    expect(state.lots).toEqual([]);
    expect(state.anomalies.map((a) => a.code)).toEqual(["invalid_event"]);
  });
});

describe("codice a barre con updateLot", () => {
  it("modifica, cancellazione con null e stringa vuota senza effetto", () => {
    const set = updateLot("u1", D(2), { lotId: "L1", patch: { barcode: EAN8 } });
    expect(validateEvent(set)).toEqual([]);
    expect(invariant([milk, set]).lots[0].barcode).toBe(EAN8);

    const noop = updateLot("u2", D(3), { lotId: "L1", patch: { barcode: "" } });
    expect(validateEvent(noop)).toEqual([]);
    expect(invariant([milk, set, noop]).lots[0].barcode).toBe(EAN8);

    const clear = updateLot("u3", D(4), { lotId: "L1", patch: { barcode: null } });
    const cleared = invariant([milk, set, noop, clear]).lots[0];
    expect("barcode" in cleared).toBe(false);
  });

  it("valori non validi nella patch", () => {
    const e = (barcode: unknown) =>
      validateEvent(updateLot("u", D(2), { lotId: "L1", patch: { barcode } as never })).map(
        (x) => `${x.path}:${x.code}`,
      );
    expect(e("123")).toEqual(["patch.barcode:invalid_value"]);
    expect(e(5)).toEqual(["patch.barcode:invalid_type"]);
  });

  it("vince l'ultima scrittura per registrazione, non per at", () => {
    const early = updateLot("a", D(9), { lotId: "L1", recordedAt: D(3), patch: { barcode: "11111111" } });
    const late = updateLot("b", D(2), { lotId: "L1", recordedAt: D(5), patch: { barcode: "22222222" } });
    expect(invariant([milk, early, late]).lots[0].barcode).toBe("22222222");
  });
});

describe("codice a barre e correzioni", () => {
  it("correctLot con il solo codice: solo un updateLot", () => {
    const events = correctLot(milk, { barcode: EAN8 }, opts());
    expect(events.map((e) => e.type)).toEqual(["updateLot"]);
    expect(events[0]).toMatchObject({ patch: { barcode: EAN8 } });
    expect(validateEvent(events[0])).toEqual([]);
    expect(invariant([milk, ...events]).lots[0]).toMatchObject({
      barcode: EAN8,
      productRef: "latte",
    });
  });

  it("correctLot con null cancella; con lo stato attuale omette un valore uguale", () => {
    const cleared = correctLot(milk, { barcode: null }, opts());
    expect("barcode" in invariant([milk, ...cleared]).lots[0]).toBe(false);
    const current = { productRef: "latte", barcode: EAN13 };
    expect(correctLot(milk, { barcode: EAN13 }, { ...opts(), lot: current })).toEqual([]);
    expect(correctLot(milk, { barcode: null }, { ...opts(), lot: { productRef: "x" } })).toEqual([]);
    expect(correctLot(milk, { barcode: "" }, opts())).toEqual([]);
  });

  it("una creazione sostitutiva non sovrascrive il codice di un updateLot", () => {
    const retag = updateLot("u1", D(2), { lotId: "L1", patch: { barcode: EAN8 } });
    const [v, next] = correct(
      milk,
      { ...milk, id: undefined, recordedAt: undefined, barcode: "99999999", quantity: q(1500, "ml") } as never,
      opts(),
    );
    expect((next as PurchaseEvent).barcode).toBe(EAN13); // copiato dall'evento corretto
    const state = invariant([milk, retag, v, next]);
    expect(state.lots[0]).toMatchObject({ barcode: EAN8, initial: 1500 });
  });

  it("correctLot strutturale insieme al codice: void + creazione + updateLot", () => {
    const events = correctLot(milk, { quantity: q(1500, "ml"), barcode: EAN8 }, opts());
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "updateLot"]);
    expect((events[1] as PurchaseEvent).barcode).toBe(EAN13);
    expect(invariant([milk, ...events]).lots[0]).toMatchObject({ initial: 1500, barcode: EAN8 });
  });

  it("senza codice nell'origine, la correzione non ne inventa uno", () => {
    const bare = purchase("p0", D(1), {
      lotId: "L1",
      productRef: "x",
      quantity: q(1),
      location: "frigo",
    });
    const events = correctLot(bare, { quantity: q(2) }, opts());
    expect("barcode" in invariant([bare, ...events]).lots[0]).toBe(false);
  });
});
