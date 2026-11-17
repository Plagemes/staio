import { describe, expect, it } from "vitest";
import { product } from "@/core/quality/test-helpers";
import { bringToTop, removeEntry, resolveEntry, selectedProducts, startEntry, toggleSelected, type ShelfEntry } from "./shelfSession";

describe("shelfSession", () => {
  it("startEntry mette il nuovo in cima e non duplica", () => {
    const a = startEntry([], "A");
    const b = startEntry(a, "B");
    expect(b.map((e) => e.code)).toEqual(["B", "A"]);
    expect(startEntry(b, "A").map((e) => e.code)).toEqual(["A", "B"]);
  });

  it("resolveEntry sostituisce solo quella con lo stesso codice", () => {
    const list = startEntry(startEntry([], "A"), "B");
    const out = resolveEntry(list, { code: "A", status: "not_found" });
    expect(out.map((e) => e.status)).toEqual(["loading", "not_found"]);
  });

  it("bringToTop porta in cima un codice già letto e ignora uno sconosciuto", () => {
    const list = startEntry(startEntry([], "A"), "B");
    expect(bringToTop(list, "A").map((e) => e.code)).toEqual(["A", "B"]);
    expect(bringToTop(list, "Z")).toEqual(list);
  });

  it("removeEntry toglie un codice", () => {
    expect(removeEntry(startEntry(startEntry([], "A"), "B"), "A").map((e) => e.code)).toEqual(["B"]);
  });

  it("toggleSelected tiene al massimo quattro prodotti", () => {
    let s: string[] = [];
    for (const c of ["A", "B", "C", "D", "E"]) s = toggleSelected(s, c);
    expect(s).toEqual(["A", "B", "C", "D"]);
    expect(toggleSelected(s, "B")).toEqual(["A", "C", "D"]);
  });

  it("selectedProducts prende solo i trovati scelti, nell'ordine dello storico", () => {
    const entries: ShelfEntry[] = [
      { code: "B", status: "found", product: product("B"), from: "memory" },
      { code: "N", status: "not_found" },
      { code: "A", status: "found", product: product("A"), from: "service" },
    ];
    expect(selectedProducts(entries, ["A", "B", "N"]).map((p) => p.barcode)).toEqual(["B", "A"]);
  });
});
