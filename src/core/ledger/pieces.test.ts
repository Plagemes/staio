import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { piecesAgree, piecesLeft, piecesOf } from "./pieces";
import { SCHEMA_VERSION, type LedgerEvent } from "./types";
import { validateEvent } from "./validate";

const base = {
  at: "2026-11-17T08:00:00.000Z",
  recordedAt: "2026-11-17T08:00:00.000Z",
  deviceId: "d",
  schemaVersion: SCHEMA_VERSION,
  certainty: "label" as const,
  source: "barcode" as const,
};

const purchase = (over: Record<string, unknown> = {}): LedgerEvent =>
  ({
    ...base,
    id: "e1",
    type: "purchase",
    lotId: "L1",
    productRef: "Piadina",
    quantity: { value: 200, unit: "g" },
    location: "dispensa",
    ...over,
  }) as LedgerEvent;

describe("pezzi dentro la confezione", () => {
  it("un evento senza pezzi resta valido e il lotto non li ha", () => {
    const e = purchase();
    expect(validateEvent(e)).toEqual([]);
    const lot = derivePantry([e]).lots[0];
    expect(lot.pieces).toBeUndefined();
    expect(piecesOf(lot)).toBeUndefined();
    expect(piecesLeft(lot)).toBeUndefined();
  });

  it("i pezzi dichiarati arrivano sul lotto, la quantità resta in grammi", () => {
    const e = purchase({ pieces: { count: 2, each: 100, name: "piadina" } });
    expect(validateEvent(e)).toEqual([]);
    const lot = derivePantry([e]).lots[0];
    expect(lot).toMatchObject({ unit: "g", initial: 200, remaining: 200, pieces: { count: 2, each: 100, name: "piadina" } });
    expect(piecesOf(lot)).toEqual({ count: 2, each: 100, name: "piadina", agrees: true });
    expect(piecesLeft(lot)).toBe(2);
  });

  it("dopo un consumo i pezzi rimasti seguono la quantità", () => {
    const eat = { ...base, id: "e2", type: "consume", lotId: "L1", quantity: { value: 100, unit: "g" } } as LedgerEvent;
    const half = { ...base, id: "e3", type: "consume", lotId: "L1", quantity: { value: 50, unit: "g" } } as LedgerEvent;
    const e = purchase({ pieces: { count: 2, each: 100 } });
    expect(piecesLeft(derivePantry([e, eat]).lots[0])).toBe(1);
    expect(piecesLeft(derivePantry([e, eat, half]).lots[0])).toBe(0.5);
  });

  it("pezzi che non tornano con la quantità: vale la quantità, i pezzi sono una stima", () => {
    expect(piecesAgree(200, 2, 100)).toBe(true);
    expect(piecesAgree(200, 2, 101)).toBe(true);
    expect(piecesAgree(200, 2, 120)).toBe(false);
    const lot = derivePantry([purchase({ pieces: { count: 2, each: 120 } })]).lots[0];
    expect(piecesOf(lot)).toEqual({ count: 2, each: 100, agrees: false });
  });

  it("i valori non validi sono rifiutati", () => {
    for (const pieces of [{ count: 0, each: 100 }, { count: 2.5, each: 100 }, { count: 2, each: 0 }, { count: 2 }, { each: 100 }, "due", { count: 2, each: 100, name: "" }]) {
      expect(validateEvent(purchase({ pieces })).length).toBeGreaterThan(0);
    }
  });

  it("un lotto contato a pezzi non ha pezzi dentro", () => {
    const lot = derivePantry([purchase({ quantity: { value: 4, unit: "pz" }, pieces: { count: 4, each: 1 } })]).lots[0];
    expect(piecesOf(lot)).toBeUndefined();
  });
});
