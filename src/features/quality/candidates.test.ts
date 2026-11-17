import { describe, expect, it } from "vitest";
import type { Lot } from "@/core/ledger";
import { product } from "@/core/quality/test-helpers";
import { buildCandidates, knownProductRows, pantryLineOf, pantryStockFor, priceObservationsByBarcode } from "./candidates";

function lot(extra: Partial<Lot>): Lot {
  return {
    lotId: "l1",
    productRef: "x",
    origin: "purchase",
    status: "active",
    unit: "g",
    initial: 500,
    remaining: 500,
    consumed: 0,
    discarded: 0,
    gifted: 0,
    location: "dispensa",
    createdAt: "2026-11-01T10:00:00.000Z",
    initialCertainty: "label",
    remainingCertainty: "label",
    ...extra,
  } as Lot;
}

describe("priceObservationsByBarcode", () => {
  it("prende solo gli acquisti con prezzo e codice", () => {
    const m = priceObservationsByBarcode([
      lot({ barcode: "8076800195057", priceCents: 250, store: " Coop " }),
      lot({ lotId: "l2", barcode: "8076800195057", origin: "declare" }),
      lot({ lotId: "l3", barcode: "8076800195057" }),
      lot({ lotId: "l4", priceCents: 100 }),
    ]);
    expect([...m.keys()]).toEqual(["8076800195057"]);
    expect(m.get("8076800195057")).toEqual([{ totalCents: 250, amount: 500, unit: "g", store: "Coop" }]);
  });

  it("un UPC-A e il suo EAN-13 sono lo stesso prodotto", () => {
    const m = priceObservationsByBarcode([lot({ barcode: "036000291452", priceCents: 300 })]);
    expect(m.get("0036000291452")).toHaveLength(1);
  });
});

describe("buildCandidates", () => {
  it("allega i prezzi ai prodotti noti e non inventa i prezzi che mancano", () => {
    const out = buildCandidates([product("A"), product("B")], [lot({ barcode: "A", priceCents: 200 })]);
    expect(out[0].prices).toHaveLength(1);
    expect(out[1].prices).toBeUndefined();
  });
});

describe("pantryStockFor", () => {
  it("somma i lotti attivi con quel codice", () => {
    const s = pantryStockFor([lot({ barcode: "A", remaining: 200 }), lot({ lotId: "l2", barcode: "A", remaining: 100 })], "A");
    expect(s).toEqual({ has: true, amount: 300, unit: "g" });
  });
  it("lotti finiti o di altri codici non contano", () => {
    expect(pantryStockFor([lot({ barcode: "A", status: "finished", remaining: 0 }), lot({ lotId: "l2", barcode: "B" })], "A")).toEqual({ has: false });
  });
  it("senza codice cerca per nome uguale e lo dichiara come corrispondenza per nome", () => {
    const s = pantryStockFor([lot({ productRef: "Biscotti Mulino", remaining: 250 })], "A", "biscotti mulino");
    expect(s).toEqual({ has: true, amount: 250, unit: "g", matchedBy: "name", matchLabel: "Biscotti Mulino" });
  });
  it("se non trova né per codice né per nome dice con quali criteri ha cercato", () => {
    expect(pantryStockFor([lot({ productRef: "Altro" })], "A", "Biscotti")).toEqual({ has: false, searchedBy: ["barcode", "name"] });
    expect(pantryStockFor([], "A")).toEqual({ has: false });
  });
  it("il codice vince sul nome", () => {
    const s = pantryStockFor([lot({ barcode: "A", productRef: "x", remaining: 100 }), lot({ lotId: "l2", productRef: "Biscotti", remaining: 900 })], "A", "Biscotti");
    expect(s).toEqual({ has: true, amount: 100, unit: "g" });
  });
  it("pantryLineOf usa il testo della logica", () => {
    expect(pantryLineOf(product("A"), { has: false })).toMatch(/Nessuna confezione con questo codice/);
    expect(pantryLineOf(product("A"), { has: true, matchedBy: "name", matchLabel: "Biscotti" })).toMatch(/Non è detto che sia lo stesso/);
  });
  it("con unità miste dice che ce n'è, senza quantità", () => {
    expect(pantryStockFor([lot({ barcode: "A" }), lot({ lotId: "l2", barcode: "A", unit: "pz", remaining: 2 })], "A")).toEqual({ has: true });
  });
});

describe("knownProductRows", () => {
  it("ordina per nome, senza nome in fondo, e segna registro e dispensa", () => {
    const rows = knownProductRows(
      [product("C"), product("B", { name: "Zucchero" }), product("A", { name: "Biscotti" })],
      [lot({ barcode: "A", status: "finished", remaining: 0 }), lot({ lotId: "l2", barcode: "B" })],
    );
    expect(rows.map((r) => r.product.barcode)).toEqual(["A", "B", "C"]);
    expect(rows[0]).toMatchObject({ inLedger: true, inPantry: false });
    expect(rows[1]).toMatchObject({ inLedger: true, inPantry: true });
    expect(rows[2]).toMatchObject({ inLedger: false, inPantry: false });
  });
});
