// Categoria dell'alimento: campo descrittivo del lotto, trattato come productRef.
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

function invariant(events: LedgerEvent[], seed = 51) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

const ham = purchase("p1", D(1), {
  lotId: "L1",
  productRef: "prosciutto",
  category: "salumi",
  quantity: q(200),
  location: "frigo",
});

describe("categoria alla creazione", () => {
  it("purchase e declare la conservano nello stato del lotto", () => {
    const dec = declare("d1", D(1), {
      lotId: "L2",
      productRef: "riso",
      category: "cereali",
      quantity: q(500),
      location: "dispensa",
    });
    const state = invariant([ham, dec]);
    expect(state.lots.map((l) => [l.lotId, l.category])).toEqual([
      ["L1", "salumi"],
      ["L2", "cereali"],
    ]);
  });

  it("assente o stringa vuota: nessuna categoria; tipo sbagliato: evento non valido", () => {
    const none = purchase("p2", D(1), {
      lotId: "L3",
      productRef: "x",
      category: "",
      quantity: q(1),
      location: "frigo",
    });
    expect(validateEvent(none)).toEqual([]);
    expect(derivePantry([none]).lots[0].category).toBeUndefined();
    expect("category" in derivePantry([none]).lots[0]).toBe(false);
    expect(validateEvent({ ...ham, category: 3 }).map((e) => e.path)).toEqual(["category"]);
  });
});

describe("categoria con updateLot", () => {
  it("modifica, cancellazione con null e stringa vuota senza effetto", () => {
    const set = updateLot("u1", D(2), { lotId: "L1", patch: { category: "carne" } });
    expect(validateEvent(set)).toEqual([]);
    expect(invariant([ham, set]).lots[0].category).toBe("carne");

    const noop = updateLot("u2", D(3), { lotId: "L1", patch: { category: "" } });
    expect(validateEvent(noop)).toEqual([]);
    expect(invariant([ham, set, noop]).lots[0].category).toBe("carne");

    const clear = updateLot("u3", D(4), { lotId: "L1", patch: { category: null } });
    const cleared = invariant([ham, set, noop, clear]).lots[0];
    expect(cleared.category).toBeUndefined();
    expect("category" in cleared).toBe(false);
    expect(validateEvent({ ...set, patch: { category: 5 } }).map((e) => e.path)).toEqual([
      "patch.category",
    ]);
  });

  it("vince l'ultima scrittura per registrazione, non per at", () => {
    const early = updateLot("a", D(9), { lotId: "L1", recordedAt: D(3), patch: { category: "A" } });
    const late = updateLot("b", D(2), { lotId: "L1", recordedAt: D(5), patch: { category: "B" } });
    expect(invariant([ham, early, late]).lots[0].category).toBe("B");
  });
});

describe("categoria e correzioni", () => {
  it("correctLot con solo la categoria: solo un updateLot, il resto non cambia", () => {
    const events = correctLot(ham, { category: "affettati" }, opts());
    expect(events.map((e) => e.type)).toEqual(["updateLot"]);
    expect(events[0]).toMatchObject({ patch: { category: "affettati" } });
    expect(validateEvent(events[0])).toEqual([]);
    expect(invariant([ham, ...events]).lots[0]).toMatchObject({
      category: "affettati",
      productRef: "prosciutto",
    });
  });

  it("correctLot con null cancella; con lo stato attuale omette un valore uguale", () => {
    const cleared = correctLot(ham, { category: null }, opts());
    expect(invariant([ham, ...cleared]).lots[0].category).toBeUndefined();
    const current = { productRef: "prosciutto", category: "salumi" };
    expect(correctLot(ham, { category: "salumi" }, { ...opts(), lot: current })).toEqual([]);
    expect(correctLot(ham, { category: null }, { ...opts(), lot: { productRef: "x" } })).toEqual([]);
    expect(correctLot(ham, { category: "" }, opts())).toEqual([]);
  });

  it("una creazione sostitutiva non sovrascrive la categoria di un updateLot", () => {
    const retag = updateLot("u1", D(2), { lotId: "L1", patch: { category: "carne" } });
    const [v, next] = correct(
      ham,
      { ...ham, id: undefined, recordedAt: undefined, category: "altro", quantity: q(250) } as never,
      opts(),
    );
    expect((next as PurchaseEvent).category).toBe("salumi"); // copiata dall'evento corretto
    const state = invariant([ham, retag, v, next]);
    expect(state.lots[0]).toMatchObject({ category: "carne", initial: 250 });
  });

  it("correctLot strutturale insieme alla categoria: void + creazione + updateLot", () => {
    const events = correctLot(ham, { quantity: q(300), category: "affettati" }, opts());
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "updateLot"]);
    expect((events[1] as PurchaseEvent).category).toBe("salumi");
    expect(invariant([ham, ...events]).lots[0]).toMatchObject({
      initial: 300,
      category: "affettati",
    });
  });

  it("senza categoria nell'origine, la correzione non ne inventa una", () => {
    const bare = purchase("p0", D(1), {
      lotId: "L1",
      productRef: "x",
      quantity: q(1),
      location: "frigo",
    });
    const events = correctLot(bare, { quantity: q(2) }, opts());
    expect(invariant([bare, ...events]).lots[0].category).toBeUndefined();
  });
});
