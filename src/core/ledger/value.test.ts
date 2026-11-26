import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { estimatedPantryValue, lotValueCents, pantryValueParts } from "./selectors";
import { consume, declare, purchase, q } from "./test-helpers";

const D = (day: number) => `2026-03-${String(day).padStart(2, "0")}T10:00:00.000Z`;

const state = derivePantry([
  purchase("p1", D(1), { lotId: "L1", productRef: "latte", quantity: q(1000, "ml"), priceCents: 200, location: "frigo" }),
  purchase("p2", D(2), {
    lotId: "L2",
    productRef: "pane",
    quantity: q(500),
    priceCents: 333,
    location: "dispensa",
    certainty: "estimated",
  }),
  purchase("p3", D(3), { lotId: "L3", productRef: "uova", quantity: q(6, "pz"), location: "frigo" }),
  declare("p4", D(3), { lotId: "L4", productRef: "riso", quantity: q(1000), location: "dispensa" }),
  purchase("p5", D(4), { lotId: "L5", productRef: "piselli", quantity: q(400), priceCents: 300, location: "freezer" }),
  consume("c1", D(5), { lotId: "L1", quantity: q(500, "ml") }),
  consume("c2", D(5), { lotId: "L5", quantity: q(400) }), // finito: fuori
]);

describe("parti del valore della dispensa", () => {
  it("la somma delle parti è il totale di estimatedPantryValue", () => {
    const { parts } = pantryValueParts(state);
    const total = estimatedPantryValue(state);
    expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(total.cents);
    expect(parts).toHaveLength(total.lotsWithPrice);
  });

  it("ogni parte è il valore del suo lotto, con la certezza peggiore", () => {
    const { parts } = pantryValueParts(state);
    const latte = parts.find((p) => p.lot.lotId === "L1")!;
    expect(latte.cents).toBe(lotValueCents(latte.lot));
    expect(latte.cents).toBe(100); // resta il 50% di 2,00 €
    expect(latte.certainty).toBe("measured");
    expect(parts.find((p) => p.lot.lotId === "L2")!.certainty).toBe("estimated");
  });

  it("i lotti senza prezzo (anche «già in casa») sono mancanti, i finiti non ci sono", () => {
    const { parts, missing } = pantryValueParts(state);
    expect(missing.map((l) => l.lotId).sort()).toEqual(["L3", "L4"]);
    expect(estimatedPantryValue(state).lotsWithoutPrice).toBe(missing.length);
    expect([...parts.map((p) => p.lot.lotId), ...missing.map((l) => l.lotId)]).not.toContain("L5");
  });

  it("estimatedPantryValue dà lo stesso risultato di prima", () => {
    expect(estimatedPantryValue(state)).toEqual({ cents: 433, lotsWithPrice: 2, lotsWithoutPrice: 2, certainty: "estimated" });
    expect(estimatedPantryValue(derivePantry([]))).toEqual({
      cents: 0,
      lotsWithPrice: 0,
      lotsWithoutPrice: 0,
      certainty: "measured",
    });
    expect(pantryValueParts(derivePantry([]))).toEqual({ parts: [], missing: [] });
  });
});
