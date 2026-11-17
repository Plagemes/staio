import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import {
  activeLots,
  activeLotsByLocation,
  estimatedPantryValue,
  getLot,
  lotValueCents,
  totalForProduct,
  totalsByProduct,
  wasteByReason,
} from "./selectors";
import { adjust, consume, declare, discard, move, purchase, q } from "./test-helpers";

const D = (day: number, h = 10) =>
  `2026-03-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const state = derivePantry([
  purchase("p1", D(1), {
    lotId: "L1",
    productRef: "latte",
    quantity: q(1000, "ml"),
    priceCents: 200,
    location: "frigo",
  }),
  purchase("p2", D(2), {
    lotId: "L2",
    productRef: "latte",
    quantity: q(500, "ml"),
    priceCents: 100,
    location: "frigo",
    certainty: "estimated",
  }),
  declare("p3", D(2), {
    lotId: "L3",
    productRef: "riso",
    quantity: q(1000),
    location: "dispensa",
  }),
  purchase("p4", D(3), {
    lotId: "L4",
    productRef: "piselli",
    quantity: q(400),
    priceCents: 300,
    location: "freezer",
  }),
  purchase("p5", D(3), {
    lotId: "L5",
    productRef: "latte",
    quantity: q(6, "pz"),
    location: "dispensa",
  }),
  consume("c1", D(4), { lotId: "L1", quantity: q(500, "ml") }),
  consume("c2", D(4), { lotId: "L4", quantity: q(400) }), // finito
  discard("d1", D(5), { lotId: "L2", quantity: q(100, "ml"), reason: "expired" }),
  discard("d2", D(10), { lotId: "L1", quantity: q(100, "ml"), reason: "expired" }),
  discard("d3", D(11), { lotId: "L3", quantity: q(50), reason: "leftover", certainty: "estimated" }),
  discard("d4", D(12), { lotId: "L5", quantity: q(1, "pz"), reason: "disliked" }),
  move("m1", D(6), { lotId: "L3", to: "frigo" }),
]);

describe("selettori", () => {
  it("lotti attivi, anche per luogo", () => {
    expect(activeLots(state).map((l) => l.lotId)).toEqual(["L1", "L2", "L3", "L5"]);
    expect(activeLots(state, "frigo").map((l) => l.lotId)).toEqual(["L1", "L2", "L3"]);
    expect(activeLots(state, "freezer")).toEqual([]);
    const by = activeLotsByLocation(state);
    expect(by.dispensa.map((l) => l.lotId)).toEqual(["L5"]);
    expect(getLot(state, "L4")?.status).toBe("finished");
    expect(getLot(state, "nope")).toBeUndefined();
  });

  it("totale per prodotto, separato per unità, con la certezza peggiore", () => {
    expect(totalsByProduct(state)).toEqual([
      { productRef: "latte", unit: "ml", remaining: 800, lots: 2, certainty: "estimated" },
      { productRef: "latte", unit: "pz", remaining: 5, lots: 1, certainty: "measured" },
      { productRef: "riso", unit: "g", remaining: 950, lots: 1, certainty: "estimated" },
    ]);
    expect(totalForProduct(state, "latte", "ml")).toBe(800);
    expect(totalForProduct(state, "latte", "g")).toBe(0);
    expect(totalForProduct(state, "piselli", "g")).toBe(0); // finito
  });

  it("valore della dispensa: prezzo in proporzione al residuo, lotti senza prezzo esclusi", () => {
    expect(lotValueCents(getLot(state, "L1")!)).toBe(80); // 400 / 1000 * 200
    expect(lotValueCents(getLot(state, "L3")!)).toBeUndefined();
    expect(estimatedPantryValue(state)).toEqual({
      cents: 160,
      lotsWithPrice: 2,
      lotsWithoutPrice: 2,
      certainty: "estimated",
    });
    expect(estimatedPantryValue(derivePantry([]))).toEqual({
      cents: 0,
      lotsWithPrice: 0,
      lotsWithoutPrice: 0,
      certainty: "measured",
    });
  });

  it("il valore non supera mai il prezzo pieno anche se adjust porta il residuo sopra l'iniziale", () => {
    const s = derivePantry([
      purchase("p", D(1), {
        lotId: "L",
        productRef: "x",
        quantity: q(100),
        priceCents: 50,
        location: "frigo",
      }),
      adjust("a", D(2), { lotId: "L", remaining: q(250) }),
    ]);
    expect(lotValueCents(s.lots[0])).toBe(50);
  });

  it("spreco per motivo, con costo stimato e certezza", () => {
    expect(wasteByReason(state)).toEqual([
      { reason: "expired", unit: "ml", quantity: 200, events: 2, costCents: 40, certainty: "estimated" },
      { reason: "leftover", unit: "g", quantity: 50, events: 1, costCents: 0, certainty: "estimated" },
      { reason: "disliked", unit: "pz", quantity: 1, events: 1, costCents: 0, certainty: "measured" },
    ]);
  });

  it("spreco nel periodo [from, to)", () => {
    expect(wasteByReason(state, { from: D(6), to: D(12) })).toEqual([
      { reason: "expired", unit: "ml", quantity: 100, events: 1, costCents: 20, certainty: "measured" },
      { reason: "leftover", unit: "g", quantity: 50, events: 1, costCents: 0, certainty: "estimated" },
    ]);
    expect(wasteByReason(state, { from: D(20) })).toEqual([]);
  });
});
