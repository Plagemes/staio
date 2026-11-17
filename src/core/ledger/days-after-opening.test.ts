// Durata dopo l'apertura scritta sul prodotto: campo facoltativo di acquisto e dichiarazione.
import { describe, expect, it } from "vitest";
import { correctLot } from "./correct";
import { derivePantry } from "./derive";
import { mergeEvents } from "./merge";
import { declare, open, purchase, q, seededRandom, shuffled, updateLot } from "./test-helpers";
import type { LedgerEvent, PurchaseEvent } from "./types";
import { validateEvent } from "./validate";

const D = (day: number, h = 10) => `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const withDays = (extra: Record<string, unknown> = {}) =>
  purchase("p1", D(1), { lotId: "L1", productRef: "yogurt", category: "yogurt", quantity: q(125), location: "frigo", ...extra } as never);

describe("daysAfterOpening sull'evento di acquisto", () => {
  it("un evento senza il campo resta valido e il lotto non lo ha", () => {
    const e = withDays();
    expect(validateEvent(e)).toEqual([]);
    expect(derivePantry([e]).lots[0]).not.toHaveProperty("daysAfterOpening");
  });

  it("il valore valido arriva sul lotto, anche da una dichiarazione", () => {
    const e = withDays({ daysAfterOpening: 5 });
    expect(validateEvent(e)).toEqual([]);
    expect(derivePantry([e]).lots[0].daysAfterOpening).toBe(5);
    const d = declare("d1", D(1), { lotId: "L2", productRef: "latte", quantity: q(1000, "ml"), location: "frigo", daysAfterOpening: 3 } as never);
    expect(validateEvent(d)).toEqual([]);
    expect(derivePantry([d]).lots[0].daysAfterOpening).toBe(3);
  });

  it("un valore non utilizzabile (da un altro dispositivo o da una copia) si ignora: l'acquisto resta valido e il lotto esiste", () => {
    for (const v of [0, -1, 2.5, "3", 4000, null, { a: 1 }]) {
      const e = withDays({ daysAfterOpening: v });
      expect(validateEvent(e), String(v)).toEqual([]);
      const lots = derivePantry([e, open("o1", D(2), { lotId: "L1" })]).lots;
      expect(lots).toHaveLength(1);
      expect(lots[0], String(v)).not.toHaveProperty("daysAfterOpening");
      expect(lots[0].openedAt).toBe(D(2));
    }
  });

  it("se l'utente cambia categoria o toglie il codice a barre, la durata del prodotto non vale più", () => {
    const e = withDays({ daysAfterOpening: 5, barcode: "8001234567890" });
    const other = derivePantry([e, updateLot("u1", D(2), { lotId: "L1", patch: { category: "milk_fresh" } })]).lots[0];
    expect(other.category).toBe("milk_fresh");
    expect(other).not.toHaveProperty("daysAfterOpening");
    const noCode = derivePantry([e, updateLot("u2", D(2), { lotId: "L1", patch: { barcode: null } })]).lots[0];
    expect(noCode).not.toHaveProperty("daysAfterOpening");
    const sameCategory = derivePantry([e, updateLot("u3", D(2), { lotId: "L1", patch: { category: "yogurt", productRef: "yogurt greco" } })]).lots[0];
    expect(sameCategory.daysAfterOpening).toBe(5);
    // l'ordine di arrivo non cambia l'esito
    const events: LedgerEvent[] = [e, updateLot("u1", D(2), { lotId: "L1", patch: { category: "milk_fresh" } })];
    const random = seededRandom(3);
    for (let i = 0; i < 10; i++) expect(derivePantry(shuffled(events, random)).lots[0]).not.toHaveProperty("daysAfterOpening");
  });

  it("resta sul lotto dopo l'apertura e dopo una correzione della quantità", () => {
    const e = withDays({ daysAfterOpening: 5 }) as PurchaseEvent;
    const opened = open("o1", D(2), { lotId: "L1" });
    expect(derivePantry([e, opened]).lots[0]).toMatchObject({ daysAfterOpening: 5, openedAt: D(2) });
    const fixed = correctLot(e, { quantity: q(250) }, { now: () => D(3), idGenerator: (() => { let n = 0; return () => `c${++n}`; })() });
    expect(fixed.length).toBeGreaterThan(0);
    const lot = derivePantry([e, opened, ...fixed]).lots[0];
    expect(lot).toMatchObject({ initial: 250, daysAfterOpening: 5 });
  });

  it("l'ordine di arrivo degli eventi non cambia il lotto", () => {
    const events: LedgerEvent[] = [withDays({ daysAfterOpening: 5 }), open("o1", D(2), { lotId: "L1" })];
    const expected = derivePantry(events);
    const random = seededRandom(7);
    for (let i = 0; i < 10; i++) expect(derivePantry(shuffled(events, random))).toEqual(expected);
  });

  it("copia e ripristino: il JSON e la fusione portano il campo senza perderlo", () => {
    const events: LedgerEvent[] = [withDays({ daysAfterOpening: 5 }), withDays({ id: "p2", lotId: "L9" })];
    const restored = JSON.parse(JSON.stringify(events)) as LedgerEvent[];
    expect(restored.every((e) => validateEvent(e).length === 0)).toBe(true);
    const merged = mergeEvents(events.slice(0, 1), restored);
    expect(merged.events.find((e) => e.id === "p1")).toMatchObject({ daysAfterOpening: 5 });
    expect(derivePantry(merged.events).lots.find((l) => l.lotId === "L1")?.daysAfterOpening).toBe(5);
    expect(derivePantry(merged.events).lots.find((l) => l.lotId === "L9")).not.toHaveProperty("daysAfterOpening");
  });
});
